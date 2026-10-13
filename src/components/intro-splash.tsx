import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { Colors, Fonts } from '@/constants/theme';
import { CompassEmblem } from '@/components/compass-emblem';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

// Not in theme.ts, which has no blue or deep green. Kept muted and warm so
// they sit comfortably between pine and parchment.
const PINE_LIGHT = '#5E7A46'; // same shade as Categories.adventure
const SKY_TOP = '#5B8DBF'; // clear blue overhead
const SKY_HORIZON = '#C3DAE5'; // paling toward the horizon
const HAZE = '#9FB9C6'; // what distant things fade into: horizon sky, dimmed
const CLOUD = '#F6F2E8'; // parchment, whitened
const WATER = '#6E8C8F'; // sky blue, dulled and deepened
const FOREST_FLOOR = '#4A4029'; // tan pushed toward ink
const UNDERGROWTH = '#566B3C'; // PINE_LIGHT, dimmed a touch
const GRASS_DARK = '#3F4F2C'; // UNDERGROWTH in shadow
const FOREST_FLOOR_LIT = '#5A5033'; // FOREST_FLOOR, lifted as the canopy opens
const TRAIL_STONE = '#A8956C'; // tan, lightened
const SKYLINE_FAR = '#5A5A4C'; // ink washed toward the sky, for distant buildings
const LANDMARK = '#46483A'; // ink hazed by distance, so landmarks sit behind the dark near trees
const MOOSE = '#4A3521'; // brown, deepened

// ---------------------------------------------------------------------------
// Shapes — every silhouette is drawn in its own viewBox and scaled at render
// time. A part's fill 'primary' means "the element's color".
// ---------------------------------------------------------------------------

interface ShapePart {
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}

interface Shape {
  width: number;
  height: number;
  parts: ShapePart[];
}

// Three-tier pine with a short trunk. (x, base) is the trunk's bottom center.
// Each tier has slightly concave sides and a serrated lower edge (hanging
// branch tips), so the silhouette reads as a tree rather than a triangle.
// `light` is the left half of each tier, drawn over the body as a highlight.
function pineTree(x: number, base: number, height: number): { body: string; light: string } {
  const width = height * 0.55;
  const top = base - height;
  const trunkTop = base - height * 0.1;
  const trunkHalf = width * 0.06;
  const tip = height * 0.035; // depth of the serrations

  const tiers = [
    { apex: 0, bottom: 0.4, half: 0.26 },
    { apex: 0.2, bottom: 0.66, half: 0.38 },
    { apex: 0.4, bottom: 0.9, half: 0.5 },
  ].map(({ apex, bottom, half }) => ({
    apexY: top + height * apex,
    bottomY: top + height * bottom,
    half: width * half,
  }));

  const body: string[] = [];
  const light: string[] = [];
  for (const { apexY, bottomY, half } of tiers) {
    const bend = apexY + (bottomY - apexY) * 0.6;
    // Points along the serrated lower edge, `f` from 0 (center) to 1 (outer
    // tip) on `side`. Branch tips hang down at the center, midway and ends.
    const edge = (side: 1 | -1, fractions: number[]) =>
      fractions
        .map((f) => `L${x + side * half * f} ${(f * 4) % 2 === 0 ? bottomY : bottomY - tip}`)
        .join('');
    body.push(
      `M${x} ${apexY}Q${x + half * 0.35} ${bend} ${x + half} ${bottomY}` +
        edge(1, [0.75, 0.5, 0.25, 0]) +
        edge(-1, [0.25, 0.5, 0.75, 1]) +
        `Q${x - half * 0.35} ${bend} ${x} ${apexY}Z`,
    );
    light.push(
      `M${x} ${apexY}Q${x - half * 0.35} ${bend} ${x - half} ${bottomY}` +
        edge(-1, [0.75, 0.5, 0.25, 0]) +
        'Z',
    );
  }
  body.push(`M${x - trunkHalf} ${trunkTop}H${x + trunkHalf}V${base}H${x - trunkHalf}Z`);
  return { body: body.join(''), light: light.join('') };
}

// A pine as shape parts: body in the element's color, lit left side on top.
function pineTreeParts(x: number, base: number, height: number): ShapePart[] {
  const { body, light } = pineTree(x, base, height);
  return [
    { d: body, fill: 'primary' },
    { d: light, fill: Colors.parchment, opacity: 0.09 },
  ];
}

