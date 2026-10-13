// A black bear climbing a pine beside the trail, and the tree it climbs.
//
// The bear is drawn in its own frame, in metres, seen from its right side:
// the origin is on the trunk's surface at the height of its rump, +x points
// away from the trunk (toward its back), and up is -y (as on screen). Like
// the deer, its limbs are driven by where each paw should be: diagonal pairs
// take turns reaching up the bark, and a gripping paw stays put on the bark
// while the body climbs past it. Elbows and knees follow from two-bone IK.

// The tree: a tall, bare-trunked pine at the left edge of the trail.
export const BEAR_TREE = { x: -3.2, s: 63, height: 14, variant: 3, phase: 0.6 };

// How fast the bear climbs, m/s, how high its rump is when the intro opens,
// and how long one full climbing cycle (all four limbs) takes, s.
export const CLIMB_SPEED = 0.5;
const START_HEIGHT = 1;
export const CLIMB_CYCLE = 0.9;
// Share of the cycle each paw grips the bark.
const GRIP = 0.62;
// How far a gripping paw slides down past the body while it grips.
const STROKE = CLIMB_SPEED * CLIMB_CYCLE * GRIP;

export interface BearLimb {
  name: string;
  near: boolean; // the side facing the camera
  pivot: [number, number]; // shoulder or hip
  upper: number;
  lower: number;
  reachUp: number; // grip position mid-stroke, above the pivot (m, negative is up)
  bark: number; // how far from the trunk the paw grips, m
  grab: number; // when in the cycle this paw takes hold, 0–1
  front: boolean;
}

// Diagonal pairs: near fore with far hind, then far fore with near hind.
// Paws grip the face of the trunk (negative x is in front of the bark, as
// the camera sees it), so the limbs wrap round it.
export const BEAR_LIMBS: BearLimb[] = [
  { name: 'far hind', near: false, pivot: [0.26, -0.15], upper: 0.3, lower: 0.32, reachUp: 0.02, bark: -0.06, grab: 0, front: false },
  { name: 'near fore', near: true, pivot: [0.22, -0.98], upper: 0.32, lower: 0.3, reachUp: -0.3, bark: -0.14, grab: 0.02, front: true },
  { name: 'near hind', near: true, pivot: [0.3, -0.18], upper: 0.3, lower: 0.32, reachUp: 0.02, bark: -0.08, grab: 0.5, front: false },
  { name: 'far fore', near: false, pivot: [0.18, -1.0], upper: 0.32, lower: 0.3, reachUp: -0.3, bark: -0.1, grab: 0.52, front: true },
];

// How high the bear's rump is on the trunk at `time`, m.
export function bearHeight(time: number): number {
  'worklet';
  return START_HEIGHT + CLIMB_SPEED * time;
}

// Half the trunk's width at `height` m up it: the mature pine's trunk (see
// art.ts) tapers from its root flare to where its crown starts.
export function trunkHalfWidth(height: number): number {
  'worklet';
  const h = height / BEAR_TREE.height;
  const girth = 0.62;
  const unit = h < 0.05 ? 0.05 + (0.028 - 0.05) * (h / 0.05) : 0.028 + (0.016 - 0.028) * Math.min((h - 0.05) / (0.46 + 0.08 - 0.05), 1);
  return unit * girth * BEAR_TREE.height;
}

// Where the bear's frame sits across the trail: on the trunk's surface, on
// the trail side, at the height of its rump.
export function bearX(time: number): number {
  'worklet';
  return BEAR_TREE.x + trunkHalfWidth(bearHeight(time));
}

export interface BearPose {
  rise: number; // m the rump is above the ground
  sway: number; // body roll against the trunk, degrees
  lift: number; // head lift, degrees
  limbs: { pivot: number[]; joint: number[]; paw: number[]; gripping: boolean }[];
}

