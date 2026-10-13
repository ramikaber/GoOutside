// Peggy's Cove lighthouse, on its granite outcrop to the left of the trail,
// across from the falls: we see the two together, the falls on the right and
// the lighthouse on the left.
//
// It's built the way the CN Tower is (tower.ts): a fixed spot in the world,
// drawn flat, facing the camera, which is exact for a round tower seen by a
// level camera. The parts that stick out sideways (its footing on the rock,
// the gallery round the lantern, the lantern and its roof) are horizontal
// rings, projected point by point as they'd really look from where the
// camera is: from below, we see the gallery's underside and the eaves.
//
// Shapes are in the lighthouse's own units: height 1, origin on the ground
// at its centre, up is -y (as on screen).

import type { Ring } from './tower';

// Where it stands, m: left of the trail, a little past the stream, at the
// forest's edge where the meadow opens; and how tall it is to the tip of
// its rod.
export const LIGHTHOUSE_X = -6;
export const LIGHTHOUSE_S = 88;
export const LIGHTHOUSE_HEIGHT = 16;

// The bare granite it stands on, m: this far round it, the edge ragged. It
// stops short of the stream.
export const GRANITE_RADIUS = 5.5;

// The tower: a plinth, then a white shaft tapering up to the gallery.
export const LIGHTHOUSE_FOOTING: Ring = { height: 0, radius: 0.118 };
export const PLINTH_TOP = 0.03;
export const SHAFT = { bottom: 0.108, top: 0.074, height: 0.74 };
// The gallery: its deck, a walkway round the lantern, and the top rail of
// its railing.
export const GALLERY = {
  deck: { height: 0.74, radius: 0.1 },
  deckTop: { height: 0.752, radius: 0.1 },
  rail: { height: 0.797, radius: 0.097 },
};
// The lantern room, glazed, under a red roof with a ventilator ball on top.
export const LANTERN = {
  bottom: { height: 0.752, radius: 0.058 },
  top: { height: 0.88, radius: 0.058 },
  eaves: { height: 0.88, radius: 0.069 },
  apex: 0.95,
  ball: { height: 0.965, radius: 0.013 },
};
// Posts round the railing, and the lantern's glazing bars, every so many
// degrees round.
export const RAIL_POSTS = 16;
export const GLAZING_BARS = 10;

// Its radius at a height, in its own units: the shaft's taper.
export function lighthouseRadius(height: number): number {
  'worklet';
  if (height < PLINTH_TOP) return LIGHTHOUSE_FOOTING.radius;
  return SHAFT.bottom + ((SHAFT.top - SHAFT.bottom) * (height - PLINTH_TOP)) / (SHAFT.height - PLINTH_TOP);
}

const f = (n: number) => n.toFixed(4);

export const LIGHTHOUSE_ART = {
  // The plinth and the shaft, up to the gallery deck.
  body:
    `M${f(-LIGHTHOUSE_FOOTING.radius)} 0L${f(-LIGHTHOUSE_FOOTING.radius)} ${f(-PLINTH_TOP)}` +
    `L${f(-SHAFT.bottom)} ${f(-PLINTH_TOP - 0.006)}L${f(-SHAFT.top)} ${f(-SHAFT.height)}` +
    `L${f(SHAFT.top)} ${f(-SHAFT.height)}L${f(SHAFT.bottom)} ${f(-PLINTH_TOP - 0.006)}` +
    `L${f(LIGHTHOUSE_FOOTING.radius)} ${f(-PLINTH_TOP)}L${f(LIGHTHOUSE_FOOTING.radius)} 0Z`,
  // The plinth's band, a shade darker than the shaft.
  plinth: `M${f(-LIGHTHOUSE_FOOTING.radius)} 0L${f(-LIGHTHOUSE_FOOTING.radius)} ${f(-PLINTH_TOP)}L${f(LIGHTHOUSE_FOOTING.radius)} ${f(-PLINTH_TOP)}L${f(LIGHTHOUSE_FOOTING.radius)} 0Z`,
  // A door, and a window up the shaft: each centred on its own origin, set
  // on the shaft's surface as it turns past us.
  door: 'M-0.016 0L-0.016 -0.06Q-0.016 -0.074 0 -0.074Q0.016 -0.074 0.016 -0.06L0.016 0Z',
  window: 'M-0.009 0.014L-0.009 -0.014L0.009 -0.014L0.009 0.014Z',
  // The rod above the ventilator ball, to the very top.
  rod: 'M-0.0018 -0.965L-0.0008 -1L0.0008 -1L0.0018 -0.965Z',
};
// How high the door and the window are, and which way round the tower each
// faces: radians from the side facing straight down the trail at us,
// positive toward the trail.
export const DOOR = { height: PLINTH_TOP, facing: 0.6 };
export const WINDOW = { height: 0.5, facing: -0.35 };

// Granite boulders round its foot, m from its centre (x across, s along) and
// their width: big ones to its sides and behind it, lower ones in front,
// each well to one side of our line of sight to it while we see it whole
// (from about 0.25 across for every 1 back toward us), so none stands
// between the trail and its base.
export const BOULDERS: { x: number; s: number; size: number; variant: number }[] = [
  { x: -3.6, s: 1.5, size: 3.2, variant: 2 },
  { x: -4.4, s: -1, size: 2.4, variant: 4 },
  { x: -2.6, s: -3.3, size: 1.6, variant: 0 },
  { x: 2.8, s: 2.2, size: 2.6, variant: 5 },
  { x: 3.8, s: -0.4, size: 1.8, variant: 1 },
  { x: 3.6, s: -3.4, size: 1.2, variant: 3 },
  { x: -0.6, s: 3.6, size: 3, variant: 3 },
  { x: 1.6, s: 3.4, size: 1.4, variant: 0 },
  { x: -5.2, s: 2.6, size: 1.6, variant: 5 },
];
