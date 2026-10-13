// The skywriting plane: a small red aerobatic monoplane, built as a real 3D
// model and projected face by face, so it looks right from wherever we see
// it — from behind as it overtakes us, side-on as it writes.
//
// Its flight is worked out relative to the camera, which it keeps pace
// with: X to the right, Y up from eye level, Z ahead, metres.

import { COMPASS_DEPTH, CROSS_AT, GAP_ANGLE, GAP_RADIUS, compassPlacement, compassScale } from './compass';
import { RUN_SECONDS } from './world';
import { PEN_SPEED, TAIL_BEHIND, WORD, WRITE_FROM, WRITE_TO, alongAt, penAt, pointAlong } from './skywriting';

// How far ahead the plane writes, m, and where the word sits on screen: its
// width as a share of the screen's, and its baseline as a share of the
// screen's height from the top.
export const WRITE_DEPTH = 120;
export const WORD_WIDTH = 0.86;
export const WORD_BASELINE = 0.22;

// It comes from behind us on the left, overtaking, from APPROACH_FROM, and
// is on the start of the word at WRITE_FROM. After the word it swings down
// through the compass's ring at CROSS_AT, flying away from us, and carries
// straight on into the distance, behind the compass, to the end.
export const APPROACH_FROM = 3.7;
export const LEAVE_BY = RUN_SECONDS;
// It passes just above us and a little to the left, so it comes into view
// over the top of the screen, close and seen from below.
const APPROACH_START = { x: -3, y: 12, z: -12 };
const APPROACH_SPEED = 120; // m/s faster than us as it passes
// How fast it's flying away from us as it goes through the ring, and at
// the end, m/s; and how far off it is by then, m.
const CROSS_SPEED = 900;
const LEAVE_SPEED = 2400;
const LEAVE_DEPTH = 2600;

export interface Layout {
  unit: number; // px per unit of the word
  left: number; // px, the word's left edge
  baseline: number; // px
}

// Where the word goes on a screen this size.
export function wordLayout(width: number, height: number): Layout {
  'worklet';
  const unit = (WORD_WIDTH * width) / (WORD.right - WORD.left);
  return { unit, left: (width - unit * (WORD.right - WORD.left)) / 2 - WORD.left * unit, baseline: WORD_BASELINE * height };
}

type Vec = { x: number; y: number; z: number };

// A point of the word, in the camera's frame at the plane's depth.
function onWord(x: number, y: number, width: number, height: number, focal: number, cy: number): Vec {
  'worklet';
  const layout = wordLayout(width, height);
  const sx = layout.left + x * layout.unit;
  const sy = layout.baseline + y * layout.unit;
  return { x: ((sx - width / 2) * WRITE_DEPTH) / focal, y: ((cy - sy) * WRITE_DEPTH) / focal, z: WRITE_DEPTH };
}

// A smooth curve from one point and velocity to another over `span`
// seconds, at `u` from 0 to 1 of the way.
function hermite(p0: Vec, v0: Vec, p1: Vec, v1: Vec, span: number, u: number): Vec {
  'worklet';
  const u2 = u * u;
  const u3 = u2 * u;
  const a = 2 * u3 - 3 * u2 + 1;
  const b = u3 - 2 * u2 + u;
  const c = -2 * u3 + 3 * u2;
  const d = u3 - u2;
  return {
    x: a * p0.x + b * span * v0.x + c * p1.x + d * span * v1.x,
    y: a * p0.y + b * span * v0.y + c * p1.y + d * span * v1.y,
    z: a * p0.z + b * span * v0.z + c * p1.z + d * span * v1.z,
  };
}

// Where the plane is at `time`, relative to the camera; or null before it
// arrives and after it's gone.
export function planeAt(time: number, width: number, height: number, focal: number, cy: number): Vec | null {
  'worklet';
  if (time < APPROACH_FROM || time > LEAVE_BY) return null;
  const word = (t: number) => {
    'worklet';
    const pen = penAt(t);
    return onWord(pen.x, pen.y, width, height, focal, cy);
  };
  // The word's own speed where it starts and ends, so the plane joins and
  // leaves it without a kink.
  const h = 0.01;
  const velocity = (t: number) => {
    'worklet';
    const a = word(t - h);
    const b = word(t + h);
    return { x: (b.x - a.x) / (2 * h), y: (b.y - a.y) / (2 * h), z: (b.z - a.z) / (2 * h) };
  };
  if (time < WRITE_FROM) {
    const span = WRITE_FROM - APPROACH_FROM;
    return hermite(APPROACH_START, { x: 0, y: 0, z: APPROACH_SPEED }, word(WRITE_FROM), velocity(WRITE_FROM + h), span, (time - APPROACH_FROM) / span);
  }
  if (time <= WRITE_TO) return word(time);
  // The gap in the compass it flies through, where it is on screen when the
  // plane gets there.
  const place = compassPlacement(width, height);
  const reach = GAP_RADIUS * place.unit * compassScale(CROSS_AT);
  const gapX = place.cx + Math.sin(GAP_ANGLE) * reach;
  const gapY = place.cy - Math.cos(GAP_ANGLE) * reach;
  const gap = { x: ((gapX - width / 2) * COMPASS_DEPTH) / focal, y: ((cy - gapY) * COMPASS_DEPTH) / focal, z: COMPASS_DEPTH };
  const through = { x: 0, y: 0, z: CROSS_SPEED };
  if (time <= CROSS_AT) {
    const span = CROSS_AT - WRITE_TO;
    return hermite(word(WRITE_TO), velocity(WRITE_TO - h), gap, through, span, (time - WRITE_TO) / span);
  }
  const span = LEAVE_BY - CROSS_AT;
  return hermite(gap, through, { x: gap.x, y: gap.y, z: LEAVE_DEPTH }, { x: 0, y: 0, z: LEAVE_SPEED }, span, (time - CROSS_AT) / span);
}

