// The CN Tower, standing in a clearing beside the trail.
//
// It's placed and projected like a tree — a fixed spot in the world, drawn
// facing the camera — which is exact for its shaft: a vertical, round tower
// seen by a level camera keeps vertical edges. The parts that stick out
// sideways (the pods, and the footing where it meets the ground) are
// horizontal rings, and those are projected point by point, as they'd really
// look from where the camera is: pods show their underside, more as we come
// closer, and the footing curves with the ground.
//
// Shapes are in the tower's own units: height 1, origin on the ground at its
// centre, up is -y (as on screen).

// Where it stands, m: to the right of the trail, and how tall it is.
export const TOWER_X = 6;
export const TOWER_S = 55;
export const TOWER_HEIGHT = 36;

// The paved plaza it stands on, and the path to it from the trail, m.
export const PLAZA_RADIUS = 5.5;
export const SIDE_PATH_HALF_WIDTH = 0.7;

// A horizontal ring of the tower: its height and radius, in tower units.
export interface Ring {
  height: number;
  radius: number;
}

export const FOOTING: Ring = { height: 0, radius: 0.09 };
// The main pod: its underside, a band of windows round it, and its roof.
export const POD = {
  bottom: { height: 0.6, radius: 0.068 },
  windowsBottom: { height: 0.622, radius: 0.068 },
  windowsTop: { height: 0.646, radius: 0.068 },
  top: { height: 0.67, radius: 0.066 },
};
export const SKY_POD = {
  bottom: { height: 0.79, radius: 0.022 },
  top: { height: 0.81, radius: 0.02 },
};

export const TOWER_ART = {
  // Base flaring out to the ground, then the shaft tapering up to the pod.
  body: 'M-0.09 0Q-0.05 -0.01 -0.042 -0.07L-0.016 -0.6L0.016 -0.6L0.042 -0.07Q0.05 -0.01 0.09 0Z',
  // The sunlit left side of the shaft and base.
  lit: 'M-0.09 0Q-0.05 -0.01 -0.042 -0.07L-0.016 -0.6L-0.003 -0.6L-0.006 -0.07L-0.008 0Z',
  // The shaded right side of the shaft and base, away from the sun.
  shade: 'M0.09 0Q0.05 -0.01 0.042 -0.07L0.016 -0.6L0.007 -0.6L0.018 -0.07L0.032 0Z',
  // The edges of its hexagonal core, running up the shaft.
  grooves: 'M-0.014 -0.08L-0.006 -0.58L-0.0045 -0.58L-0.0115 -0.08Z' + 'M0.0115 -0.08L0.0045 -0.58L0.006 -0.58L0.014 -0.08Z',
  // Between the pods, and the antenna mast above.
  upperShaft: 'M-0.01 -0.672L-0.007 -0.792L0.007 -0.792L0.01 -0.672Z',
  antenna: 'M-0.005 -0.808L-0.0012 -1L0.0012 -1L0.005 -0.808Z',
  antennaBands: 'M-0.004 -0.86L0.004 -0.86L0.0036 -0.875L-0.0036 -0.875Z' + 'M-0.0028 -0.92L0.0028 -0.92L0.0024 -0.935L-0.0024 -0.935Z',
  beacon: 'M-0.004 -1a0.004 0.004 0 1 0 0.008 0a0.004 0.004 0 1 0 -0.008 0Z',
};
