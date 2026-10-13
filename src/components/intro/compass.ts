// The finale: the compass from the app's logo, high in the sky under the
// word. It springs in, the plane flies through its ring and away into the
// distance, and it spins like a loading dial as the intro hands over to the
// app.
//
// Like the word, it's fixed in the sky facing us, at its own distance: the
// plane passes through it, so it has one.

// When it springs in, when it starts to spin, and when the plane passes
// through it, s into the intro.
export const COMPASS_AT = 5.4;
export const SPIN_FROM = 6.0;
export const CROSS_AT = 5.85;
// From when the whole intro gives way to the app, s.
export const HANDOFF_FROM = 6.5;

// How far off it is, m: beyond the word, so the plane, leaving the word,
// flies away from us through it.
export const COMPASS_DEPTH = 180;
// Its centre on screen (a share of the height from the top) and its radius
// to the bezel's middle (a share of the width).
export const COMPASS_CENTRE_Y = 0.36;
export const COMPASS_RADIUS = 0.22;
// The logo's own units: a 100-unit square, centred at 50, bezel radius 47.
export const LOGO_CENTRE = 50;
export const LOGO_BEZEL = 47;

// Where the plane goes through: between the star's arms and the bezel, on
// the diagonal between N and E, where nothing of the logo is in the way.
export const GAP_ANGLE = Math.PI / 4;
export const GAP_RADIUS = 28;

// How big it is at `time`, 0 to 1: a spring, out from nothing at
// COMPASS_AT, overshooting a little, then settling.
export function compassScale(time: number): number {
  'worklet';
  const u = time - COMPASS_AT;
  if (u <= 0) return 0;
  const omega = 14;
  const zeta = 0.55;
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * u) * (Math.cos(damped * u) + ((zeta * omega) / damped) * Math.sin(damped * u));
}

// How far it has turned at `time`, radians clockwise: still until
// SPIN_FROM, then picking up speed to about a turn a second, about one
// turn in all by the end of the intro.
const SPIN_EASE = 0.2;
const SPIN_RATE = 8.95;
export function compassTurn(time: number): number {
  'worklet';
  const u = time - SPIN_FROM;
  if (u <= 0) return 0;
  return SPIN_RATE * (u - SPIN_EASE * (1 - Math.exp(-u / SPIN_EASE)));
}

export interface CompassPlacement {
  cx: number; // px
  cy: number;
  unit: number; // px per logo unit at full size
}

export function compassPlacement(width: number, height: number): CompassPlacement {
  'worklet';
  return { cx: width / 2, cy: COMPASS_CENTRE_Y * height, unit: (COMPASS_RADIUS * width) / LOGO_BEZEL };
}