// How the plane is turned at `time`: its nose along the way it's flying
// through the air (its motion relative to the camera, plus ours), and its
// wings banked so its lift points into the turn. While it writes, its body
// lies along the letter, from its middle back to its tail, which is where
// the smoke comes out, so the smoke always leaves the tail even round the
// tightest turns; at the top of a t it pivots on the spot, as a stunt
// plane does.
export function planeAttitude(time: number, width: number, height: number, focal: number, cy: number, cameraSpeed: number) {
  'worklet';
  const h = 0.01;
  const at = (t: number) => {
    'worklet';
    return planeAt(Math.min(Math.max(t, APPROACH_FROM), LEAVE_BY), width, height, focal, cy)!;
  };
  const p0 = at(time - 2 * h);
  const p1 = at(time - h);
  const p2 = at(time + h);
  const p3 = at(time + 2 * h);
  const v1 = { x: (p2.x - p0.x) / (3 * h), y: (p2.y - p0.y) / (3 * h), z: (p2.z - p0.z) / (3 * h) + cameraSpeed };
  const v2 = { x: (p3.x - p1.x) / (3 * h), y: (p3.y - p1.y) / (3 * h), z: (p3.z - p1.z) / (3 * h) + cameraSpeed };
  const v = { x: (v1.x + v2.x) / 2, y: (v1.y + v2.y) / 2, z: (v1.z + v2.z) / 2 };
  let speed = Math.hypot(v.x, v.y, v.z) || 1;
  let forward = { x: v.x / speed, y: v.y / speed, z: v.z / speed };
  if (time > WRITE_FROM && time < WRITE_TO) {
    const along = alongAt(time);
    const tail = pointAlong(along - TAIL_BEHIND);
    if (tail) {
      const nose = at(time);
      const back = onWord(tail.x, tail.y, width, height, focal, cy);
      // Behind, where we were when the tail was let out there; we've moved
      // on since by the camera's speed.
      const lag = TAIL_BEHIND / PEN_SPEED;
      const chord = { x: nose.x - back.x, y: nose.y - back.y, z: nose.z - back.z + cameraSpeed * lag };
      const length = Math.hypot(chord.x, chord.y, chord.z) || 1;
      forward = { x: chord.x / length, y: chord.y / length, z: chord.z / length };
      speed = length / lag;
    }
  }
  // Lift: into the turn, plus enough to hold the plane up.
  const accel = { x: (v2.x - v1.x) / h, y: (v2.y - v1.y) / h, z: (v2.z - v1.z) / h };
  const along = accel.x * forward.x + accel.y * forward.y + accel.z * forward.z;
  const turn = { x: accel.x - along * forward.x, y: accel.y - along * forward.y + 9.8 * 40, z: accel.z - along * forward.z };
  const lift = turn.x * forward.x + turn.y * forward.y + turn.z * forward.z;
  let up = { x: turn.x - lift * forward.x, y: turn.y - lift * forward.y, z: turn.z - lift * forward.z };
  const upLength = Math.hypot(up.x, up.y, up.z) || 1;
  up = { x: up.x / upLength, y: up.y / upLength, z: up.z / upLength };
  // Right wing: up × forward.
  const right = { x: up.y * forward.z - up.z * forward.y, y: up.z * forward.x - up.x * forward.z, z: up.x * forward.y - up.y * forward.x };
  return { forward, right, up, speed: PEN_SPEED };
}

// ---------------------------------------------------------------------------
// The model, in its own frame: x forward, y to the right wing, z up, m.
// ---------------------------------------------------------------------------

export const PLANE_COLORS = ['#C23A2B', '#EFE7D6', '#2B3540', '#3A3836'] as const;
// Indices into PLANE_COLORS.
const RED = 0;
const CREAM = 1;
const GLASS = 2;
const DARK = 3;

