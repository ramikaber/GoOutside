// The intro's world and the one camera that looks at it.
//
// Everything lives at a fixed spot on the ground, in metres: `x` across the
// trail (0 is its centre line, positive to the right) and `s` along it (how
// far down the trail from where the walk starts). The camera stands on the
// trail's centre line and moves forward in `s`; nothing else moves. What
// makes things approach is the camera moving past them, and what makes them
// come into view is the ground curving away — the world is a small globe, so
// anything far enough off is hidden below the horizon's crest and rises over
// it as we close in, tip first.
//
// The globe is approximated by a paraboloid, which is indistinguishable at
// these distances: the ground a distance (x, z) from the camera's feet sits
// (x² + z²) / 2R below it.
//
// The camera is level (it never pitches), so anything upright projects with
// vertical edges kept vertical, and a flat, camera-facing drawing of a tree
// is exactly what a real tree would look like from here. The horizon is placed
// on screen by shifting the lens, not by tilting the camera.

import { BEAR_TREE } from './bear';
import { DEER_SPEED } from './deer';
import { CLIFF_COLUMNS, CLIFF_HEIGHT, CLIFF_X, FACE_S0, FACE_S1, HORSESHOE, PLATEAU_SETBACK, onPlateau, pondReach, rockX } from './falls';
import { BOULDERS, GRANITE_RADIUS, LIGHTHOUSE_FOOTING, LIGHTHOUSE_HEIGHT, LIGHTHOUSE_S, LIGHTHOUSE_X } from './lighthouse';
import { BRIDGE, STREAM_HALF_WIDTH, onBridge, streamDistance } from './stream';
import { SIDE_PATH_HALF_WIDTH, TOWER_HEIGHT, TOWER_S, TOWER_X } from './tower';

export const CAMERA = {
  // Eye height above the trail, m.
  eyeHeight: 1.6,
  // Focal length as a multiple of screen width; ~49° across.
  focal: 1.15,
  // Where eye level sits on screen, as a fraction of its height from the top.
  // The horizon's crest is a little below it, since the ground curves away.
  eyeLine: 0.44,
  // Globe radius, m. Sets how far off the horizon is: √(2·R·eyeHeight) ≈ 29 m.
  globeRadius: 260,
  // Forward speed, m/s.
  speed: 18,
  // Head bob: how far the eye rises and falls, m, and how often, per second.
  bob: 0.025,
  bobRate: 2.2,
};

// Sprites nearer than this aren't drawn; by then they're well off-screen.
export const NEAR = 0.8;

// The trail's half-width, m, before its edge wanders a little.
export const PATH_HALF_WIDTH = 0.5;

// How long the walk lasts, s: the whole intro, per the agreed timeline.
export const RUN_SECONDS = 6.9;

// How much of its color a sprite or the ground gives up to haze at the
// horizon. Kept low so distant trees still read as solid, formed trees.
export const MAX_HAZE = 0.45;

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

export interface Camera {
  s: number; // position along the trail, m
  eyeHeight: number; // m, including head bob
  focal: number; // px
  cx: number; // screen x of straight ahead, px
  cy: number; // screen y of eye level, px
  width: number;
  height: number;
  time: number; // s since the start
}

export function cameraAt(time: number, width: number, height: number): Camera {
  'worklet';
  return {
    s: CAMERA.speed * time,
    eyeHeight: CAMERA.eyeHeight + CAMERA.bob * Math.sin(time * CAMERA.bobRate * Math.PI * 2),
    focal: CAMERA.focal * width,
    cx: width / 2,
    cy: height * CAMERA.eyeLine,
    width,
    height,
    time,
  };
}

// How far the ground at (x, z) from the camera's feet has dropped away, m.
export function groundDrop(x: number, z: number): number {
  'worklet';
  return (x * x + z * z) / (2 * CAMERA.globeRadius);
}

// The horizon's crest in the direction whose slope across the view is
// `slope` (x / z): how far off it is, m, and where it sits on screen, px.
// Anything further off than `distance` is hidden below the screen line `y`.
export function crestAt(camera: Camera, slope: number): { distance: number; y: number } {
  'worklet';
  const a = (1 + slope * slope) / (2 * CAMERA.globeRadius);
  return {
    distance: Math.sqrt(camera.eyeHeight / a),
    y: camera.cy + camera.focal * Math.sqrt(4 * a * camera.eyeHeight),
  };
}

