// The hiker standing at the trail's edge, facing us, who raises an arm and
// waves as we come up the trail.
//
// Everything is in metres, seen from the front: the origin is on the ground
// between the hiker's boots, +x is our right (the hiker's left) and up is -y
// (as on screen). The scene places this frame in the world like any other
// sprite. Arms are pairs of bones turned at the shoulder and elbow; their
// angles are measured on screen, 0° pointing right and 90° pointing down.

// When the waving arm starts to rise, how long it takes to come up, and how
// fast the wave goes, waves per second.
export const RAISE_AT = 0.95;
const RAISE_FOR = 0.15;
export const WAVE_AT = RAISE_AT + RAISE_FOR;
export const WAVE_RATE = 2.5;

export const UPPER_ARM = 0.3;
export const FOREARM = 0.27;

// The hiker's right arm is on our left.
export const WAVING_SHOULDER: [number, number] = [-0.22, -1.4];
export const HOLDING_SHOULDER: [number, number] = [0.22, -1.4];

export interface HikerPose {
  sway: number; // lean from the boots, degrees
  waving: { upper: number; fore: number }; // arm angles, degrees
  holding: { upper: number; fore: number };
  wave: number; // -1 to 1 through each wave, 0 before it starts
}

function smoothstep(from: number, to: number, x: number) {
  'worklet';
  const u = Math.min(Math.max((x - from) / (to - from), 0), 1);
  return u * u * (3 - 2 * u);
}

export function hikerPose(time: number): HikerPose {
  'worklet';
  // A slow shift of weight from foot to foot.
  const sway = 1.2 * Math.sin(2 * Math.PI * 0.6 * time + 0.4);
  // The arm comes up from the side, the hand going up past the head…
  const raised = smoothstep(RAISE_AT, WAVE_AT, time);
  // …then the forearm swings side to side from the elbow, the upper arm
  // giving a little with it.
  const wave = time > WAVE_AT ? Math.sin(2 * Math.PI * WAVE_RATE * (time - WAVE_AT)) : 0;
  return {
    sway,
    waving: {
      upper: 97 + (215 - 97) * raised + 4 * wave,
      fore: 92 + (262 - 92) * raised + 28 * wave,
    },
    // The other hand holds a trekking pole planted beside the boots.
    holding: { upper: 84, fore: 68 },
    wave,
  };
}

// Where an arm's elbow and hand are, from its shoulder and angles.
export function armJoints(shoulder: [number, number], upper: number, fore: number) {
  'worklet';
  const a = (upper * Math.PI) / 180;
  const b = (fore * Math.PI) / 180;
  const elbow: [number, number] = [shoulder[0] + UPPER_ARM * Math.cos(a), shoulder[1] + UPPER_ARM * Math.sin(a)];
  const hand: [number, number] = [elbow[0] + FOREARM * Math.cos(b), elbow[1] + FOREARM * Math.sin(b)];
  return { elbow, hand };
}

// ---------------------------------------------------------------------------
// Shapes — SVG path strings, metres, y up negative
// ---------------------------------------------------------------------------

const mirror = (d: string) =>
  // Flips x in a path made only of absolute M/L/Q/Z commands.
  d.replace(/([MLQ])([^MLQZ]+)/g, (_, command: string, args: string) => {
    const numbers = args.trim().split(/[\s,]+/).map(Number);
    const flipped = numbers.map((n, i) => (i % 2 === 0 ? -n : n));
    return command + flipped.join(' ');
  });

const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z`;
const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y}L${x + w} ${y}L${x + w} ${y + h}L${x} ${y + h}Z`;

const leftLeg = 'M-0.21 -0.93L-0.18 -0.52L-0.17 -0.12L-0.05 -0.12L-0.04 -0.52L-0.01 -0.84Z';
const leftLegShade = 'M-0.1 -0.86L-0.1 -0.52L-0.11 -0.12L-0.05 -0.12L-0.04 -0.52L-0.01 -0.84Z';
const leftBoot = 'M-0.2 0L-0.2 -0.07Q-0.2 -0.14 -0.14 -0.14L-0.06 -0.14Q-0.03 -0.14 -0.03 -0.1L-0.03 0Z';
const leftStrap = 'M-0.15 -1.44L-0.1 -1.44L-0.1 -1.02L-0.14 -1.02Z';

export const HIKER_ART = {
  // The pack's top, showing above the shoulders.
  pack: 'M-0.17 -1.38L-0.16 -1.6Q0 -1.67 0.16 -1.6L0.17 -1.38Z',
  legs: leftLeg + mirror(leftLeg),
  legShade: leftLegShade + mirror(leftLegShade),
  boots: leftBoot + mirror(leftBoot),
  // A red plaid jacket, down over the hips.
  jacket:
    'M-0.24 -0.84L-0.25 -1.2Q-0.26 -1.38 -0.2 -1.43L-0.07 -1.47L0.07 -1.47L0.2 -1.43Q0.26 -1.38 0.25 -1.2' +
    'L0.24 -0.84Q0 -0.8 -0.24 -0.84Z',
  // The plaid's darker checks, cut to the jacket by the scene.
  plaid:
    [-0.17, -0.07, 0.03, 0.13].map((x) => rect(x, -1.5, 0.035, 0.7)).join('') +
    [-0.96, -1.08, -1.2, -1.32].map((y) => rect(-0.3, y, 0.6, 0.035)).join(''),
  straps: leftStrap + mirror(leftStrap) + rect(-0.14, -1.21, 0.28, 0.03),
  neck: rect(-0.045, -1.52, 0.09, 0.08),
  head: ellipse(0, -1.6, 0.095, 0.115),
  beard: 'M-0.092 -1.6Q-0.09 -1.5 0 -1.485Q0.09 -1.5 0.092 -1.6Q0.06 -1.555 0 -1.555Q-0.06 -1.555 -0.092 -1.6Z',
  mouth: 'M-0.032 -1.548Q0 -1.522 0.032 -1.548Q0 -1.534 -0.032 -1.548Z',
  eyes: circle(-0.035, -1.615, 0.011) + circle(0.035, -1.615, 0.011),
  // A knit toque with a folded cuff and a pom-pom.
  toque: 'M-0.1 -1.64Q-0.1 -1.78 0 -1.79Q0.1 -1.78 0.1 -1.64Z',
  cuff: rect(-0.105, -1.685, 0.21, 0.05),
  pom: circle(0, -1.8, 0.032),
  hand: circle(0, 0, 0.042),
};
