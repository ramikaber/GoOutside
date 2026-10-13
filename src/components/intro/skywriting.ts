// "GoOutside", written across the sky in smoke by the plane.
//
// The word is a single-stroke cursive script, drawn as the plane flies it:
// a few strokes, with the smoke off for the short hops between them (to the
// next letter, to cross the t, to dot the i). The smoke stays where the
// plane left it, fixed in the sky facing us, as agreed: the plane keeps
// pace with us, so the word does too.
//
// Letters are laid out in their own units: x to the right, y down, the
// baseline at 0 and the x-height at -1 (capitals and ascenders reach -2).

// When the plane starts writing and when it finishes, s.
export const WRITE_FROM = 4.3;
export const WRITE_TO = 5.6;

// The smoke trail, as the plane flies it: strokes with the smoke on, in
// order. Between strokes it hops, smoke off, to the next one's start.
const STROKES = [
  // G: out along its bar, down and round, up the left side and over the
  // top, so the plane comes into it from the left.
  'M 0.98 -0.86 C 1.10 -0.86 1.24 -0.86 1.36 -0.86 C 1.37 -0.80 1.37 -0.72 1.36 -0.62 C 1.32 -0.10 0.80 0.18 0.42 -0.08 C 0.00 -0.40 0.02 -1.28 0.34 -1.70 C 0.62 -2.06 1.18 -1.98 1.30 -1.62',
  // o, and a flick out of it.
  'M 2.18 -0.92 C 1.92 -1.08 1.52 -0.80 1.55 -0.38 C 1.58 0.04 2.10 0.06 2.22 -0.36 C 2.30 -0.66 2.20 -0.98 1.98 -0.96 C 2.12 -0.95 2.28 -0.98 2.42 -1.04',
  // O, clockwise from the top, closing just inside where it began.
  'M 3.30 -1.99 C 3.75 -2.00 3.92 -1.40 3.88 -0.90 C 3.84 -0.30 3.50 0.04 3.12 0.00 C 2.70 -0.04 2.55 -0.55 2.62 -1.05 C 2.70 -1.60 3.05 -1.92 3.45 -1.88',
  // u, running on up into the t's stem and down again.
  'M 4.05 -1.00 C 4.00 -0.50 4.02 -0.04 4.38 -0.02 C 4.70 0.00 4.80 -0.48 4.84 -1.00 C 4.84 -0.60 4.84 -0.26 4.88 -0.12 C 4.94 0.02 5.08 -0.02 5.18 -0.22 C 5.26 -0.60 5.32 -1.30 5.36 -1.78 C 5.36 -1.30 5.36 -0.50 5.40 -0.15 C 5.44 0.02 5.62 0.00 5.72 -0.18',
  // The t's crossbar.
  'M 5.08 -1.10 C 5.30 -1.12 5.50 -1.12 5.72 -1.10',
  // s, rising to its point and closing at the baseline, then the i.
  'M 5.76 -0.16 C 5.86 -0.50 5.94 -0.86 6.04 -1.04 C 6.22 -0.80 6.38 -0.48 6.26 -0.22 C 6.14 0.02 5.84 0.02 5.80 -0.14 C 6.06 -0.04 6.36 -0.06 6.54 -0.26 C 6.64 -0.55 6.70 -0.85 6.74 -1.00 C 6.74 -0.60 6.74 -0.25 6.78 -0.12 C 6.84 0.02 6.98 -0.02 7.06 -0.20',
  // The i's dot.
  'M 6.72 -1.46 C 6.75 -1.47 6.78 -1.48 6.81 -1.49',
  // d, running on into the e.
  'M 7.55 -0.92 C 7.30 -1.08 7.00 -0.80 7.02 -0.40 C 7.04 0.02 7.50 0.04 7.60 -0.40 C 7.66 -0.90 7.70 -1.50 7.72 -2.00 C 7.72 -1.40 7.70 -0.60 7.74 -0.14 C 7.80 0.02 7.94 -0.02 8.02 -0.25 C 8.20 -0.35 8.48 -0.55 8.42 -0.80 C 8.36 -1.05 8.00 -1.00 8.02 -0.55 C 8.04 -0.05 8.45 0.05 8.75 -0.25',
];

// How far the letters lean forward: x moves this much right per unit up.
const SLANT = 0.16;

// The word's extent in its units, for laying it out on screen.
export const WORD = { left: 0, right: 9.1, top: -2.1, bottom: 0.1 };

export interface PenPoint {
  x: number;
  y: number;
  along: number; // distance along the whole flight, units
  smoke: boolean; // whether the smoke is on here
}

type Point = [number, number];

