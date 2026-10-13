// The flock that bursts out of the bear's tree.
//
// Before they fly, the birds are perched inside the crown, just behind the
// tree as the camera sees it, so the crown hides them. When the flock goes
// up, each bird first flies out sideways and upward — clear of the crown's
// outline — before drifting toward or away from us, so every bird comes out
// from behind the tree instead of appearing in front of it. Positions are in
// the world, in metres; the scene projects them like everything else.

import { BEAR_TREE } from './bear';

// When the flock goes up, s after the intro starts.
export const FLOCK_AT = 2.45;
export const FLOCK_SIZE = 32;
// Time to fly out clear of the crown before drifting along the trail.
const CLEAR_FOR = 0.28;

export interface Bird {
  perch: [number, number, number]; // x, height, s
  delay: number; // s after FLOCK_AT
  out: [number, number]; // sideways and upward speed, m/s
  along: number; // toward (-) or away (+) from us once clear, m/s
  wander: number; // radians, for the weave in its flight
  flap: number; // wingbeats per second
  size: number; // wingspan, m
}

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

export const FLOCK: Bird[] = (() => {
  const random = seeded(777);
  const h = BEAR_TREE.height;
  return Array.from({ length: FLOCK_SIZE }, () => {
    const height = h * (0.56 + random() * 0.24);
    // Most head right, out across the trail; a few break away to the left.
    // Mostly level, a little up, and on away from us once clear.
    const right = random() < 0.75 ? 1 : -1;
    return {
      perch: [BEAR_TREE.x + (random() - 0.5) * 2.2, height, BEAR_TREE.s + 0.3 + random() * 0.5] as [number, number, number],
      delay: Math.pow(random(), 1.5) * 0.2,
      out: [right * (6 + random() * 5), -0.5 + random() * 3] as [number, number],
      along: 1 + random() * 6,
      wander: random() * Math.PI * 2,
      flap: 7 + random() * 3,
      size: 0.6 + random() * 0.3,
    };
  });
})();

export interface BirdState {
  x: number;
  height: number;
  s: number;
  flap: number; // 0–1 through the wingbeat
  bank: number; // degrees
  flying: boolean;
}

// Where a bird is at `time`, and what its wings are doing.
export function birdAt(bird: Bird, time: number): BirdState {
  'worklet';
  const flown = time - FLOCK_AT - bird.delay;
  if (flown <= 0) {
    return { x: bird.perch[0], height: bird.perch[1], s: bird.perch[2], flap: 0.35, bank: 0, flying: false };
  }
  // Out and up at a steady speed, climbing a little more as it goes, with a
  // slight weave; along the trail only once clear of the crown.
  const along = flown > CLEAR_FOR ? bird.along * (flown - CLEAR_FOR) : 0;
  const weave = 0.25 * Math.sin(bird.wander + flown * 6) - 0.25 * Math.sin(bird.wander);
  return {
    x: bird.perch[0] + bird.out[0] * flown + weave,
    height: bird.perch[1] + bird.out[1] * flown + 0.8 * flown * flown,
    s: bird.perch[2] + along,
    flap: (flown * bird.flap) % 1,
    bank: 14 * Math.sin(bird.wander + flown * 4) - Math.sign(bird.out[0]) * 8,
    flying: true,
  };
}

// A bird seen from below or behind, wingspan 1, body at the origin: six
// moments through a wingbeat, wings from raised high to swept down.
const WING_POSES = [0.55, 0.3, 0, -0.3, -0.5, 0.1];
export const BIRD_FRAMES: string[] = WING_POSES.map((lift) => {
  const f = (n: number) => n.toFixed(3);
  const tipY = -lift * 0.35;
  const elbowY = -lift * 0.16 - 0.03;
  const wing = (side: 1 | -1) =>
    `M0 -0.03L${f(side * 0.22)} ${f(elbowY - 0.03)}L${f(side * 0.5)} ${f(tipY)}` +
    `L${f(side * 0.24)} ${f(elbowY + 0.03)}L0 0.04Z`;
  const body = 'M-0.045 -0.02Q0 -0.1 0.045 -0.02Q0.05 0.12 0 0.2Q-0.05 0.12 -0.045 -0.02Z';
  return wing(1) + wing(-1) + body;
});