// The crest straight ahead, for haze: at this distance things are as hazy
// as they get.
export function hazeAt(camera: Camera, z: number): number {
  'worklet';
  const horizon = Math.sqrt(2 * CAMERA.globeRadius * camera.eyeHeight);
  const k = Math.min(Math.max(z / (horizon * 1.15), 0), 1);
  return k * k * MAX_HAZE;
}

// Where the trail's edge is at `s`: its half-width, wandering slightly.
// The ground shader uses the same formula.
export function pathEdge(s: number): number {
  'worklet';
  return PATH_HALF_WIDTH + 0.05 * Math.sin(0.9 * s) + 0.035 * Math.sin(2.3 * s + 1);
}

// ---------------------------------------------------------------------------
// World layout
// ---------------------------------------------------------------------------

export const SPRITE_TREE = 0;
export const SPRITE_ROCK = 1;
export const SPRITE_TUFT = 2;
export const SPRITE_DEER = 3;
export const SPRITE_HIKER = 4;
export const SPRITE_TOWER = 5;
export const SPRITE_BEAR = 6;
// A column of the escarpment's rock face, with the falls' water in front of
// it where they pour; `variant` is its index in CLIFF_COLUMNS.
export const SPRITE_CLIFF = 7;
// The footbridge where the stream passes under the trail.
export const SPRITE_BRIDGE = 8;
// Peggy's Cove lighthouse.
export const SPRITE_LIGHTHOUSE = 9;
// The bear's tree isn't one of the scattered forest trees; it's drawn as a
// tree with this id.
export const BEAR_TREE_ID = 100000;

// Two trees just past the bear's, near the trail, placed by hand like it:
// while the bear climbs and the birds burst out they stand between us and
// the lighthouse, so it doesn't take the eye from them, and by the time we
// see the lighthouse whole they've slid away to our left. Their ids follow
// the bear tree's.
export const SCREEN_TREES = [
  { x: -2.9, s: 66, height: 6.5, variant: 0, tone: 1, phase: 2.1 },
  { x: -4, s: 68, height: 10, variant: 1, tone: 0, phase: 4.4 },
];

// The deer is this far along the trail and trots straight across it, left
// to right. When the intro opens it's coming out of the trees on the left;
// it's on the trail at about 0.75 s, 9 m ahead, and 2 m to the right of it
// when we pass at 1.25 s.
export const DEER_S = 22.5;
const DEER_START_X = -3;

// The hiker stands just off the trail's left edge, facing us, this far
// along it. We draw level at about 2.1 s.
export const HIKER_S = 38.1;
export const HIKER_X = -1.15;

// Where the deer is across the trail at `time`, m.
export function deerX(time: number): number {
  'worklet';
  return DEER_START_X + DEER_SPEED * time;
}

export interface Sprite {
  kind: number;
  x: number; // m across the trail
  s: number; // m along it
  size: number; // m: a tree's height, a rock's width, a tuft's height
  variant: number; // which shape
  tone: number; // which coloring
  phase: number; // for sway, radians
  xScale: number; // width relative to height; negative mirrors it
  id: number; // a tree's index in FOREST; -1 for everything else
  lift: number; // how far above the ground it stands, m: on the plateau, the cliff's height
}

// Deterministic, so the world is identical every launch.
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ROCK_VARIANTS = 6;
export const ROCK_TONES = 3;
// The granite boulders round the lighthouse have a tone of their own, past
// the ones rocks are given at random.
export const GRANITE_TONE = 3;
export const TUFT_VARIANTS = 5;
export const TUFT_COLORS = 3;
export const TREE_VARIANTS = 4;
export const TREE_TONES = 3;

// How far a tree's lowest, widest branches reach either side of its trunk,
// per metre of height, by variant (pine, spruce, fir, mature pine), with a
// little to spare, and how high up those branches start, per metre of
// height. Used to keep every crown clear of the trail below head height.
const CROWN_REACH = [0.25, 0.21, 0.29, 0.23];
const CROWN_BASE = [0.14, 0.1, 0.16, 0.46];
const MATURE_PINE = 3;
// Branches this high can reach over the trail, m.
const OVERHEAD = 3.4;
// No trunk stands closer than this to the trail's centre line, m.
const TRUNK_CLEARANCE = 1.3;
// Nothing overhangs closer than this to the trail's centre line, m.
const CLEARANCE = PATH_HALF_WIDTH + 0.45;

