// A white-tailed buck trotting across the trail: its shapes, and the gait
// that moves its legs.
//
// Everything is in metres in the deer's own frame, seen from its right
// side: the origin is on the ground under the middle of its body, +x is the
// way it's walking, and up is -y (as on screen). The scene places this frame
// in the world like any other sprite.
//
// The legs are driven by where each hoof should be, not by swinging angles:
// a trot, diagonal legs landing together, each leg planted on the ground for
// part of the stride and swung forward for the rest. While a hoof is planted
// it stays on the same spot on the ground; the knee and hock follow from
// two-bone IK.

// ---------------------------------------------------------------------------
// The trot
// ---------------------------------------------------------------------------

// Trotting speed, m/s, and how long one full stride (all four legs) takes, s.
export const DEER_SPEED = 4;
export const DEER_STRIDE = 0.43;
// Share of the stride each hoof spends on the ground. Under half is a
// running gait: twice a stride, between one diagonal pair lifting and the
// other landing, all four hooves are off the ground.
const DUTY = 0.4;
// How far a planted hoof travels backward under the body while it's down.
const STEP = DEER_SPEED * DEER_STRIDE * DUTY;

export interface DeerLeg {
  name: string;
  near: boolean; // the side facing the camera, drawn over the body
  hip: [number, number]; // pivot at the shoulder or hip
  upper: number; // shoulder→knee or hip→hock, m
  lower: number; // knee or hock→hoof, m
  touchdown: number; // when in the stride this hoof lands, 0–1
  reach: number; // hoof's mid-stance position ahead of the pivot, m
  lift: number; // how high the hoof rises mid-swing, m
  front: boolean; // front legs bend forward at the knee, hind legs back at the hock
}

// Trot: diagonal pairs land together, left hind with right fore, then half
// a stride later right hind with left fore, the forefoot a moment after the
// hind as in a real trot. The camera sees the deer's right side.
export const DEER_LEGS: DeerLeg[] = [
  { name: 'left hind', near: false, hip: [-0.4, -0.9], upper: 0.48, lower: 0.54, touchdown: 0, reach: -0.02, lift: 0.15, front: false },
  { name: 'left fore', near: false, hip: [0.36, -0.88], upper: 0.5, lower: 0.52, touchdown: 0.52, reach: 0.06, lift: 0.2, front: true },
  { name: 'right hind', near: true, hip: [-0.4, -0.9], upper: 0.48, lower: 0.54, touchdown: 0.5, reach: -0.02, lift: 0.15, front: false },
  { name: 'right fore', near: true, hip: [0.36, -0.88], upper: 0.5, lower: 0.52, touchdown: 0.02, reach: 0.06, lift: 0.2, front: true },
];

// Where a leg's hoof is, relative to its pivot, at `phase` (0–1) through the
// stride; and whether it's on the ground.
export function hoofAt(leg: DeerLeg, phase: number): { x: number; y: number; planted: boolean } {
  'worklet';
  const p = (((phase - leg.touchdown) % 1) + 1) % 1; // 0 at touchdown
  const ground = -leg.hip[1];
  if (p < DUTY) {
    // Planted: the body moves on over it, so relative to the pivot it slides
    // back at the deer's speed while staying put on the ground.
    const u = p / DUTY;
    return { x: leg.reach + STEP * (0.5 - u), y: ground, planted: true };
  }
  // Swinging: lifts, swings forward and sets down, easing in and out so it
  // leaves and meets the ground without a jolt.
  const u = (p - DUTY) / (1 - DUTY);
  const forward = u - Math.sin(2 * Math.PI * u) / (2 * Math.PI);
  return {
    x: leg.reach + STEP * (forward - 0.5),
    y: ground - leg.lift * Math.pow(Math.sin(Math.PI * u), 1.3),
    planted: false,
  };
}

// The middle joint (knee or hock) for a hoof at (x, y) from the pivot, by
// two-bone IK: the joint bends forward on front legs and back on hind legs.
export function jointFor(leg: DeerLeg, x: number, y: number): [number, number] {
  'worklet';
  const a = leg.upper;
  const b = leg.lower;
  const d = Math.min(Math.max(Math.hypot(x, y), Math.abs(a - b) + 1e-4), a + b - 1e-4);
  const toHoof = Math.atan2(y, x);
  const spread = Math.acos((a * a + d * d - b * b) / (2 * a * d));
  // Down is +y; turning toward -x from the pivot→hoof line puts the joint
  // in front for these downward-pointing legs, so front legs take the
  // negative turn.
  const angle = toHoof + (leg.front ? -spread : spread);
  return [a * Math.cos(angle), a * Math.sin(angle)];
}

export interface DeerPose {
  bob: number; // body's rise and fall, m (negative is up)
  nod: number; // head and neck swing, degrees
  tail: number; // tail angle: raised like a flag, flicking, degrees
  legs: { hip: [number, number]; joint: [number, number]; hoof: [number, number]; planted: boolean }[];
}