// An ellipse as a path, since every part is a Path.
function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z`;
}

// Grass blades as one path: each [x, height, lean] is a thin curved spike
// standing on `base`, `w` wide at the root.
function grassBlades(blades: [number, number, number][], base: number, w: number): string {
  return blades
    .map(
      ([x, h, lean]) =>
        `M${x - w} ${base}Q${x + lean * 0.3} ${base - h * 0.55} ${x + lean} ${base - h}` +
        `Q${x + lean * 0.3 + w * 0.3} ${base - h * 0.5} ${x + w} ${base}Z`,
    )
    .join('');
}

const SHAPES = {
  treeCluster: {
    width: 100,
    height: 160,
    parts: [
      ...pineTreeParts(30, 160, 120),
      ...pineTreeParts(62, 160, 158),
      ...pineTreeParts(84, 160, 100),
    ],
  },
  // Low bushes with grass blades poking out, for the forest floor.
  undergrowth: {
    width: 100,
    height: 36,
    parts: [
      // Grass blades behind the bushes
      {
        d: [6, 14, 44, 52, 60, 88, 95]
          .map((x, i) => `M${x - 2} 36L${x + (i % 2 ? 3 : -3)} ${12 + (i % 3) * 5}L${x + 2} 36Z`)
          .join(''),
        fill: 'primary',
      },
      // Bush mounds
      {
        d: 'M0 36Q2 24 12 25Q16 14 28 18Q36 10 44 20Q48 26 46 36Z' + 'M54 36Q54 26 64 26Q70 16 80 22Q90 20 92 30Q96 32 97 36Z',
        fill: 'primary',
      },
      // Sunlit tops of the mounds
      {
        d: 'M6 27Q14 20 20 22Q28 13 36 17Q30 18 24 24Q16 22 6 27Z' + 'M60 29Q66 22 72 22Q80 18 86 23Q78 22 72 26Q66 25 60 29Z',
        fill: Colors.parchment,
        opacity: 0.12,
      },
    ],
  },
  // Flat trail stones, passing underfoot along the path.
  stones: {
    width: 60,
    height: 16,
    parts: [
      { d: ellipsePath(14, 10, 12, 4.5) + ellipsePath(42, 11, 9, 3.5), fill: 'primary' },
      { d: ellipsePath(12, 8.5, 8, 2) + ellipsePath(41, 9.5, 5.5, 1.6), fill: Colors.parchment, opacity: 0.15 },
    ],
  },
  // A clump of grass, for the verges either side of the path.
  grassTuft: {
    width: 40,
    height: 24,
    parts: [
      {
        d: grassBlades(
          [[6, 14, -3], [10, 20, -1], [14, 12, 2], [22, 22, 1], [27, 16, 4], [33, 13, 3]],
          24,
          1.4,
        ),
        fill: 'primary',
      },
      {
        d: grassBlades([[8, 16, -4], [18, 18, -2], [25, 19, 2], [31, 11, 5]], 24, 1.1),
        fill: PINE_LIGHT,
        opacity: 0.8,
      },
    ],
  },
  bird: {
    width: 40,
    height: 14,
    parts: [
      { d: 'M2 12Q11 1 20 11Q29 1 38 12', fill: 'none', stroke: 'primary', strokeWidth: 3 },
    ],
  },
  // Facing right: humped shoulders, long legs, palmate antlers and a bell.
  moose: {
    width: 120,
    height: 100,
    parts: [
      {
        d: [
          'M24 40Q24 30 36 30H62Q70 22 80 24L88 36Q90 52 84 58H30Q24 58 24 50Z', // body
          'M30 56h5v42h-5ZM39 56h5v42h-5ZM74 56h5v42h-5ZM82 56h5v42h-5Z', // legs
          'M80 26L96 30L100 40L92 44L84 40Z', // neck
          'M94 30Q106 30 112 40L114 48Q112 52 106 50L98 44Z', // head
          'M100 46Q101 56 97 58Q95 52 96 46Z', // bell
          'M92 28L88 22L95 26Z', // ear
          'M92 30Q84 22 82 12L86 16L87 10L90 16L92 9L94 17Q96 24 96 30Z', // far antler
          'M98 28Q104 20 112 16L110 22L116 20L112 26L118 26Q110 32 100 32Z', // near antler
          'M24 38L20 42L24 44Z', // tail
        ].join(''),
        fill: 'primary',
      },
      // Light catching the back
      { d: 'M30 32Q46 29 62 31Q70 24 79 25Q70 28 62 34Q46 32 30 35Z', fill: Colors.parchment, opacity: 0.1 },
    ],
  },
  // Facing right, with its flat paddle tail out behind.
  beaver: {
    width: 80,
    height: 34,
    parts: [
      { d: ellipsePath(13, 27, 12, 4.5), fill: 'primary' },
      { d: 'M5 25L20 29M5 29L20 25', fill: 'none', stroke: Colors.ink, strokeWidth: 0.8, opacity: 0.35 },
      {
        d:
          'M20 30Q16 14 36 10Q54 6 62 14Q70 14 75 21Q78 28 70 30Z' + // body and head
          ellipsePath(60, 11, 2.2, 2.2) + // ear
          'M28 29h7v4h-7ZM52 29h7v4h-7Z', // feet
        fill: 'primary',
      },
      { d: ellipsePath(68, 17, 1, 1), fill: Colors.ink },
      { d: 'M74 26h2v3h-2Z', fill: Colors.parchment }, // teeth
    ],
  },
  cloud: {
    width: 100,
    height: 34,
    parts: [
      {
        d: 'M8 30Q0 30 2 22Q4 14 14 16Q16 6 30 8Q36 0 50 4Q60 -2 68 8Q80 4 86 14Q98 14 98 24Q98 30 90 30Z',
        fill: 'primary',
      },
      // Shaded underside
      {
        d: 'M8 30H90Q94 30 96 26Q80 29 60 27Q40 30 20 28Q10 29 3 25Q4 30 8 30Z',
        fill: SKY_TOP,
        opacity: 0.18,
      },
    ],
  },
  // The horseshoe falls between rocky gorge walls, with the Niagara River
  // running on below. The falls themselves sit at x 30–130. Every outer edge
  // tapers or curves away, so it sits in the scene as a silhouette rather
  // than a framed picture.
  niagaraFalls: {
    width: 160,
    height: 84,
    parts: [
      // The plunge pool and gorge river, with an irregular shoreline
      {
        d: 'M16 62Q36 55 80 56Q124 55 144 62Q154 70 130 75Q104 80 80 77Q54 80 30 74Q8 69 16 62Z',
        fill: WATER,
      },
      // Falling water, from the horseshoe lip down to the pool
      {
        d: [48, 58, 68, 80, 92, 102, 112]
          .map((x) => `M${x} ${x === 80 ? 26 : 22 + Math.abs(80 - x) * 0.08}V58`)
          .join(''),
        fill: 'none',
        stroke: Colors.parchment,
        strokeWidth: 3,
        opacity: 0.9,
      },
      // Gorge walls: rock faces either side of the falls, sloping away into
      // the ground at their outer ends
      {
        d:
          'M2 62Q8 42 16 30Q24 18 38 16Q46 20 42 34Q38 44 44 60Q24 66 2 62Z' +
          'M158 62Q152 42 144 30Q136 18 122 16Q114 20 118 34Q122 44 116 60Q136 66 158 62Z',
        fill: Colors.brown,
      },
      // Rock strata and shadowed inner faces
      {
        d: 'M16 36H36M10 46H38M7 54H40' + 'M144 36H124M150 46H122M153 54H120',
        fill: 'none',
        stroke: Colors.ink,
        strokeWidth: 1.2,
        opacity: 0.35,
      },
      { d: 'M38 16Q46 20 42 34Q38 44 44 60H36Q32 44 34 32Q36 22 30 16Z', fill: Colors.ink, opacity: 0.3 },
      { d: 'M122 16Q114 20 118 34Q122 44 116 60H124Q128 44 126 32Q124 22 130 16Z', fill: Colors.ink, opacity: 0.3 },
      // Grass along the rim, with a few small pines
      {
        d: 'M14 32Q22 17 38 14L39 18Q26 20 17 33Z' + 'M146 32Q138 17 122 14L121 18Q134 20 143 33Z',
        fill: PINE_LIGHT,
      },
      {
        d: [
          pineTree(24, 23, 12).body,
          pineTree(31, 19, 15).body,
          pineTree(129, 19, 15).body,
          pineTree(136, 23, 12).body,
        ].join(''),
        fill: Colors.pine,
      },
      // Horseshoe cliff edge
      { d: 'M30 14Q80 34 130 14V22Q80 42 30 22Z', fill: 'primary' },
      // Boulders along the pool's edge
      {
        d:
          ellipsePath(28, 66, 7, 3) +
          ellipsePath(40, 70, 5, 2.5) +
          ellipsePath(120, 70, 5, 2.5) +
          ellipsePath(132, 66, 7, 3),
        fill: Colors.ink,
        opacity: 0.8,
      },
      // Mist rising off the pool
      {
        d: ellipsePath(60, 58, 16, 5) + ellipsePath(85, 60, 20, 6) + ellipsePath(108, 58, 14, 5),
        fill: Colors.parchment,
        opacity: 0.6,
      },
    ],
  },
  // The tower rising out of the Toronto skyline. The tower itself sits at
  // x 35–65; the buildings step down toward both ends.
  cnTower: {
    width: 100,
    height: 160,
    parts: [
      // Distant towers behind
      {
        d: 'M8 160V128H14V120H20V160ZM24 160V130H32V160ZM68 160V118H76V126H82V160ZM86 160V128H94V160Z',
        fill: SKYLINE_FAR,
      },
      {
        d: [
          'M49.6 0H50.4V22H49.6Z', // antenna
          'M48.4 22H51.6V36H48.4Z', // SkyPod
          'M48.6 36L48 60H52L51.4 36Z', // upper shaft
          ellipsePath(50, 60, 8, 4.5), // main pod
          'M48 62L47 150H53L52 62Z', // lower shaft
          'M44 160L48 132H52L56 160Z', // base legs
        ].join(''),
        fill: 'primary',
      },
      // Gold ring on the main pod, so the silhouette reads as the CN Tower.
      { d: ellipsePath(50, 58, 6, 1.6), fill: Colors.gold },
      // Nearer buildings, and the Rogers Centre dome beside the tower
      {
        d:
          'M4 160V148H11V160ZM12 160V132H22V142H28V160ZM30 160V144H40V160Z' +
          'M58 160Q58 144 72 144Q86 144 86 160Z' +
          'M88 160V138H96V160Z',
        fill: 'primary',
      },
      // A few lit windows
      {
        d: [
          [6, 152], [15, 136], [18, 146], [33, 148], [90, 142], [93, 148], [90, 154],
        ]
          .map(([x, y]) => `M${x} ${y}h1.6v2h-1.6Z`)
          .join(''),
        fill: Colors.gold,
        opacity: 0.8,
      },
    ],
  },
  plane: {
    width: 48,
    height: 24,
    parts: [
      { d: 'M46 12L30 9L22 1H18L22 9H8L4 4H1L4 12L1 20H4L8 15H22L18 23H22L30 15Z', fill: 'primary' },
    ],
  },
} satisfies Record<string, Shape>;

type ShapeKey = keyof typeof SHAPES;

// ---------------------------------------------------------------------------
// Scenes
//
// Positions are offsets from screen center as fractions of screen width (x)
// and height (y); size is the element's width at scale 1, as a fraction of
// screen width.
//
// motion 'approach': the element moves along the line of sight. Scale changes
//   geometrically (constant apparent speed, accelerating at the end) and the
//   drift tracks the scale, so it swells and slides past the edge — or, with
//   `to.scale` below `from.scale`, shrinks away into the distance.
// motion 'cross': the element moves across the frame at a steady rate
//   (clouds, the plane, walking animals) with only a mild scale change.
// ---------------------------------------------------------------------------

// The ground starts this far down the screen, as a fraction of its height.
const GROUND_HORIZON = 0.57;
// The same line as an offset from screen center, where approaching elements
// converge while they're still far off.
const HORIZON_Y = GROUND_HORIZON - 0.5;

interface Pose {
  x: number;
  y: number;
  scale: number;
}

// A small repeating motion on top of the main one: wind sway, a walking
// gait, wing beats. Each element gets its own phase so they don't move in
// step.
interface Idle {
  period: number; // ms per cycle
  rotate?: number; // sway, in degrees either way
  pivot?: 'center' | 'base'; // what the sway turns around
  bob?: number; // gait: lifts twice per cycle, as a fraction of the element's height
  flap?: number; // wing beat: vertical squash, as a fraction of the height
}

interface ElementSpec {
  shape: ShapeKey;
  color: string;
  size: number;
  at: number; // ms after the scene starts
  duration: number;
  from: Pose;
  to: Pose;
  motion?: 'approach' | 'cross';
  // Start fully visible instead of fading in (for things already on screen
  // when the intro opens).
  visibleAtStart?: boolean;
  // Rotation in degrees at the start, midpoint and end.
  rotate?: [number, number, number];
  // Mirror horizontally (a shape drawn facing right, travelling left).
  flip?: boolean;
  // Draw order: lower is further back. Defaults to DEPTH.near.
  depth?: number;
  // How far back along its path an approaching element first appears, as a
  // fraction of its duration: it shows up that much earlier, tiny and hazed
  // near the vanishing point, instead of popping in at `from`. Defaults to
  // DEFAULT_LEAD.
  lead?: number;
  // How faded into the horizon haze it is at `from` and at `to`: 0 is its
  // own colors, 1 is haze. Approaching elements default to clearing as they
  // near; crossing ones to no haze.
  haze?: [number, number];
  idle?: Idle;
}

const DEPTH = { sky: 0, landmark: 1, farTrees: 2, near: 3 };
const DEFAULT_LEAD = 0.6;
// Haze on an approaching element when it first appears in the distance.
const DISTANT_HAZE = 0.6;

const TREE_SWAY: Idle = { period: 2400, rotate: 1.2, pivot: 'base' };
const BUSH_SWAY: Idle = { period: 1500, rotate: 2.5, pivot: 'base' };
const GRASS_SWAY: Idle = { period: 1100, rotate: 5, pivot: 'base' };

interface Scene {
  name: string;
  start: number; // ms from the start of the intro
  elements: ElementSpec[];
}

// A left/right pair of the same shape flying past on both sides.
function sidePair(
  shape: ShapeKey,
  size: number,
  at: number,
  duration: number,
  color: string,
  from: Pose,
  to: Pose,
  extra: Partial<ElementSpec> = {},
): ElementSpec[] {
  const side = (sign: 1 | -1): ElementSpec => ({
    shape,
    color,
    size,
    at,
    duration,
    from: { ...from, x: from.x * sign },
    to: { ...to, x: to.x * sign },
    ...extra,
  });
  return [side(-1), side(1)];
}

function treePair(
  at: number,
  duration: number,
  color: string,
  from: Pose,
  to: Pose,
  extra: Partial<ElementSpec> = {},
): ElementSpec[] {
  return sidePair('treeCluster', 0.5, at, duration, color, from, to, { idle: TREE_SWAY, ...extra });
}

// Bushes either side of the path. They start just below the horizon and
// slide down and out as they approach, so they read as sitting on the ground
// plane. `spread` is how far off the path they start.
function undergrowthPair(at: number, duration: number, spread: number): ElementSpec[] {
  return sidePair(
    'undergrowth',
    0.36,
    at,
    duration,
    UNDERGROWTH,
    { x: spread, y: 0.07, scale: 0.35 },
    { x: spread * 7, y: 0.38, scale: 2.6 },
    { idle: BUSH_SWAY },
  );
}

// Grass tufts on the verges, nearer the path than the bushes.
function grassPair(at: number, duration: number, spread: number): ElementSpec[] {
  return sidePair(
    'grassTuft',
    0.14,
    at,
    duration,
    UNDERGROWTH,
    { x: spread, y: 0.075, scale: 0.35 },
    { x: spread * 6, y: 0.44, scale: 3 },
    { idle: GRASS_SWAY },
  );
}

// Trail stones coming up the path toward the viewer and passing underfoot.
function stones(at: number, duration: number, side: 1 | -1): ElementSpec {
  return {
    shape: 'stones',
    color: TRAIL_STONE,
    size: 0.18,
    at,
    duration,
    from: { x: 0.01 * side, y: 0.075, scale: 0.3 },
    to: { x: 0.08 * side, y: 0.48, scale: 3 },
  };
}

// Trees further off to either side of the path: smaller, slower and hazed,
// so a landmark ahead reads as sitting beyond the treeline.
function farTreePair(at: number, duration: number, spread: number): ElementSpec[] {
  return treePair(
    at,
    duration,
    Colors.pine,
    { x: spread, y: -0.01, scale: 0.28 },
    { x: spread * 3.2, y: 0.12, scale: 1.1 },
    { depth: DEPTH.farTrees, haze: [0.35, 0.15] },
  );
}

// A bird flying on ahead of us, shrinking into the distance down the path.
function birdAhead(at: number, duration: number, from: Pose, to: Pose): ElementSpec {
  return {
    shape: 'bird',
    color: Colors.parchment,
    size: 0.08,
    at,
    duration,
    from,
    to,
    lead: 0,
    haze: [0, 0.6],
    idle: { period: 280, flap: 0.5 },
  };
}

// The plane crossing the sky, banking into the turn and out of it. `dir` is
// the direction of travel: 1 left to right, -1 right to left.
function planeCrossing(at: number, dir: 1 | -1, y: number, color: string): ElementSpec {
  return {
    shape: 'plane',
    color,
    size: 0.14,
    at,
    duration: 850,
    motion: 'cross',
    from: { x: -0.7 * dir, y, scale: 0.9 },
    to: { x: 0.7 * dir, y: y - 0.1, scale: 1.2 },
    // Mirrored for right-to-left, so the nose leads. The rotation is applied
    // inside the mirror, so the same values bank it the mirrored way.
    flip: dir === -1,
    rotate: [-12, 0, 8],
  };
}

// Clouds drift slowly with the wind until the sky fades for the final
// approach. Those at `at` 0 are already up when the intro opens.
const CLOUDS_END = 3650;
function cloud(at: number, x: number, y: number, scale: number, drift: number): ElementSpec {
  return {
    shape: 'cloud',
    color: CLOUD,
    size: 0.34,
    at,
    duration: CLOUDS_END - at,
    motion: 'cross',
    from: { x, y, scale },
    to: { x: x + drift, y, scale },
    visibleAtStart: at === 0,
    depth: DEPTH.sky,
  };
}

// One continuous walk down a forest trail. Tree pairs keep passing on both
// sides the whole way; the landmarks are glimpsed through the gap between
// them, beyond the treeline, rather than getting scenes of their own.
const SCENES: Scene[] = [
  {
    name: 'Sky',
    start: 0,
    elements: [
      cloud(0, -0.3, -0.36, 1, 0.22),
      cloud(0, 0.32, -0.27, 0.7, 0.15),
      cloud(0, 0.04, -0.44, 1.3, 0.25),
      cloud(0, -0.5, -0.2, 0.55, 0.12),
      cloud(900, -0.78, -0.32, 0.8, 0.4),
    ],
  },
  {
    name: 'Trees parting',
    start: 0,
    elements: [
      stones(200, 800, 1),
      ...grassPair(200, 800, 0.16),
      ...undergrowthPair(100, 850, 0.12),
      ...undergrowthPair(500, 800, 0.1),
      // Already filling the frame when the intro opens, then parting.
      ...treePair(0, 900, Colors.ink, { x: 0.2, y: 0.05, scale: 1.4 }, { x: 1.1, y: 0.35, scale: 3.2 }, {
        visibleAtStart: true,
        haze: [0, 0],
      }),
      ...treePair(150, 850, Colors.ink, { x: 0.18, y: 0.02, scale: 0.7 }, { x: 1.0, y: 0.3, scale: 2.8 }),
      ...treePair(350, 800, Colors.ink, { x: 0.15, y: 0, scale: 0.45 }, { x: 0.95, y: 0.3, scale: 2.6 }),
    ],
  },
  {
    name: 'Forest interior',
    start: 700,
    elements: [
      stones(0, 800, -1),
      stones(400, 800, 1),
      ...farTreePair(100, 900, 0.3),
      ...treePair(0, 800, Colors.ink, { x: 0.16, y: 0, scale: 0.4 }, { x: 0.95, y: 0.3, scale: 2.6 }),
      ...treePair(350, 800, Colors.ink, { x: 0.18, y: 0.01, scale: 0.45 }, { x: 1.0, y: 0.3, scale: 2.6 }),
      ...grassPair(150, 800, 0.15),
      ...undergrowthPair(100, 800, 0.13),
      ...undergrowthPair(450, 800, 0.09),
      // Birds flushed from overhead, flying on ahead of us down the trail.
      birdAhead(0, 900, { x: -0.4, y: -0.3, scale: 1.6 }, { x: -0.04, y: -0.02, scale: 0.25 }),
      birdAhead(120, 850, { x: 0.45, y: -0.22, scale: 1.9 }, { x: 0.05, y: -0.03, scale: 0.3 }),
      birdAhead(300, 950, { x: -0.2, y: -0.38, scale: 1.3 }, { x: 0, y: -0.05, scale: 0.2 }),
      // A moose ambling across the trail ahead. Listed last so it walks in
      // front of this scene's trees.
      {
        shape: 'moose',
        color: MOOSE,
        size: 0.3,
        at: 100,
        duration: 1300,
        motion: 'cross',
        from: { x: -0.62, y: 0.12, scale: 0.85 },
        to: { x: 0.62, y: 0.15, scale: 1.05 },
        haze: [0.25, 0.1],
        idle: { period: 700, rotate: 1.5, pivot: 'base', bob: 0.025 },
      },
    ],
  },
  {
    name: 'CN Tower through the trees',
    start: 1400,
    elements: [
      {
        shape: 'cnTower',
        color: LANDMARK,
        size: 0.33, // keeps the tower itself 0.1 of screen width
        at: 0,
        duration: 850,
        depth: DEPTH.landmark,
        lead: 0.8,
        haze: [0.35, 0.2],
        // Glimpsed off to the left, drifting further left as we pass it. Its
        // base stays near the horizon, so it rises out of the treeline.
        from: { x: -0.06, y: -0.06, scale: 1.2 },
        to: { x: -0.45, y: -0.16, scale: 2.2 },
      },
      ...farTreePair(0, 850, 0.32),
      ...treePair(0, 800, Colors.ink, { x: 0.2, y: 0.01, scale: 0.45 }, { x: 1.0, y: 0.3, scale: 2.6 }),
      ...treePair(350, 750, Colors.ink, { x: 0.22, y: 0.02, scale: 0.5 }, { x: 1.05, y: 0.32, scale: 2.7 }),
      stones(50, 750, 1),
      ...grassPair(100, 750, 0.16),
      ...undergrowthPair(0, 750, 0.12),
      ...undergrowthPair(350, 700, 0.1),
      planeCrossing(150, 1, -0.3, Colors.ink),
      // A beaver waddling across the path, close in, in front of the trees.
      {
        shape: 'beaver',
        color: Colors.brown,
        size: 0.2,
        at: 150,
        duration: 1100,
        motion: 'cross',
        from: { x: 0.65, y: 0.2, scale: 0.95 },
        to: { x: -0.65, y: 0.23, scale: 1.1 },
        flip: true,
        haze: [0.1, 0],
        idle: { period: 420, rotate: 4, pivot: 'base', bob: 0.06 },
      },
    ],
  },
  {
    name: 'Niagara Falls through the trees',
    start: 2300,
    elements: [
      {
        shape: 'niagaraFalls',
        color: LANDMARK,
        size: 0.96, // keeps the falls themselves 0.6 of screen width
        at: 0,
        duration: 1100,
        depth: DEPTH.landmark,
        lead: 0.8,
        haze: [0.35, 0.15],
        // The last sight before the final approach: grows and slides right
        // as we walk past.
        from: { x: 0.02, y: 0.035, scale: 0.5 },
        to: { x: 0.4, y: 0.06, scale: 1.2 },
      },
      ...farTreePair(0, 900, 0.34),
      ...farTreePair(450, 900, 0.3),
      ...treePair(0, 800, Colors.ink, { x: 0.2, y: 0.01, scale: 0.45 }, { x: 1.0, y: 0.3, scale: 2.6 }),
      ...treePair(350, 800, Colors.ink, { x: 0.22, y: 0.02, scale: 0.5 }, { x: 1.05, y: 0.32, scale: 2.7 }),
      ...treePair(600, 750, Colors.ink, { x: 0.2, y: 0.01, scale: 0.45 }, { x: 1.0, y: 0.3, scale: 2.6 }),
      stones(100, 800, -1),
      stones(500, 750, 1),
      ...grassPair(200, 750, 0.15),
      ...undergrowthPair(50, 800, 0.12),
      ...undergrowthPair(400, 750, 0.1),
      planeCrossing(0, -1, -0.2, Colors.ink),
    ],
  },
];

// Ground: from GROUND_HORIZON down, for the whole journey, lifting a little
// as the canopy opens, then fading out with the sky for the final approach.
const GROUND_STOPS: [number, string][] = [
  [0, FOREST_FLOOR],
  [1500, FOREST_FLOOR],
  [2600, FOREST_FLOOR_LIT],
];
const GROUND_FADE_AT = 3250;
const GROUND_FADE_MS = 400;

// Final approach
const EMBLEM_AT = 3450;
const EMBLEM_SPRING = { stiffness: 180, damping: 14, mass: 1 };
const WORDMARK_AT = 3650;
const WORDMARK_MS = 350;
const FADE_OUT_AT = 4100;
const FADE_OUT_MS = 400;
const TOTAL_MS = FADE_OUT_AT + FADE_OUT_MS; // 4.5s

const REDUCED_MOTION_FADE_MS = 350;

// Flattened once: every element with its absolute start time, lead and idle
// phase, back to front.
const ELEMENTS = SCENES.flatMap((scene) =>
  scene.elements.map((element, index) => {
    const approaches = (element.motion ?? 'approach') === 'approach';
    return {
      ...element,
      key: `${scene.name}-${index}`,
      start: scene.start + element.at,
      lead: element.lead ?? (approaches && !element.visibleAtStart ? DEFAULT_LEAD : 0),
      // Golden-angle steps, so neighbours never sway in step.
      phase: (index * 2.39996) % (Math.PI * 2),
    };
  }),
).sort((a, b) => (a.depth ?? DEPTH.near) - (b.depth ?? DEPTH.near));

type JourneySpec = (typeof ELEMENTS)[number];

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// `tint` paints every part in that one color, for the haze layer.
function ShapeSvg({
  shape,
  color,
  width,
  tint,
}: {
  shape: Shape;
  color: string;
  width: number;
  tint?: string;
}) {
  const height = (width * shape.height) / shape.width;
  const resolve = (value: string | undefined) => {
    if (value === undefined || value === 'none') return value;
    if (tint) return tint;
    return value === 'primary' ? color : value;
  };
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${shape.width} ${shape.height}`}>
      {shape.parts.map((part, index) => (
        <Path
          key={index}
          d={part.d}
          fill={resolve(part.fill)}
          stroke={resolve(part.stroke)}
          strokeWidth={part.strokeWidth}
          strokeLinecap="round"
          opacity={part.opacity}
        />
      ))}
    </Svg>
  );
}