// The forest, in three bands either side of the trail by distance from it:
// near trees, starting with young ones right at the trail's edge; a middle
// band of taller trees; and a far band that mostly shows as the treeline
// on the horizon. `spacing` is roughly how close trees in a band stand.
// Mature pines, a share of each band, are taller: `matureHeight`.
// Open ground kept clear of trees so a beat isn't hidden behind a trunk. x
// is signed, negative to the left of the trail, m.
export const CLEARINGS = [
  // Where the deer crosses, both sides of the trail.
  { name: 'deer', x: [-5, 5], s: [19.5, 25] },
  // The hiker's stretch of the left verge, and the line of sight to it.
  { name: 'hiker', x: [-4, -1.2], s: [28, 41.5] },
  // The glade the CN Tower stands in, between clusters of trees, and the
  // line of sight to it along the right side of the trail.
  { name: 'tower', x: [1.5, 16], s: [30, 66] },
  // Round the bear's tree, and the line of sight to it from the trail.
  { name: 'bear', x: [-5.5, -1.3], s: [50, 65] },
  // The meadow and pond between the trail and the falls, and the line of
  // sight to them as we come up to them.
  { name: 'falls', x: [1.5, CLIFF_X + HORSESHOE], s: [FACE_S0 - 12, FACE_S1 + 2] },
];

// Past the stream the trail comes out of the forest into a meadow, open
// sky above it for the skywriting. From a ragged edge about `from` along
// the trail, the trees stand back from it, startWidth either side at
// first and widening by `widening` per metre to at most halfWidth: so the
// forest gives way gradually, and no tree tall enough to cover any of the
// word stands in front of it while it's in the sky.
export const MEADOW = { from: 88, startWidth: 4, widening: 0.4, halfWidth: 18 };

// How far either side of the trail the meadow reaches at s, m.
export function meadowWidth(s: number): number {
  'worklet';
  return Math.min(MEADOW.halfWidth, MEADOW.startWidth + MEADOW.widening * Math.max(s - MEADOW.from, 0));
}

// Where the forest gives way to the meadow, m along the trail, at x.
export function meadowEdge(x: number): number {
  'worklet';
  return MEADOW.from + 3 * Math.sin(0.45 * x) + 2 * Math.sin(1.3 * x + 1);
}

function inMeadow(x: number, s: number) {
  return Math.abs(x) < meadowWidth(s) && s > meadowEdge(x);
}

// Trees on the plateau keep back from its edge.
function atCliffEdge(x: number, s: number) {
  return x > rockX(s) - 0.5 && x < rockX(s) + PLATEAU_SETBACK;
}

// No tree stands in the stream or right on its banks.
function byStream(x: number, s: number) {
  return streamDistance(x, s) < STREAM_HALF_WIDTH + 1.4;
}

// Nor any stone or grass in the water, or on the bridge.
function inStream(x: number, s: number) {
  return streamDistance(x, s) < STREAM_HALF_WIDTH + 0.35 || onBridge(x, s);
}

// Where the path to the tower's plaza leaves the trail, on its right side.
function onSidePath(x: number, s: number) {
  return x > 0 && Math.abs(s - TOWER_S) < SIDE_PATH_HALF_WIDTH + 0.3;
}

function inClearing(x: number, s: number) {
  return CLEARINGS.some((c) => x >= c.x[0] && x <= c.x[1] && s >= c.s[0] && s <= c.s[1]);
}

export const FOREST_LAYERS = [
  { name: 'near', from: 1.6, to: 8, spacing: 3.6, height: [6.5, 13], mature: 0.3, matureHeight: [14, 20] },
  { name: 'middle', from: 8, to: 18, spacing: 3.4, height: [12, 20], mature: 0.4, matureHeight: [18, 26] },
  { name: 'far', from: 18, to: 30, spacing: 4, height: [15, 24], mature: 0.3, matureHeight: [18, 26] },
] as const;

// Smooth 1D noise in 0–1, for where trees clump and where they thin out.
function clumping(random: () => number, length: number, scale: number) {
  const knots = Array.from({ length: Math.ceil(length / scale) + 2 }, random);
  return (s: number) => {
    const at = Math.max(s, 0) / scale;
    const i = Math.floor(at);
    const f = at - i;
    const u = f * f * (3 - 2 * f);
    return knots[i] * (1 - u) + knots[i + 1] * u;
  };
}

export interface Tree {
  x: number;
  s: number;
  height: number;
  variant: number;
  layer: number; // index into FOREST_LAYERS
}