// The whole pose `time` seconds into the trot, in the deer's frame.
export function deerPose(time: number): DeerPose {
  'worklet';
  const phase = (time / DEER_STRIDE) % 1;
  // The body sinks onto each diagonal pair mid-stance and rises through the
  // moment all four hooves are off the ground, twice a stride. The head is
  // held steadier than at a walk. A startled white-tail runs with its tail
  // up, showing the white underneath.
  const bob = 0.03 * Math.cos(4 * Math.PI * (phase - DUTY / 2));
  const nod = 1.5 * Math.sin(4 * Math.PI * phase + 0.8);
  const tail = 80 + 8 * Math.sin(2 * Math.PI * (time / 0.5));
  const legs = [];
  for (let i = 0; i < DEER_LEGS.length; i++) {
    const leg = DEER_LEGS[i];
    const hoof = hoofAt(leg, phase);
    // The pivot rides with the body; the hoof is measured from where the
    // pivot would be with no bob, so a planted hoof stays on the ground.
    const hip: [number, number] = [leg.hip[0], leg.hip[1] + bob];
    const reachX = hoof.x;
    const reachY = hoof.y - bob;
    const joint = jointFor(leg, reachX, reachY);
    legs.push({
      hip,
      joint: [hip[0] + joint[0], hip[1] + joint[1]] as [number, number],
      hoof: [hip[0] + reachX, hip[1] + reachY] as [number, number],
      planted: hoof.planted,
    });
  }
  return { bob, nod, tail, legs };
}

// ---------------------------------------------------------------------------
// Shapes — SVG path strings, metres, y up negative
// ---------------------------------------------------------------------------

export const DEER_ART = {
  // Torso: withers high over the shoulders, a straight back, rounded rump,
  // and a belly that tucks up toward the flank.
  body:
    'M0.52 -1.0C0.4 -1.06 0.1 -1.02 -0.2 -1.01C-0.42 -1.01 -0.6 -0.97 -0.64 -0.86' +
    'C-0.68 -0.76 -0.6 -0.66 -0.5 -0.64C-0.36 -0.62 -0.28 -0.64 -0.16 -0.62' +
    'C0.0 -0.58 0.22 -0.6 0.34 -0.64C0.46 -0.66 0.56 -0.72 0.58 -0.82C0.6 -0.9 0.58 -0.96 0.52 -1.0Z',
  // Pale belly and inner flank, over the body.
  belly:
    'M-0.36 -0.64C-0.2 -0.61 0.0 -0.58 0.2 -0.6C0.3 -0.61 0.36 -0.63 0.38 -0.65' +
    'C0.2 -0.66 0.0 -0.66 -0.18 -0.67C-0.28 -0.67 -0.34 -0.66 -0.36 -0.64Z',
  // Neck rising from the shoulders to the head.
  neck: 'M0.4 -0.98C0.5 -1.12 0.6 -1.3 0.68 -1.46L0.86 -1.36C0.78 -1.2 0.66 -1.0 0.6 -0.84C0.54 -0.86 0.46 -0.92 0.4 -0.98Z',
  // White throat patch.
  throat: 'M0.78 -1.28C0.74 -1.22 0.72 -1.18 0.7 -1.13L0.76 -1.1C0.78 -1.16 0.8 -1.22 0.84 -1.27Z',
  // Head: forehead, long muzzle, jaw.
  head:
    'M0.64 -1.48C0.68 -1.56 0.78 -1.56 0.84 -1.5C0.9 -1.46 0.98 -1.42 1.04 -1.38' +
    'C1.06 -1.36 1.05 -1.32 1.01 -1.31C0.94 -1.3 0.88 -1.3 0.82 -1.32C0.74 -1.36 0.66 -1.4 0.64 -1.48Z',
  nose: 'M1.0 -1.37C1.03 -1.37 1.05 -1.35 1.05 -1.33C1.04 -1.31 1.01 -1.31 0.99 -1.32Z',
  eye: 'M0.8 -1.47a0.013 0.013 0 1 0 0.026 0a0.013 0.013 0 1 0 -0.026 0Z',
  // Ears, swept back and up.
  ears: 'M0.7 -1.52C0.64 -1.6 0.58 -1.66 0.54 -1.66C0.56 -1.6 0.62 -1.54 0.68 -1.5Z' + 'M0.74 -1.53C0.7 -1.62 0.66 -1.68 0.62 -1.7C0.63 -1.63 0.68 -1.56 0.72 -1.51Z',
  // Antlers: a main beam curving back then forward, with tines rising off
  // it. Stroked, not filled.
  antlers:
    'M0.74 -1.54C0.68 -1.66 0.66 -1.76 0.74 -1.82C0.8 -1.86 0.88 -1.84 0.94 -1.78' +
    'M0.7 -1.7L0.68 -1.8M0.76 -1.81L0.76 -1.92M0.86 -1.83L0.88 -1.93' +
    'M0.78 -1.53C0.74 -1.62 0.74 -1.7 0.8 -1.75C0.84 -1.78 0.9 -1.76 0.95 -1.72M0.82 -1.74L0.83 -1.82',
  // Tail, drawn pointing back from its root, which is at the origin here;
  // the scene places and flicks it. White underneath.
  tail: 'M0 0C-0.05 0.0 -0.1 0.03 -0.13 0.08C-0.1 0.1 -0.05 0.08 -0.01 0.04Z',
  tailRoot: [-0.6, -0.95] as [number, number],
  // A leg bone, pointing down (+y) from its top joint, `length` long and
  // tapering from `top` wide to `bottom` wide.
} as const;

export function legBone(length: number, top: number, bottom: number): string {
  const t = top / 2;
  const b = bottom / 2;
  const f = (n: number) => n.toFixed(4);
  return (
    `M${f(-t)} 0C${f(-t)} ${f(-t)} ${f(t)} ${f(-t)} ${f(t)} 0` +
    `L${f(b)} ${f(length)}C${f(b)} ${f(length + b)} ${f(-b)} ${f(length + b)} ${f(-b)} ${f(length)}Z`
  );
}

// A hoof, its sole on y = 0 and its toe pointing +x.
export const HOOF = 'M-0.03 -0.05L0.02 -0.05L0.05 0L-0.035 0Z';