function parse(d: string): Point[][] {
  // Each path is one M followed by cubic (C) segments; returns each
  // segment's four control points.
  const numbers = d.match(/-?\d*\.?\d+/g)!.map(Number);
  const segments: Point[][] = [];
  let at: Point = [numbers[0], numbers[1]];
  for (let i = 2; i + 5 < numbers.length; i += 6) {
    const segment: Point[] = [at, [numbers[i], numbers[i + 1]], [numbers[i + 2], numbers[i + 3]], [numbers[i + 4], numbers[i + 5]]];
    segments.push(segment);
    at = segment[3];
  }
  return segments;
}

const slant = ([x, y]: Point): Point => [x - SLANT * y, y];

function bezier(p: Point[], t: number): Point {
  const u = 1 - t;
  return [
    u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0],
    u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1],
  ];
}

// The whole flight through the word, finely sampled: each stroke, and a
// smooth hop between each stroke's end and the next one's start, leaving
// the one in the direction it was going and arriving in the other's.
export const PEN_PATH: PenPoint[] = (() => {
  const strokes = STROKES.map((d) => parse(d).map((segment) => segment.map(slant)));
  const points: PenPoint[] = [];
  let along = 0;
  const add = (segment: Point[], smoke: boolean) => {
    const steps = 32;
    for (let k = points.length ? 1 : 0; k <= steps; k++) {
      const [x, y] = bezier(segment, k / steps);
      if (points.length) {
        const last = points[points.length - 1];
        along += Math.hypot(x - last.x, y - last.y);
      }
      points.push({ x, y, along, smoke });
    }
  };
  const direction = (a: Point, b: Point): Point => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  };
  strokes.forEach((stroke, index) => {
    if (index > 0) {
      const previous = strokes[index - 1];
      const end = previous[previous.length - 1];
      const from = end[3];
      const to = stroke[0][0];
      const leave = direction(end[2], end[3]);
      const arrive = direction(stroke[0][0], stroke[0][1]);
      const reach = Math.hypot(to[0] - from[0], to[1] - from[1]) * 0.45 + 0.15;
      add(
        [from, [from[0] + leave[0] * reach, from[1] + leave[1] * reach], [to[0] - arrive[0] * reach, to[1] - arrive[1] * reach], to],
        false,
      );
    }
    for (const segment of stroke) add(segment, true);
  });
  return points;
})();

// How much faster the plane flies the hops than the letters.
const HOP_SPEED = 1.6;

// The plane eases into the word: it starts writing at RAMP_FROM of its
// full speed and is up to speed after RAMP seconds. Measured on the flight
// at full speed ("flight time"), that start takes RAMP_DEFICIT less than
// on the clock.
const WRITE_SECONDS = WRITE_TO - WRITE_FROM;
const RAMP = 0.18;
const RAMP_FROM = 0.2;
const RAMP_DEFICIT = ((1 - RAMP_FROM) * RAMP) / 2;
const FLIGHT_SECONDS = WRITE_SECONDS - RAMP_DEFICIT;

// Flight time reached `elapsed` seconds into the writing.
export function flightTime(elapsed: number): number {
  'worklet';
  if (elapsed >= RAMP) return elapsed - RAMP_DEFICIT;
  const u = Math.max(elapsed, 0) / RAMP;
  // The integral of a speed rising from RAMP_FROM to 1 along smoothstep.
  return RAMP_FROM * elapsed + (1 - RAMP_FROM) * RAMP * (u * u * u - (u * u * u * u) / 2);
}

// And back: the seconds into the writing when the flight reaches `flight`.
function elapsedFor(flight: number): number {
  let lo = 0;
  let hi = WRITE_SECONDS;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (flightTime(mid) < flight) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// The flight measured in time: how far along the path the plane is at
// each sampled point, in flight time.
const timeline = (() => {
  let smokeLength = 0;
  let hopLength = 0;
  for (let i = 1; i < PEN_PATH.length; i++) {
    const step = PEN_PATH[i].along - PEN_PATH[i - 1].along;
    if (PEN_PATH[i].smoke && PEN_PATH[i - 1].smoke) smokeLength += step;
    else hopLength += step;
  }
  const speed = (smokeLength + hopLength / HOP_SPEED) / FLIGHT_SECONDS;
  const times = [0];
  for (let i = 1; i < PEN_PATH.length; i++) {
    const step = PEN_PATH[i].along - PEN_PATH[i - 1].along;
    const smoke = PEN_PATH[i].smoke && PEN_PATH[i - 1].smoke;
    times.push(times[i - 1] + step / (smoke ? speed : speed * HOP_SPEED));
  }
  return { times, speed };
})();
export const PEN_TIMES = timeline.times;
// How fast the plane writes, units per second.
export const PEN_SPEED = timeline.speed;

// Where the pen is `time` seconds into the intro, in the word's units,
// clamped to the ends of the word.
export function penAt(time: number): { x: number; y: number } {
  'worklet';
  const t = flightTime(Math.min(Math.max(time - WRITE_FROM, 0), WRITE_SECONDS));
  // Binary search for the sample just before t.
  let lo = 0;
  let hi = PEN_TIMES.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (PEN_TIMES[mid] <= t) lo = mid;
    else hi = mid;
  }
  const span = PEN_TIMES[hi] - PEN_TIMES[lo] || 1;
  const k = Math.min(Math.max((t - PEN_TIMES[lo]) / span, 0), 1);
  return {
    x: PEN_PATH[lo].x + (PEN_PATH[hi].x - PEN_PATH[lo].x) * k,
    y: PEN_PATH[lo].y + (PEN_PATH[hi].y - PEN_PATH[lo].y) * k,
  };
}