// Scatters trees at random, keeping each a band's spacing from the others
// and thinning them unevenly along the trail, so they gather in clumps with
// thinner stretches between instead of standing in rows. The near band thins
// the most, leaving openings to see the taller bands behind it through.
function plantForest(): Tree[] {
  const random = seeded(4121);
  const trees: Tree[] = [];
  // Far enough ahead that the treeline is still full at the end of the walk.
  const start = -8;
  const end = CAMERA.speed * RUN_SECONDS + 125;
  const CELL = 4;
  for (const side of [-1, 1]) {
    const thin = clumping(random, end + 10, 16);
    const cells = new Map<string, { x: number; s: number }[]>();
    const tooClose = (x: number, s: number, gap: number) => {
      const reach = Math.ceil(gap / CELL);
      const cx = Math.floor(x / CELL);
      const cs = Math.floor(s / CELL);
      for (let i = cx - reach; i <= cx + reach; i++) {
        for (let j = cs - reach; j <= cs + reach; j++) {
          for (const other of cells.get(`${i},${j}`) ?? []) {
            if (Math.hypot(other.x - x, other.s - s) < gap) return true;
          }
        }
      }
      return false;
    };
    FOREST_LAYERS.forEach((layer, index) => {
      const attempts = Math.round((((layer.to - layer.from) * (end - start)) / layer.spacing ** 2) * 3);
      for (let attempt = 0; attempt < attempts; attempt++) {
        const x = layer.from + random() * (layer.to - layer.from);
        const s = start + random() * (end - start);
        const clump = thin(s);
        if (random() > (index === 0 ? 0.1 + 0.9 * clump * clump : 0.35 + 0.65 * clump)) continue;
        if (tooClose(x, s, layer.spacing * (0.85 + 0.3 * random()))) continue;
        const mature = random() < layer.mature;
        const variant = mature ? MATURE_PINE : Math.floor(random() * MATURE_PINE);
        const [low, high] = mature ? layer.matureHeight : layer.height;
        let height = low + random() * (high - low);
        // Near the trail a tree grows only as tall as fits: its crown
        // narrows with its height, and anything below head height must stay
        // clear of the trail. A mature pine's branches start high enough to
        // reach over it.
        const reach = CROWN_REACH[variant] * 1.2; // allows for the widest xScale
        if (CROWN_BASE[variant] * height < OVERHEAD) height = Math.min(height, (x - CLEARANCE) / reach);
        if (height < 2 || x < TRUNK_CLEARANCE || inClearing(side * x, s) || atCliffEdge(side * x, s) || byStream(side * x, s)) continue;
        const key = `${Math.floor(x / CELL)},${Math.floor(s / CELL)}`;
        cells.set(key, [...(cells.get(key) ?? []), { x, s }]);
        trees.push({ x: side * x, s, height, variant, layer: index });
      }
    });
  }
  return trees;
}

// While we see the lighthouse whole, across from the falls, s: its view is
// kept clear of trees.
export const LIGHTHOUSE_VIEW = [3.4, 3.8];

// Whether a tree stands on the lighthouse's granite, or in front of the
// lighthouse while we see it whole. Each moment of that view, the tree's
// trunk and crown (a triangle from its lowest, widest branches up to its
// tip) are projected, and if either overlaps the lighthouse it goes; a tree
// that only ever stands beside it or behind it stays. Checked against
// renders, this takes out the trees that really cover it, and one fir whose
// lowest branches only just miss.
function hidesLighthouse(tree: Tree): boolean {
  if (Math.hypot(tree.x - LIGHTHOUSE_X, tree.s - LIGHTHOUSE_S) < GRANITE_RADIUS + 0.5) return true;
  const halfWidth = LIGHTHOUSE_FOOTING.radius * LIGHTHOUSE_HEIGHT;
  const reach = CROWN_REACH[tree.variant] * tree.height;
  const crownBase = CROWN_BASE[tree.variant] * tree.height;
  const trunk = 0.04 * tree.height;
  for (let t = LIGHTHOUSE_VIEW[0]; t <= LIGHTHOUSE_VIEW[1] + 1e-6; t += 0.05) {
    const camS = CAMERA.speed * t;
    const z = tree.s - camS;
    const lz = LIGHTHOUSE_S - camS;
    if (z <= 0.2 || z >= lz) continue;
    // Directions across the view (x / z) and heights above eye level per
    // metre ahead, for the lighthouse and for the tree.
    const lDrop = (LIGHTHOUSE_X * LIGHTHOUSE_X + lz * lz) / (2 * CAMERA.globeRadius);
    const across = [(LIGHTHOUSE_X - halfWidth) / lz, (LIGHTHOUSE_X + halfWidth) / lz];
    const rises = [(-CAMERA.eyeHeight - lDrop) / lz, (LIGHTHOUSE_HEIGHT - CAMERA.eyeHeight - lDrop) / lz];
    const drop = (tree.x * tree.x + z * z) / (2 * CAMERA.globeRadius);
    const rise = (h: number) => (h - CAMERA.eyeHeight - drop) / z;
    const centre = tree.x / z;
    // The trunk, up to the lowest branches.
    if (centre + trunk / z > across[0] && centre - trunk / z < across[1] && rise(0) < rises[1] && rise(crownBase) > rises[0]) return true;
    // The crown: its widest, over the height the lighthouse spans.
    const low = Math.max(rise(crownBase), rises[0]);
    const high = Math.min(rise(tree.height), rises[1]);
    if (low > high) continue;
    const spread = (reach / z) * (1 - (low - rise(crownBase)) / (rise(tree.height) - rise(crownBase)));
    if (centre + spread > across[0] && centre - spread < across[1]) return true;
  }
  return false;
}

