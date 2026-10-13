// Shapes for the intro's world, as SVG path strings. Each is drawn at unit
// size standing on the origin (y up is negative, as on screen), and scaled
// to its size in metres when it's drawn. Pure geometry: the scene turns these
// into Skia paths and paints them.

// Deterministic jitter, so every launch draws the same shapes.
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

const f = (n: number) => n.toFixed(4);

type Point = [number, number];

function polygon(points: Point[]): string {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('') + 'Z';
}

// A closed shape through `points`, smoothed by curving through each point
// toward the midpoint of the next edge.
function smoothClosed(points: Point[]): string {
  const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const n = points.length;
  let d = `M${f(mid(points[n - 1], points[0])[0])} ${f(mid(points[n - 1], points[0])[1])}`;
  for (let i = 0; i < n; i++) {
    const [mx, my] = mid(points[i], points[(i + 1) % n]);
    d += `Q${f(points[i][0])} ${f(points[i][1])} ${f(mx)} ${f(my)}`;
  }
  return d + 'Z';
}

// ---------------------------------------------------------------------------
// Pines — unit height, trunk base at the origin.
// ---------------------------------------------------------------------------

export interface TreeArt {
  trunk: string;
  // The left half of the trunk, catching the light.
  trunkLit: string;
  // Each tier of branches, bottom to top, with its sunlit left side and the
  // shadowed band along its underside. The scene layers these so a tier's
  // shading never shows through the tier above it.
  tiers: { outline: string; lit: string; underside: string }[];
}

interface PineOptions {
  seed: number;
  tiers: number;
  halfWidth: number; // crown half-width at its base, per unit height
  crownBase: number; // height of the lowest branches
  droop: number; // how far branch tips hang, per tier height
  taper?: number; // how quickly tiers narrow toward the top (default 0.85)
  trunk?: number; // trunk width relative to the default (default 1)
}

// A tree's `variant` in world.ts indexes this list.
const PINES: PineOptions[] = [
  { seed: 11, tiers: 7, halfWidth: 0.21, crownBase: 0.14, droop: 0.22 }, // pine
  { seed: 23, tiers: 9, halfWidth: 0.17, crownBase: 0.1, droop: 0.3 }, // spruce: slimmer, droopier
  { seed: 37, tiers: 6, halfWidth: 0.25, crownBase: 0.16, droop: 0.18 }, // fir: fuller
  // Mature pine: its lower branches long gone, a bare trunk up to a crown
  // that barely tapers. Tall enough to stand by the trail and reach over it.
  { seed: 51, tiers: 6, halfWidth: 0.19, crownBase: 0.46, droop: 0.2, taper: 0.45, trunk: 0.62 },
];

