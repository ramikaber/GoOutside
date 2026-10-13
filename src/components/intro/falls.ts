// Niagara Falls: an escarpment running beside the trail on its right, with a
// horseshoe falls pouring off its lip toward the trail into a pond.
//
// Unlike the sprites, this is real 3D geometry: the rock face and the
// falling water are surfaces in the world, and every point of them is
// projected from where the camera is, like the ground. The falls face the
// trail, so as we come up to them we see the water side-on — the curtain
// arcing out from the lip and down into the pond — with the horseshoe's far
// arm turned toward us.
//
// Both surfaces are cut into thin columns across the trail's direction and
// drawn in among the sprites, furthest first. That order is exact for them:
// along any line of sight from the camera, which only ever looks forward,
// whatever is nearer is also less far along the trail.
//
// World coordinates as everywhere: x across the trail (positive right), s
// along it, heights above the ground, metres.

// The rock face runs straight along x = CLIFF_X between FACE_S0 and
// FACE_S1, then curves away from the trail at both ends, so from the trail
// the escarpment has a near end wall turned toward us and a far end that
// bends out of sight. The plateau is everything beyond the face.
export const CLIFF_X = 8;
export const CLIFF_HEIGHT = 12;
export const FACE_S0 = 65;
export const FACE_S1 = 93;
// How sharply the ends curve away: the face is (d / CURVE)² m further out,
// d metres past the straight part.
export const CURVE = 2.2;
// How far past the straight part the curved ends go, m. By then the face
// is ~48 m out: always off the side of the screen or below the horizon.
export const CURVE_LENGTH = 14;

// The falls: where their lip runs along the face, and how far it curves
// back into it (the horseshoe).
export const FALLS_S0 = 70;
export const FALLS_S1 = 88;
export const HORSESHOE = 4;
// How fast the water leaves the lip, m/s; it arcs out under gravity.
const THROW_SPEED = 2.6;
export const GRAVITY = 9.8;

// Trees on the plateau stand at least this far back from its edge, m, so
// no crown hangs out in front of the face.
export const PLATEAU_SETBACK = 4.5;

// The pond at the falls' foot: an oval between the trail's verge and the
// rock face, which hides whatever of it lies beyond.
export const POND = { x: 6.9, s: 79, radiusX: 5.2, radiusS: 13.5 };

// How far a spot is from the pond's middle, as a share of the way to its
// shore (the ground shader roughens the shore by a few per cent).
export function pondReach(x: number, s: number): number {
  return Math.hypot((x - POND.x) / POND.radiusX, (s - POND.s) / POND.radiusS);
}

// How far the rock is weathered in or out from its line, m, away from the
// falls: buttresses and bays a few metres across, so the face catches the
// light unevenly, as rock does. Nothing at the falls, whose lip is exact.
export function roughness(s: number): number {
  'worklet';
  const fromFalls = Math.max(FALLS_S0 - s, s - FALLS_S1, 0);
  const fade = Math.min(fromFalls / 2, 1);
  return fade * (0.55 * Math.sin(s * 0.93 + 1.3) + 0.35 * Math.sin(s * 0.41 + 2.2));
}

// How high the face's top edge is at `s`, m: level at the falls, uneven
// elsewhere, never lower than the plateau its trees stand on.
export function topAt(s: number): number {
  'worklet';
  const fromFalls = Math.max(FALLS_S0 - s, s - FALLS_S1, 0);
  const fade = Math.min(fromFalls / 1.5, 1);
  return CLIFF_HEIGHT + fade * 0.8 * (0.5 + 0.3 * Math.sin(s * 1.37 + 0.7) + 0.2 * Math.sin(s * 2.9 + 1.9));
}

// Where the lip is across the trail at `s`: the face, bowed back into the
// rock between the ends of the falls.
//
// It comes before rockX because a worklet has to come after every worklet it
// calls: the worklets Babel plugin turns each one into a variable holding a
// copy of what it uses, taken where it's declared, so it isn't hoisted, and
// anything declared further down is copied as undefined.
export function lipX(s: number): number {
  'worklet';
  const u = (s - (FALLS_S0 + FALLS_S1) / 2) / ((FALLS_S1 - FALLS_S0) / 2);
  return Math.abs(u) >= 1 ? CLIFF_X : CLIFF_X + HORSESHOE * (1 - u * u);
}

// Where the rock face is across the trail at `s` along it, m; Infinity
// beyond its ends, where there's no escarpment.
export function rockX(s: number): number {
  'worklet';
  if (s < FACE_S0 - CURVE_LENGTH || s > FACE_S1 + CURVE_LENGTH) return Infinity;
  if (s < FACE_S0) return CLIFF_X + ((FACE_S0 - s) / CURVE) ** 2 + roughness(s);
  if (s > FACE_S1) return CLIFF_X + ((s - FACE_S1) / CURVE) ** 2 + roughness(s);
  return lipX(s) + roughness(s);
}

// How far the water has come out from the lip, toward the trail, by the
// time it has fallen to `height` above the ground, m.
export function throwAt(height: number): number {
  'worklet';
  return THROW_SPEED * Math.sqrt((2 * Math.max(CLIFF_HEIGHT - height, 0)) / GRAVITY);
}

// Whether a spot on the ground is on top of the plateau.
export function onPlateau(x: number, s: number): boolean {
  return x > rockX(s);
}

// The columns the rock face and the falls are cut into, nearest the trail's
// start first: each spans [s0, s1] along the trail. Narrow enough that the
// painter's order between them and anything standing near them holds.
export interface CliffColumn {
  s0: number;
  s1: number;
  // How far along the face its edges are, m, for the rock's texture.
  along0: number;
  along1: number;
  falls: boolean; // whether water pours down in front of this piece of rock
  wet: number; // how wet the rock is: 1 behind the water, drying off either side
}

// Across the falls, m of trail per column; elsewhere, m of rock face per
// column (measured along the face, since the curved ends run mostly across).
const FALLS_STEP = 0.7;
const FACE_STEP = 1.5;

export const CLIFF_COLUMNS: CliffColumn[] = (() => {
  const columns: CliffColumn[] = [];
  const start = FACE_S0 - CURVE_LENGTH;
  const end = FACE_S1 + CURVE_LENGTH;
  let s = start;
  while (s < end - 1e-6) {
    let next: number;
    if (s >= FALLS_S0 - 1e-6 && s < FALLS_S1 - 1e-6) {
      next = Math.min(s + FALLS_STEP, FALLS_S1);
    } else {
      // Step so the face advances FACE_STEP along its length.
      const slope = Math.abs(rockX(s + 0.01) - rockX(s)) / 0.01;
      next = s + FACE_STEP / Math.sqrt(1 + slope * slope);
      if (s < FALLS_S0 && next > FALLS_S0) next = FALLS_S0;
      next = Math.min(next, end);
    }
    const along0: number = columns.length ? columns[columns.length - 1].along1 : 0;
    const middle = (s + next) / 2;
    const fromFalls = Math.max(FALLS_S0 - middle, middle - FALLS_S1, 0);
    columns.push({
      s0: s,
      s1: next,
      along0,
      along1: along0 + Math.hypot(next - s, rockX(next) - rockX(s)),
      falls: s >= FALLS_S0 - 1e-6 && next <= FALLS_S1 + 1e-6,
      wet: Math.max(0, 1 - fromFalls / 3),
    });
    s = next;
  }
  return columns;
})();

// Rows down the falling water, per column.
export const FALLS_ROWS = 10;