function JourneyElement({
  spec,
  clock,
  screenWidth,
  screenHeight,
}: {
  spec: JourneySpec;
  clock: SharedValue<number>;
  screenWidth: number;
  screenHeight: number;
}) {
  const shape: Shape = SHAPES[spec.shape];
  const width = spec.size * screenWidth;
  const height = (width * shape.height) / shape.width;
  const hazes = (spec.motion ?? 'approach') === 'approach' || spec.haze !== undefined;

  const style = useAnimatedStyle(() => {
    const { start, duration, from, to, motion = 'approach', visibleAtStart, rotate, flip, lead, idle, phase } =
      spec;
    // Negative while still in the lead-in, before reaching `from`.
    const progress = (clock.value - start) / duration;
    if (progress < -lead || progress > 1) return { opacity: 0 };

    let scale: number;
    let x: number;
    let y: number;
    if (motion === 'cross') {
      scale = from.scale + (to.scale - from.scale) * progress;
      x = from.x + (to.x - from.x) * progress;
      y = from.y + (to.y - from.y) * progress;
    } else {
      scale = from.scale * Math.pow(to.scale / from.scale, progress);
      if (progress >= 0) {
        const travel = (scale - from.scale) / (to.scale - from.scale);
        x = from.x + (to.x - from.x) * travel;
        y = from.y + (to.y - from.y) * travel;
      } else {
        // Still far off: converge on the vanishing point, with the base
        // staying on the ground.
        const shrink = scale / from.scale;
        x = from.x * shrink;
        y = HORIZON_Y + (from.y - HORIZON_Y) * shrink;
      }
    }

    let opacity: number;
    if (motion === 'cross') {
      opacity = interpolate(progress, [0, 0.1, 0.9, 1], [visibleAtStart ? 1 : 0, 1, 1, 0]);
    } else if (lead > 0) {
      // Solid almost as soon as it appears; the haze layer is what makes it
      // faint in the distance.
      opacity = interpolate(progress, [-lead, -lead + 0.15, 0.65, 1], [0, 1, 1, 0]);
    } else {
      opacity = interpolate(progress, [0, 0.15, 0.65, 1], [visibleAtStart ? 1 : 0, 1, 1, 0]);
    }

    let sway = 0;
    let lift = 0;
    let squash = 1;
    if (idle) {
      const wave = Math.sin((clock.value / idle.period) * Math.PI * 2 + phase);
      sway = (idle.rotate ?? 0) * wave;
      lift = (idle.bob ?? 0) * Math.abs(wave) * height * scale;
      squash = 1 + (idle.flap ?? 0) * wave;
    }
    // Rotation turns about the center; to sway about the base instead, shift
    // back by however far that moved the base.
    const pivotShift =
      idle?.pivot === 'base'
        ? Math.sin((sway * Math.PI) / 180) * (height / 2) * scale * (flip ? -1 : 1)
        : 0;
    const angle = sway + (rotate ? interpolate(progress, [0, 0.5, 1], rotate) : 0);

    const transform: (
      | { translateX: number }
      | { translateY: number }
      | { scale: number }
      | { scaleX: number }
      | { scaleY: number }
      | { rotate: string }
    )[] = [
      { translateX: x * screenWidth + pivotShift },
      { translateY: y * screenHeight - lift },
      { scale },
    ];
    if (flip) transform.push({ scaleX: -1 });
    if (angle !== 0) transform.push({ rotate: `${angle}deg` });
    if (squash !== 1) transform.push({ scaleY: squash });

    return { opacity, transform };
  });

  // How far it has faded into the horizon haze.
  const hazeStyle = useAnimatedStyle(() => {
    const { start, duration, motion = 'approach', lead, haze } = spec;
    const progress = (clock.value - start) / duration;
    if (motion === 'cross') {
      return { opacity: haze ? interpolate(progress, [0, 1], haze, 'clamp') : 0 };
    }
    if (!haze) {
      return {
        opacity:
          lead > 0
            ? interpolate(progress, [-lead, 0, 0.45], [DISTANT_HAZE, 0.3, 0], 'clamp')
            : interpolate(progress, [0, 0.45], [0.3, 0], 'clamp'),
      };
    }
    return {
      opacity:
        lead > 0
          ? interpolate(progress, [-lead, 0, 1], [DISTANT_HAZE, haze[0], haze[1]], 'clamp')
          : interpolate(progress, [0, 1], haze, 'clamp'),
    };
  });

  return (
    <Animated.View
      style={[
        styles.element,
        {
          left: (screenWidth - width) / 2,
          top: (screenHeight - height) / 2,
          width,
          height,
        },
        style,
      ]}>
      <ShapeSvg shape={shape} color={spec.color} width={width} />
      {hazes && (
        <Animated.View style={[StyleSheet.absoluteFill, hazeStyle]}>
          <ShapeSvg shape={shape} color={spec.color} width={width} tint={HAZE} />
        </Animated.View>
      )}
    </Animated.View>
  );
}