function pine({ seed, tiers: count, halfWidth, crownBase, droop, taper = 0.85, trunk: girth = 1 }: PineOptions): TreeArt {
  const random = seeded(seed);
  const jitter = (amount: number) => (random() - 0.5) * 2 * amount;

  const tiers: TreeArt['tiers'] = [];
  const crown = 1 - crownBase;
  for (let i = 0; i < count; i++) {
    const top = i === count - 1;
    const bottom = crownBase + crown * (i / count) * 0.93 + jitter(0.006);
    const apex = top ? 1 : Math.min(1, bottom + (crown * 2.1) / count + jitter(0.01));
    const tierHeight = apex - bottom;
    const half = halfWidth * Math.pow(1 - i / count, taper) + 0.018 + jitter(0.008);
    const hang = droop * tierHeight;

    // Along the lower edge, right tip to left tip: branch ends hanging down,
    // with shallow notches between them. The droop and notches ease off
    // toward the tips, so each tip ends in a wedge rather than a hair-thin
    // spike where the steep flank meets the edge.
    const lowerEdge: Point[] = [];
    const steps = 8;
    for (let k = 0; k <= steps; k++) {
      const u = 1 - (2 * k) / steps; // 1 at the right tip, -1 at the left
      const notch = k % 2 === 1 ? tierHeight * (0.1 + random() * 0.06) * (1 - 0.6 * Math.abs(u)) : 0;
      lowerEdge.push([half * u + jitter(half * 0.03), -(bottom - hang * Math.abs(u) + notch + jitter(0.004))]);
    }
    const [rightTip] = lowerEdge;
    const leftTip = lowerEdge[steps];
    // Sides curve in slightly (concave), like branches weighed down.
    const side = (tip: Point, sign: 1 | -1) =>
      `Q${f(sign * half * 0.32)} ${f(-(bottom + tierHeight * 0.42))} ${f(tip[0])} ${f(tip[1])}`;

    const outline =
      `M0 ${f(-apex)}` +
      side(rightTip, 1) +
      lowerEdge
        .slice(1)
        .map(([x, y]) => `L${f(x)} ${f(y)}`)
        .join('') +
      `Q${f(-half * 0.32)} ${f(-(bottom + tierHeight * 0.42))} 0 ${f(-apex)}Z`;

    // The sunlit side: from the apex down the left flank, back along the
    // lower edge to just right of the centre line.
    const litEdge = lowerEdge.slice(steps / 2 - 1).reverse(); // left tip → just right of centre
    const lit =
      `M0 ${f(-apex)}` +
      `Q${f(-half * 0.32)} ${f(-(bottom + tierHeight * 0.42))} ${f(leftTip[0])} ${f(leftTip[1])}` +
      litEdge
        .slice(1)
        .map(([x, y]) => `L${f(x)} ${f(y)}`)
        .join('') +
      `L${f(half * 0.05)} ${f(-(bottom + tierHeight * 0.55))}Z`;

    // A band along the underside, where the branches shade themselves.
    const band = tierHeight * 0.3;
    const underside = polygon([
      ...lowerEdge.map(([x, y]): Point => [x * 1.02, y + 0.004]),
      ...lowerEdge
        .slice()
        .reverse()
        .map(([x, y]): Point => [x * 0.88, y - band * (1 - 0.35 * Math.abs(x / half))]),
    ]);

    tiers.push({ outline, lit, underside });
  }

  // Trunk, flaring at the roots, running up into the crown.
  const trunkTop = crownBase + 0.08;
  const w = (n: number) => f(n * girth);
  const trunk =
    `M${w(-0.05)} 0Q${w(-0.03)} -0.012 ${w(-0.028)} -0.05L${w(-0.016)} ${f(-trunkTop)}L${w(0.016)} ${f(-trunkTop)}` +
    `L${w(0.028)} -0.05Q${w(0.03)} -0.012 ${w(0.05)} 0Z`;
  const trunkLit =
    `M${w(-0.05)} 0Q${w(-0.03)} -0.012 ${w(-0.028)} -0.05L${w(-0.016)} ${f(-trunkTop)}` +
    `L${w(-0.002)} ${f(-trunkTop)}L${w(-0.004)} 0Z`;

  return { trunk, trunkLit, tiers };
}

export const TREE_ART: TreeArt[] = PINES.map(pine);

// ---------------------------------------------------------------------------
// Rocks — unit width, resting on the origin, sunk slightly into the ground.
// ---------------------------------------------------------------------------

function rock(seed: number): string {
  const random = seeded(seed);
  const count = 7 + Math.floor(random() * 3);
  const height = 0.4 + random() * 0.2;
  const points: Point[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (random() - 0.5) * 0.4;
    const r = 0.82 + random() * 0.26;
    const x = Math.cos(angle) * 0.5 * r;
    // Flat underneath: the lower half is squashed onto the ground line.
    const y = Math.sin(angle) * height * r;
    points.push([x, y > 0 ? Math.min(y * 0.15, 0.04) : y]);
  }
  return smoothClosed(points);
}

export const ROCK_ART: string[] = [3, 7, 19, 29, 41, 53].map(rock);

// ---------------------------------------------------------------------------
// Grass tufts — unit height, rooted at the origin.
// ---------------------------------------------------------------------------

function tuft(seed: number): string {
  const random = seeded(seed);
  const count = 6 + Math.floor(random() * 4);
  let d = '';
  for (let i = 0; i < count; i++) {
    const x = (random() - 0.5) * 0.7;
    const h = 0.5 + random() * 0.5;
    // Outer blades lean outward more.
    const lean = x * 0.7 + (random() - 0.5) * 0.35;
    const w = 0.03 + random() * 0.025;
    d +=
      `M${f(x - w)} 0` +
      `Q${f(x - w * 0.4 + lean * 0.25)} ${f(-h * 0.6)} ${f(x + lean)} ${f(-h)}` +
      `Q${f(x + w * 0.6 + lean * 0.3)} ${f(-h * 0.5)} ${f(x + w)} 0Z`;
  }
  return d;
}

export const TUFT_ART: string[] = [5, 13, 21, 34, 55].map(tuft);