export function bearPose(time: number): BearPose {
  'worklet';
  const phase = (time / CLIMB_CYCLE) % 1;
  const limbs = [];
  for (let i = 0; i < BEAR_LIMBS.length; i++) {
    const limb = BEAR_LIMBS[i];
    const p = (((phase - limb.grab) % 1) + 1) % 1; // 0 when it takes hold
    let dy: number;
    let dx = limb.bark - limb.pivot[0];
    let gripping = true;
    if (p < GRIP) {
      // Gripping: the body climbs past it, so it moves down relative to the
      // body while staying at one height on the bark.
      dy = limb.reachUp + STROKE * (p / GRIP - 0.5);
    } else {
      // Reaching: lets go, pulls away from the bark a little, and reaches up
      // to take hold higher.
      const u = (p - GRIP) / (1 - GRIP);
      const up = u - Math.sin(2 * Math.PI * u) / (2 * Math.PI);
      dy = limb.reachUp + STROKE * (0.5 - up);
      dx += 0.07 * Math.sin(Math.PI * u);
      gripping = false;
    }
    // Two-bone IK: elbows drop and wrap round the trunk; knees come up
    // toward the chest.
    const a = limb.upper;
    const b = limb.lower;
    const d = Math.min(Math.max(Math.hypot(dx, dy), Math.abs(a - b) + 1e-4), a + b - 1e-4);
    const spread = Math.acos((a * a + d * d - b * b) / (2 * a * d));
    const toward = Math.atan2(dy, dx);
    const bend = toward + (limb.front ? -spread : spread);
    const joint = [limb.pivot[0] + a * Math.cos(bend), limb.pivot[1] + a * Math.sin(bend)];
    limbs.push({ pivot: limb.pivot, joint, paw: [limb.pivot[0] + dx, limb.pivot[1] + dy], gripping });
  }
  return {
    rise: bearHeight(time),
    sway: 2 * Math.sin(2 * Math.PI * phase * 2),
    lift: 6 * Math.sin(2 * Math.PI * phase + 1),
    limbs,
  };
}

// ---------------------------------------------------------------------------
// Shapes — SVG path strings, metres, y up negative
// ---------------------------------------------------------------------------

export const BEAR_ART = {
  // Body pressed to the trunk: belly against the bark, a high shoulder hump,
  // a round rump.
  body:
    'M-0.04 -0.05C-0.06 -0.4 -0.04 -0.75 0.04 -0.98C0.1 -1.12 0.26 -1.16 0.38 -1.08' +
    'C0.52 -1 0.6 -0.82 0.6 -0.6C0.6 -0.35 0.58 -0.15 0.5 -0.02C0.42 0.1 0.24 0.14 0.12 0.1C0.04 0.08 -0.02 0.03 -0.04 -0.05Z',
  // Light catching the fur along its back.
  rim: 'M0.56 -0.95C0.62 -0.7 0.61 -0.3 0.52 -0.06L0.49 -0.08C0.57 -0.3 0.58 -0.68 0.53 -0.93Z',
  // Head, turned up the trunk, with its tan muzzle, round ears and eye.
  head: 'M0.06 -1.2C0.04 -1.32 0.1 -1.4 0.2 -1.4C0.32 -1.4 0.38 -1.32 0.36 -1.22C0.34 -1.14 0.26 -1.1 0.18 -1.1C0.12 -1.1 0.07 -1.14 0.06 -1.2Z',
  muzzle: 'M0.06 -1.3C0.02 -1.36 0.02 -1.46 0.08 -1.48C0.13 -1.49 0.17 -1.44 0.16 -1.38Z',
  nose: 'M0.045 -1.47a0.025 0.025 0 1 0 0.05 0a0.025 0.025 0 1 0 -0.05 0Z',
  ears: 'M0.18 -1.41a0.045 0.045 0 1 0 0.09 0a0.045 0.045 0 1 0 -0.09 0Z' + 'M0.27 -1.37a0.04 0.04 0 1 0 0.08 0a0.04 0.04 0 1 0 -0.08 0Z',
  eye: 'M0.14 -1.3a0.013 0.013 0 1 0 0.026 0a0.013 0.013 0 1 0 -0.026 0Z',
  // A paw, gripping the bark, claws toward the trunk (-x).
  paw: 'M-0.06 -0.055L0.05 -0.06Q0.08 -0.03 0.07 0.03L-0.06 0.055Q-0.09 0 -0.06 -0.055Z',
  claws: 'M-0.06 -0.05L-0.1 -0.035L-0.06 -0.025ZM-0.06 -0.008L-0.105 0.004L-0.06 0.016ZM-0.06 0.03L-0.098 0.045L-0.06 0.05Z',
};