const GROUND_TIMES = GROUND_STOPS.map(([time]) => time);
const GROUND_COLORS = GROUND_STOPS.map(([, color]) => color);

// Sky and ground both fade out together for the final approach.
function useSceneryFade(clock: SharedValue<number>) {
  return useAnimatedStyle(() => ({
    opacity: interpolate(
      clock.value,
      [GROUND_FADE_AT, GROUND_FADE_AT + GROUND_FADE_MS],
      [1, 0],
      'clamp',
    ),
  }));
}

// Clear blue overhead, paling toward the horizon.
function Sky({
  clock,
  screenWidth,
  screenHeight,
}: {
  clock: SharedValue<number>;
  screenWidth: number;
  screenHeight: number;
}) {
  // Down to just past the horizon, so no gap shows above the ground.
  const height = screenHeight * GROUND_HORIZON + 2;
  const style = useSceneryFade(clock);
  return (
    <Animated.View style={[styles.sky, { height }, style]}>
      <Svg width={screenWidth} height={height}>
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={SKY_TOP} />
            <Stop offset="1" stopColor={SKY_HORIZON} />
          </LinearGradient>
        </Defs>
        <Path d={`M0 0H${screenWidth}V${height}H0Z`} fill="url(#sky)" />
      </Svg>
    </Animated.View>
  );
}

