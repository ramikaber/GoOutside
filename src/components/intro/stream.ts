// The stream that runs out of the falls' pond and under the trail, over a
// plank footbridge, then winds away through the forest on the left.
//
// The stream is part of the ground: the ground shader cuts its channel
// into the ground and follows each line of sight down into it, so the near
// bank hides the water close under it and the far bank's earth wall shows,
// with true depth. The footbridge is real 3D too, drawn among the sprites.
//
// World coordinates as everywhere: x across the trail (positive right), s
// along it, heights above the ground, metres.

// Where the stream crosses the trail, m along it. We pass over the bridge
// at 79 / 18 ≈ 4.4 s.
export const STREAM_S = 79;
// Half its width, m.
export const STREAM_HALF_WIDTH = 0.9;
// How far below the banks its water runs, m, once clear of the pond.
export const STREAM_DEPTH = 0.16;
// It leaves the pond here (x, m) and runs out to here, far off in the
// forest on the left.
export const STREAM_FROM_X = 2.4;
export const STREAM_TO_X = -45;
// How fast it flows, m/s, toward the left.
export const STREAM_SPEED = 1.3;

// Where the stream's middle is along the trail at `x` across it: square
// to the trail where it crosses, then bending away ahead of us as it winds
// off to the left.
export function streamCentre(x: number): number {
  'worklet';
  const bend = 1 - Math.exp(-(x * x) / 9);
  return STREAM_S + 0.055 * x * x + 0.9 * Math.sin(0.38 * x) * bend;
}

// How far its middle moves along the trail per metre across, for its
// true width where it runs at a slant.
export function streamSlope(x: number): number {
  'worklet';
  return (streamCentre(x + 0.01) - streamCentre(x - 0.01)) / 0.02;
}

// How far a spot on the ground is from the stream's middle, m, measured
// square to it; Infinity past its ends.
export function streamDistance(x: number, s: number): number {
  if (x > STREAM_FROM_X + 1 || x < STREAM_TO_X) return Infinity;
  const slope = streamSlope(x);
  return Math.abs(s - streamCentre(x)) / Math.sqrt(1 + slope * slope);
}

// The footbridge: a plank deck across the trail, its ends resting on the
// banks either side of the channel, with a log kerb along each edge.
export const BRIDGE = {
  halfWidth: 0.85, // across the trail, m
  s0: STREAM_S - 1.5, // along it, m
  s1: STREAM_S + 1.5,
  deck: 0.1, // top of the planks above the ground, m
  plank: 0.24, // each plank's width along the trail, and the gap between, m
  gap: 0.035,
  kerbWidth: 0.14, // the kerb logs, m
  kerbHeight: 0.13,
};

// Whether a spot is on the bridge or its ends, where no grass or stones go.
export function onBridge(x: number, s: number): boolean {
  return Math.abs(x) < BRIDGE.halfWidth + 0.3 && s > BRIDGE.s0 - 0.3 && s < BRIDGE.s1 + 0.3;
}