export interface Model {
  vertices: number[][];
  faces: { points: number[]; color: number }[];
}

function buildModel(): Model {
  const vertices: number[][] = [];
  const faces: { points: number[]; color: number }[] = [];
  const add = (v: number[]) => vertices.push(v) - 1;
  // Fuselage: rings round the body from nose to tail, each ring 8 points.
  const SIDES = 8;
  const stations = [
    { x: 3.05, r: 0.16, z: 0.0 },
    { x: 2.85, r: 0.46, z: 0.0 },
    { x: 2.2, r: 0.58, z: 0.02 },
    { x: 0.6, r: 0.62, z: 0.05 },
    { x: -0.8, r: 0.48, z: 0.08 },
    { x: -2.3, r: 0.24, z: 0.16 },
    { x: -3.3, r: 0.1, z: 0.2 },
  ];
  const rings = stations.map((station) =>
    Array.from({ length: SIDES }, (_, k) => {
      const angle = (k / SIDES) * Math.PI * 2;
      return add([station.x, station.r * Math.cos(angle), station.z + station.r * 1.1 * Math.sin(angle)]);
    }),
  );
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < SIDES; k++) {
      const k1 = (k + 1) % SIDES;
      faces.push({ points: [rings[i][k], rings[i + 1][k], rings[i + 1][k1], rings[i][k1]], color: RED });
    }
  }
  // The spinner at the nose, and the tail's end.
  const nose = add([3.35, 0, 0]);
  for (let k = 0; k < SIDES; k++) faces.push({ points: [nose, rings[0][k], rings[0][(k + 1) % SIDES]], color: DARK });
  faces.push({ points: [...rings[rings.length - 1]].reverse(), color: RED });
  // A slab: a flat box from its outline on top, `thick` deep.
  const slab = (outline: number[][], thick: number, color: number, axis: 'z' | 'y') => {
    const top = outline.map((p) => add(p));
    const bottom = outline.map((p) => add(axis === 'z' ? [p[0], p[1], p[2] - thick] : [p[0], p[1] - thick, p[2]]));
    faces.push({ points: top, color });
    faces.push({ points: [...bottom].reverse(), color });
    for (let i = 0; i < outline.length; i++) {
      const j = (i + 1) % outline.length;
      faces.push({ points: [top[j], top[i], bottom[i], bottom[j]], color });
    }
  };
  // Wings, low on the body, with a little dihedral; cream with red tips.
  for (const side of [-1, 1]) {
    const tipZ = -0.2;
    const rootZ = -0.42;
    const pts = [
      [1.55, 0.3 * side, rootZ],
      [1.25, 3.4 * side, tipZ],
      [0.45, 3.4 * side, tipZ],
      [0.05, 0.3 * side, rootZ],
    ];
    slab(side > 0 ? pts : [...pts].reverse(), 0.14, CREAM, 'z');
    const tip = [
      [1.25, 3.4 * side, tipZ],
      [1.15, 4.0 * side, tipZ + 0.04],
      [0.55, 4.0 * side, tipZ + 0.04],
      [0.45, 3.4 * side, tipZ],
    ];
    slab(side > 0 ? tip : [...tip].reverse(), 0.12, RED, 'z');
  }
  // Tailplane.
  for (const side of [-1, 1]) {
    const pts = [
      [-2.55, 0.15 * side, 0.2],
      [-2.95, 1.5 * side, 0.22],
      [-3.3, 1.5 * side, 0.22],
      [-3.35, 0.15 * side, 0.2],
    ];
    slab(side > 0 ? pts : [...pts].reverse(), 0.07, CREAM, 'z');
  }
  // Fin, standing up from the tail.
  slab(
    [
      [-2.25, 0.04, 0.42],
      [-2.95, 0.04, 1.5],
      [-3.35, 0.04, 1.5],
      [-3.4, 0.04, 0.3],
    ],
    0.08,
    RED,
    'y',
  );
  // Canopy: a low glazed hump over the cockpit.
  const canopy = [
    add([1.0, 0, 0.62]),
    add([0.5, -0.32, 0.6]),
    add([0.3, 0, 1.02]),
    add([0.5, 0.32, 0.6]),
    add([-0.6, -0.3, 0.55]),
    add([-0.6, 0.3, 0.55]),
    add([-0.4, 0, 0.92]),
  ];
  const [c0, c1, c2, c3, c4, c5, c6] = canopy;
  faces.push({ points: [c0, c1, c2], color: GLASS });
  faces.push({ points: [c0, c2, c3], color: GLASS });
  faces.push({ points: [c1, c4, c6, c2], color: GLASS });
  faces.push({ points: [c3, c2, c6, c5], color: GLASS });
  return { vertices, faces };
}

export const PLANE_MODEL = buildModel();