// Grass tufts scattered over the ground either side of the trail, small near
// the horizon and larger toward the viewer. Seeded, so the same every launch.
function groundGrass(width: number, depth: number, center: number, far: number, near: number) {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const dark: string[] = [];
  const light: string[] = [];
  for (let i = 0; i < 240; i++) {
    const t = random(); // 0 at the horizon, 1 at the bottom of the screen
    const x = random() * width;
    const y = t * depth;
    const size = 18 * (0.1 + t);
    const trail = far + (near - far) * t;
    if (Math.abs(x - center) < trail * 1.05) continue;
    const blades: [number, number, number][] = [];
    const count = 3 + Math.floor(random() * 3);
    for (let b = 0; b < count; b++) {
      blades.push([
        x + (b - count / 2) * size * 0.2,
        size * (0.6 + random() * 0.5),
        (random() - 0.5) * size * 0.6,
      ]);
    }
    (random() < 0.35 ? light : dark).push(grassBlades(blades, y, Math.max(size * 0.06, 0.5)));
  }
  return { dark: dark.join(''), light: light.join('') };
}

// The ground the walk happens on, with a trail running from the horizon to
// the viewer's feet. It stays put while trees, undergrowth, trail stones and
// landmarks stream past over it.
function Ground({
  clock,
  screenWidth,
  screenHeight,
}: {
  clock: SharedValue<number>;
  screenWidth: number;
  screenHeight: number;
}) {
  const top = screenHeight * GROUND_HORIZON;
  const depth = screenHeight - top;
  const center = screenWidth / 2;
  // The trail's half-width at the horizon and at the bottom of the screen.
  const far = screenWidth * 0.02;
  const near = screenWidth * 0.42;
  const grass = useMemo(
    () => groundGrass(screenWidth, depth, center, far, near),
    [screenWidth, depth, center, far, near],
  );

  const fade = useSceneryFade(clock);
  const color = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(clock.value, GROUND_TIMES, GROUND_COLORS),
  }));

  return (
    <Animated.View style={[styles.ground, { top, height: depth }, fade, color]}>
      <Svg width={screenWidth} height={depth}>
        <Defs>
          <LinearGradient id="horizonHaze" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={Colors.ink} stopOpacity={0.3} />
            <Stop offset="1" stopColor={Colors.ink} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Path
          d={`M${center - far} 0H${center + far}L${center + near} ${depth}H${center - near}Z`}
          fill={Colors.tan}
          opacity={0.55}
        />
        {/* Worn, lighter strip down the middle of the trail */}
        <Path
          d={`M${center - far * 0.4} 0H${center + far * 0.4}L${center + near * 0.4} ${depth}H${center - near * 0.4}Z`}
          fill={Colors.parchment}
          opacity={0.08}
        />
        <Path d={grass.dark} fill={GRASS_DARK} />
        <Path d={grass.light} fill={UNDERGROWTH} />
        {/* Haze toward the horizon, for depth */}
        <Path d={`M0 0H${screenWidth}V${depth * 0.3}H0Z`} fill="url(#horizonHaze)" />
      </Svg>
    </Animated.View>
  );
}