// How far along the flight the plane's nose is at `time`, units; and the
// point `back` units behind that along the flight (where its tail is), or
// null if that's before the flight's start.
export function alongAt(time: number): number {
  'worklet';
  const t = flightTime(Math.min(Math.max(time - WRITE_FROM, 0), WRITE_SECONDS));
  let lo = 0;
  let hi = PEN_TIMES.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (PEN_TIMES[mid] <= t) lo = mid;
    else hi = mid;
  }
  const span = PEN_TIMES[hi] - PEN_TIMES[lo] || 1;
  const k = Math.min(Math.max((t - PEN_TIMES[lo]) / span, 0), 1);
  return PEN_PATH[lo].along + (PEN_PATH[hi].along - PEN_PATH[lo].along) * k;
}

export function pointAlong(along: number): { x: number; y: number } | null {
  'worklet';
  if (along < 0) return null;
  let lo = 0;
  let hi = PEN_PATH.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (PEN_PATH[mid].along <= along) lo = mid;
    else hi = mid;
  }
  const span = PEN_PATH[hi].along - PEN_PATH[lo].along || 1;
  const k = Math.min(Math.max((along - PEN_PATH[lo].along) / span, 0), 1);
  return { x: PEN_PATH[lo].x + (PEN_PATH[hi].x - PEN_PATH[lo].x) * k, y: PEN_PATH[lo].y + (PEN_PATH[hi].y - PEN_PATH[lo].y) * k };
}

// The smoke: puffs laid along the smoke-on parts of the flight, each let
// out as the plane's tail passes, a little off the line at random so the
// trail is uneven, as smoke is.
export interface Puff {
  x: number;
  y: number;
  born: number; // s into the intro
  size: number; // relative size, around 1
  shade: number; // 0 lightest .. 1 greyest
}

// Puffs this far apart along the trail, units.
const PUFF_SPACING = 0.045;
// How far behind the plane's middle its tail is, in the word's units.
export const TAIL_BEHIND = 0.32;

export const PUFFS: Puff[] = (() => {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const puffs: Puff[] = [];
  let next = 0;
  for (let i = 1; i < PEN_PATH.length; i++) {
    const a = PEN_PATH[i - 1];
    const b = PEN_PATH[i];
    if (!a.smoke || !b.smoke) {
      next = b.along;
      continue;
    }
    while (next <= b.along) {
      const k = (next - a.along) / (b.along - a.along || 1);
      const x = a.x + (b.x - a.x) * k;
      const y = a.y + (b.y - a.y) * k;
      // Let out when the tail reaches here: when the plane's middle is
      // TAIL_BEHIND further along.
      const ahead = next + TAIL_BEHIND;
      let j = i;
      while (j < PEN_PATH.length - 1 && PEN_PATH[j].along < ahead) j++;
      const reach = PEN_PATH[j].along - PEN_PATH[j - 1].along || 1;
      const flight =
        ahead > PEN_PATH[PEN_PATH.length - 1].along
          ? FLIGHT_SECONDS + (ahead - PEN_PATH[PEN_PATH.length - 1].along) / PEN_SPEED
          : PEN_TIMES[j - 1] + (PEN_TIMES[j] - PEN_TIMES[j - 1]) * Math.min(Math.max((ahead - PEN_PATH[j - 1].along) / reach, 0), 1);
      const t = flight > FLIGHT_SECONDS ? WRITE_SECONDS + flight - FLIGHT_SECONDS : elapsedFor(flight);
      const angle = random() * Math.PI * 2;
      const off = random() * 0.05;
      puffs.push({
        x: x + Math.cos(angle) * off,
        y: y + Math.sin(angle) * off,
        born: WRITE_FROM + t,
        size: 0.8 + random() * 0.4,
        shade: random(),
      });
      next += PUFF_SPACING;
    }
  }
  return puffs;
})();

// How big a puff is, in the word's units, `age` seconds after it was let
// out: small at the tail, swelling as it spreads.
export const PUFF_START = 0.04;
export const PUFF_FULL = 0.15;
export function puffRadius(age: number, size: number): number {
  'worklet';
  if (age <= 0) return 0;
  return size * (PUFF_FULL - (PUFF_FULL - PUFF_START) * Math.exp(-age / 0.45));
}