// The meadow, and the lighthouse's granite and view, are cleared after the
// forest is planted, not while: taking a tree out during planting would let
// others grow in its place and change every tree planted after it, the
// whole length of the walk.
const PLANTED = plantForest();
const cleared = (tree: Tree) => inMeadow(tree.x, tree.s) || hidesLighthouse(tree);
export const FOREST = PLANTED.filter((tree) => !cleared(tree));

// Four near trees to ring on the ground in the debug view, spread along the
// walk.
export const DEBUG_SPOTS = [16, 40, 70, 100].map((target) => {
  let best = FOREST[0];
  for (const tree of FOREST) {
    if (tree.layer === 0 && Math.abs(tree.s - target) < Math.abs(best.s - target)) best = tree;
  }
  return best;
});

function buildWorld(): Sprite[] {
  const random = seeded(20260929);
  const sprites: Sprite[] = [];
  const horizon = Math.sqrt(2 * CAMERA.globeRadius * CAMERA.eyeHeight);
  // Far enough that nothing short is still to come over the horizon when
  // the walk ends.
  const end = CAMERA.speed * RUN_SECONDS + horizon + 20;

  // Every planted tree draws its look, cleared or not, so the trees that
  // stay look just as they did before the meadow was cleared.
  let id = 0;
  PLANTED.forEach((tree) => {
    const tone = Math.floor(random() * TREE_TONES);
    const phase = random() * Math.PI * 2;
    const xScale = (0.85 + random() * 0.35) * (random() < 0.5 ? -1 : 1);
    if (cleared(tree)) return;
    sprites.push({
      kind: SPRITE_TREE,
      x: tree.x,
      s: tree.s,
      size: tree.height,
      variant: tree.variant,
      tone,
      phase,
      xScale,
      id: id++,
      lift: onPlateau(tree.x, tree.s) ? CLIFF_HEIGHT : 0,
    });
  });

  // Rocks lining both edges of the trail, straddling the line between mud
  // and grass. Now and then a smaller one keeps another company.
  for (const side of [-1, 1]) {
    for (let s = -2; s < end; s += 0.5 + random() * 0.45) {
      const place = (along: number, width: number) => {
        const x = side * (pathEdge(along) - 0.03 + random() * 0.12);
        const rock = {
          kind: SPRITE_ROCK,
          x,
          s: along,
          size: width,
          variant: Math.floor(random() * ROCK_VARIANTS),
          tone: Math.floor(random() * ROCK_TONES),
          phase: 0,
          xScale: 1,
          id: -1,
          lift: 0,
        };
        if (!onSidePath(x, along) && pondReach(x, along) > 1.1 && !inStream(x, along)) sprites.push(rock);
      };
      place(s, 0.14 + random() * 0.2);
      if (random() < 0.18) place(s + 0.12 + random() * 0.15, 0.08 + random() * 0.08);
    }
  }

  // Grass tufts on the verges, thickest right against the trail. A tuft's
  // sway comes from where it stands, so neighbours bend together in gusts.
  for (const side of [-1, 1]) {
    for (let s = -2; s < end; s += 0.18 + random() * 0.22) {
      const size = 0.18 + random() * 0.26;
      const tuft = {
        kind: SPRITE_TUFT,
        x: side * (pathEdge(s) + 0.06 + 1.7 * Math.pow(random(), 1.6)),
        s,
        size,
        variant: Math.floor(random() * TUFT_VARIANTS),
        tone: Math.floor(random() * TUFT_COLORS),
        phase: 0,
        xScale: 1,
        id: -1,
        lift: 0,
      };
      if (!onSidePath(tuft.x, s) && pondReach(tuft.x, s) > 1.1 && !inStream(tuft.x, s)) sprites.push(tuft);
    }
  }

  sprites.push({ kind: SPRITE_DEER, x: DEER_START_X, s: DEER_S, size: 1, variant: 0, tone: 0, phase: 0, xScale: 1, id: -1, lift: 0 });
  sprites.push({ kind: SPRITE_HIKER, x: HIKER_X, s: HIKER_S, size: 1, variant: 0, tone: 0, phase: 0, xScale: 1, id: -1, lift: 0 });
  sprites.push({ kind: SPRITE_TOWER, x: TOWER_X, s: TOWER_S, size: TOWER_HEIGHT, variant: 0, tone: 0, phase: 0, xScale: 1, id: -1, lift: 0 });
  // The lighthouse on its granite, with boulders round its foot. Placed by
  // hand, not drawn from the random sequence, so nothing else moves.
  sprites.push({ kind: SPRITE_LIGHTHOUSE, x: LIGHTHOUSE_X, s: LIGHTHOUSE_S, size: LIGHTHOUSE_HEIGHT, variant: 0, tone: 0, phase: 0, xScale: 1, id: -1, lift: 0 });
  for (const boulder of BOULDERS) {
    sprites.push({
      kind: SPRITE_ROCK,
      x: LIGHTHOUSE_X + boulder.x,
      s: LIGHTHOUSE_S + boulder.s,
      size: boulder.size,
      variant: boulder.variant,
      tone: GRANITE_TONE,
      phase: 0,
      xScale: 1,
      id: -1,
      lift: 0,
    });
  }
  // The bear's tree, and the bear just in front of its trunk.
  sprites.push({
    kind: SPRITE_TREE,
    x: BEAR_TREE.x,
    s: BEAR_TREE.s,
    size: BEAR_TREE.height,
    variant: BEAR_TREE.variant,
    tone: 0,
    phase: BEAR_TREE.phase,
    xScale: 1,
    id: BEAR_TREE_ID,
    lift: 0,
  });
  sprites.push({ kind: SPRITE_BEAR, x: BEAR_TREE.x, s: BEAR_TREE.s - 0.05, size: 1, variant: 0, tone: 0, phase: BEAR_TREE.phase, xScale: 1, id: -1, lift: 0 });
  SCREEN_TREES.forEach((tree, k) => {
    sprites.push({ kind: SPRITE_TREE, x: tree.x, s: tree.s, size: tree.height, variant: tree.variant, tone: tree.tone, phase: tree.phase, xScale: 1, id: BEAR_TREE_ID + 1 + k, lift: 0 });
  });

  // The escarpment and falls, a column at a time.
  CLIFF_COLUMNS.forEach((column, index) => {
    const s = (column.s0 + column.s1) / 2;
    sprites.push({ kind: SPRITE_CLIFF, x: rockX(s), s, size: CLIFF_HEIGHT, variant: index, tone: 0, phase: 0, xScale: 1, id: -1, lift: 0 });
  });

  // The footbridge, where the trail crosses the stream. It goes in the
  // painter's order at its far end: nothing stands on it, and that way
  // it's still drawn while the end of it is ahead of us, as we walk over it.
  sprites.push({ kind: SPRITE_BRIDGE, x: 0, s: BRIDGE.s1, size: 1, variant: 0, tone: 0, phase: 0, xScale: 1, id: -1, lift: 0 });

  // Painter's order: furthest first. The camera only ever moves straight
  // down the trail, so this order never changes.
  return sprites.sort((a, b) => b.s - a.s);
}

export const SPRITES = buildWorld();

// Nothing further off than this can be showing over the horizon: the crest
// plus how far past it the tallest thing's tip still clears it.
export const FAR = (() => {
  const tallest = Math.max(TOWER_HEIGHT, ...FOREST.map((tree) => tree.height + (onPlateau(tree.x, tree.s) ? CLIFF_HEIGHT : 0)));
  const horizon = Math.sqrt(2 * CAMERA.globeRadius * CAMERA.eyeHeight);
  return horizon + Math.sqrt(2 * CAMERA.globeRadius * tallest) + 1;
})();