// A once-per-launch "walking forward through Canada" intro, drawn over the
// app while it loads underneath: down a forest trail under a blue sky, past a
// moose, a beaver and birds, glimpsing the CN Tower and then Niagara Falls
// through the trees as a plane passes overhead twice, then onto parchment for
// the emblem and wordmark. It hides the native splash as soon as it's on
// screen, plays for ~4.5s, fades onto the Map screen, then calls onFinish so
// the caller can unmount it.
export function IntroSplash({ onFinish }: { onFinish: () => void }) {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [started, setStarted] = useState(false);

  const clock = useSharedValue(0);
  const emblem = useSharedValue(0);
  const reducedFade = useSharedValue(1);

  useEffect(() => {
    if (!started) return;

    const finish = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(onFinish);
    };

    // With Reduce Motion on, skip the journey and just fade to the app.
    if (reduceMotion) {
      reducedFade.value = withTiming(0, { duration: REDUCED_MOTION_FADE_MS }, finish);
      return;
    }

    clock.value = withTiming(TOTAL_MS, { duration: TOTAL_MS, easing: Easing.linear }, finish);
    emblem.value = withDelay(EMBLEM_AT, withSpring(1, EMBLEM_SPRING));
  }, [started, reduceMotion, onFinish, clock, emblem, reducedFade]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion
      ? reducedFade.value
      : interpolate(clock.value, [FADE_OUT_AT, TOTAL_MS], [1, 0], 'clamp'),
  }));
  const emblemStyle = useAnimatedStyle(() => ({
    opacity: Math.min(emblem.value * 2, 1),
    transform: [{ scale: emblem.value }],
  }));
  const wordmarkStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      clock.value,
      [WORDMARK_AT, WORDMARK_AT + WORDMARK_MS],
      [0, 1],
      'clamp',
    );
    return { opacity: progress, transform: [{ translateY: (1 - progress) * 8 }] };
  });

  return (
    <Animated.View
      style={[styles.overlay, overlayStyle]}
      onLayout={() => {
        if (started) return;
        SplashScreen.hideAsync().finally(() => setStarted(true));
      }}>
      {!reduceMotion && (
        <>
          <Sky clock={clock} screenWidth={width} screenHeight={height} />
          <Ground clock={clock} screenWidth={width} screenHeight={height} />
          {ELEMENTS.map((element) => (
            <JourneyElement
              key={element.key}
              spec={element}
              clock={clock}
              screenWidth={width}
              screenHeight={height}
            />
          ))}

          <View style={styles.center}>
            <Animated.View style={[styles.medallion, emblemStyle]}>
              <CompassEmblem size={72} />
            </Animated.View>
            <Animated.Text style={[styles.wordmark, wordmarkStyle]}>GoOutside</Animated.Text>
          </View>
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Parchment underneath: what the sky and ground fade onto for the final
  // approach, and all there is with Reduce Motion on.
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
    overflow: 'hidden',
    backgroundColor: Colors.parchment,
  },
  element: { position: 'absolute' },
  sky: { position: 'absolute', top: 0, left: 0, right: 0 },
  ground: { position: 'absolute', left: 0, right: 0 },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  // Parchment disc behind the emblem, matching the stamp-like app styling.
  medallion: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: Colors.parchment,
    borderWidth: 1,
    borderColor: Colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    fontFamily: Fonts.display,
    fontSize: 26,
    color: Colors.ink,
    textTransform: 'uppercase',
    letterSpacing: 3,
  },
});
