// The ground and sky, drawn in one pass by a Skia runtime shader.
//
// Each pixel below the horizon casts a ray from the eye and finds where it
// meets the curved ground — the same paraboloid world.ts projects sprites
// onto — then paints whatever lies at that spot in the world: trail mud,
// ruts, puddles, grass. Because the pattern is fixed to world positions, it
// comes toward the camera with true perspective, compressing into the
// distance and sliding over the horizon's crest, rather than scrolling as a
// flat texture.

import {
  CLIFF_X,
  CURVE,
  CURVE_LENGTH,
  FACE_S0,
  FACE_S1,
  FALLS_S0,
  FALLS_S1,
  HORSESHOE,
  POND,
  throwAt,
} from './falls';
import { GRANITE_RADIUS, LIGHTHOUSE_S, LIGHTHOUSE_X } from './lighthouse';
import { Palette, rgb } from './palette';
import {
  BRIDGE,
  STREAM_DEPTH,
  STREAM_FROM_X,
  STREAM_HALF_WIDTH,
  STREAM_S,
  STREAM_SPEED,
  STREAM_TO_X,
} from './stream';
import { PLAZA_RADIUS, SIDE_PATH_HALF_WIDTH, TOWER_S, TOWER_X } from './tower';
import { MAX_HAZE, MEADOW, PATH_HALF_WIDTH } from './world';

const f = (value: number) => value.toFixed(4);
const color = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return `float3(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)})`;
};

// Uniforms, in declaration order — the order scene.ts passes them in.
//   uEye     screen point straight ahead at eye level, px
//   uFocal   focal length, px
//   uEyeH    eye height above the trail, m
//   uRadius  globe radius, m
//   uCamS    camera's distance along the trail, m
//   uBlur    how far the camera moves while a frame is exposed, m
//   uDebug   1 overlays a world grid and rings round the tree spots
//   uSpotsA, uSpotsB  tree spots (x, s, x, s) for the debug rings
//   uTime    s since the start, for the pond's ripples and foam
export const GROUND_SKSL = `
uniform float2 uEye;
uniform float uFocal;
uniform float uEyeH;
uniform float uRadius;
uniform float uCamS;
uniform float uBlur;
uniform float uDebug;
uniform float4 uSpotsA;
uniform float4 uSpotsB;
uniform float uTime;

const float3 SKY_TOP = ${color(Palette.skyTop)};
const float3 SKY_HORIZON = ${color(Palette.skyHorizon)};
const float3 HAZE = ${color(Palette.haze)};
const float3 MUD = ${color(Palette.mud)};
const float3 MUD_DARK = ${color(Palette.mudDark)};
const float3 MUD_LIGHT = ${color(Palette.mudLight)};
const float3 MUD_WET = ${color(Palette.mudWet)};
const float3 PUDDLE = ${color(Palette.puddle)};
const float3 GRASS_DEEP = ${color(Palette.grassDeep)};
const float3 GRASS = ${color(Palette.grass)};
const float3 GRASS_LIGHT = ${color(Palette.grassLight)};
const float3 GRASS_DRY = ${color(Palette.grassDry)};
const float3 FOREST_FLOOR = ${color(Palette.forestFloor)};
const float3 NEEDLES = ${color(Palette.needles)};
const float3 FLOOR_MOSS = ${color(Palette.floorMoss)};
const float3 SUNFLECK = ${color(Palette.sunfleck)};
const float PATH_HALF = ${PATH_HALF_WIDTH.toFixed(4)};
const float MAX_HAZE = ${MAX_HAZE.toFixed(4)};
const float3 STONE = ${color(Palette.plazaStone)};
const float3 STONE_DARK = ${color(Palette.plazaJoint)};
const float TOWER_X = ${TOWER_X.toFixed(4)};
const float TOWER_S = ${TOWER_S.toFixed(4)};
const float PLAZA_R = ${PLAZA_RADIUS.toFixed(4)};
const float SIDE_HALF = ${SIDE_PATH_HALF_WIDTH.toFixed(4)};
const float MEADOW_FROM = ${MEADOW.from.toFixed(4)};
const float MEADOW_HALF = ${MEADOW.halfWidth.toFixed(4)};
const float MEADOW_START = ${MEADOW.startWidth.toFixed(4)};
const float MEADOW_WIDENING = ${MEADOW.widening.toFixed(4)};
const float3 SCREE = ${color(Palette.scree)};
const float3 SHORE_WET = ${color(Palette.shoreWet)};
const float3 POND_DEEP = ${color(Palette.pondDeep)};
const float3 POND_WATER = ${color(Palette.pond)};
const float3 POND_FOAM = ${color(Palette.pondFoam)};
const float CLIFF_X = ${f(CLIFF_X)};
const float FACE_S0 = ${f(FACE_S0)};
const float FACE_S1 = ${f(FACE_S1)};
const float CURVE = ${f(CURVE)};
const float CURVE_LENGTH = ${f(CURVE_LENGTH)};
const float FALLS_S0 = ${f(FALLS_S0)};
const float FALLS_S1 = ${f(FALLS_S1)};
const float HORSESHOE = ${f(HORSESHOE)};
// How far out from the lip the water lands, m.
const float THROW = ${f(throwAt(0))};
const float2 POND_AT = float2(${f(POND.x)}, ${f(POND.s)});
const float2 POND_RADII = float2(${f(POND.radiusX)}, ${f(POND.radiusS)});
const float3 STREAM_DEEP = ${color(Palette.streamDeep)};
const float3 STREAM_WATER = ${color(Palette.streamWater)};
const float3 BANK = ${color(Palette.bank)};
const float3 BANK_DARK = ${color(Palette.bankDark)};
const float STREAM_S = ${f(STREAM_S)};
const float STREAM_HALF = ${f(STREAM_HALF_WIDTH)};
const float STREAM_DEPTH = ${f(STREAM_DEPTH)};
const float STREAM_FROM_X = ${f(STREAM_FROM_X)};
const float STREAM_TO_X = ${f(STREAM_TO_X)};
const float STREAM_SPEED = ${f(STREAM_SPEED)};
const float BRIDGE_HALF = ${f(BRIDGE.halfWidth)};
const float BRIDGE_S0 = ${f(BRIDGE.s0)};
const float BRIDGE_S1 = ${f(BRIDGE.s1)};
const float LIGHT_X = ${f(LIGHTHOUSE_X)};
const float LIGHT_S = ${f(LIGHTHOUSE_S)};
const float GRANITE_R = ${f(GRANITE_RADIUS)};
const float3 GRANITE_LIT = ${color(Palette.graniteLit)};
const float3 GRANITE = ${color(Palette.granite)};
const float3 GRANITE_DARK = ${color(Palette.graniteDark)};
const float3 GRANITE_JOINT = ${color(Palette.graniteJoint)};
const float3 LICHEN = ${color(Palette.lichen)};
const float3 LICHEN_GREY = ${color(Palette.lichenGrey)};

// Hash without sine, so it stays stable at world-sized coordinates.
float hash(float2 p) {
  float3 p3 = fract(float3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(float2 p) {
  float2 i = floor(p);
  float2 u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  return mix(mix(hash(i), hash(i + float2(1.0, 0.0)), u.x),
             mix(hash(i + float2(0.0, 1.0)), hash(i + float2(1.0, 1.0)), u.x), u.y);
}

// Four octaves of value noise. An octave finer than the pixel's footprint
// (fp, in the same units as p) is replaced by its average, so the ground
// smooths out with distance instead of shimmering. One averaged away
// entirely isn't worked out at all.
float fbm(float2 p, float fp) {
  float sum = 0.0;
  float amp = 0.5;
  float scale = 1.0;
  for (int i = 0; i < 4; i++) {
    float detail = 1.0 - smoothstep(0.3, 0.9, fp * scale);
    float octave = 0.5;
    if (detail > 0.0) {
      octave = noise(p * scale + float2(float(i) * 13.7, float(i) * 7.1));
    }
    sum += amp * mix(0.5, octave, detail);
    scale *= 2.03;
    amp *= 0.5;
  }
  return sum / 0.9375;
}

// Must match pathEdge() in world.ts, which lines the trail with rocks.
float pathEdge(float s) {
  return PATH_HALF + 0.05 * sin(0.9 * s) + 0.035 * sin(2.3 * s + 1.0);
}

// Must match lipX() and rockX() in falls.ts: where the falls' lip and the
// escarpment's face are across the trail at s.
float lipX(float s) {
  float u = (s - (FALLS_S0 + FALLS_S1) * 0.5) / ((FALLS_S1 - FALLS_S0) * 0.5);
  return abs(u) >= 1.0 ? CLIFF_X : CLIFF_X + HORSESHOE * (1.0 - u * u);
}

float roughness(float s) {
  float fade = min(max(max(FALLS_S0 - s, s - FALLS_S1), 0.0) / 2.0, 1.0);
  return fade * (0.55 * sin(s * 0.93 + 1.3) + 0.35 * sin(s * 0.41 + 2.2));
}

float rockX(float s) {
  if (s < FACE_S0 - CURVE_LENGTH || s > FACE_S1 + CURVE_LENGTH) return 10000.0;
  if (s < FACE_S0) return CLIFF_X + pow((FACE_S0 - s) / CURVE, 2.0) + roughness(s);
  if (s > FACE_S1) return CLIFF_X + pow((s - FACE_S1) / CURVE, 2.0) + roughness(s);
  return lipX(s) + roughness(s);
}

// Must match streamCentre() in stream.ts: where the stream's middle is
// along the trail at x.
float streamCentre(float x) {
  float bend = 1.0 - exp(-(x * x) / 9.0);
  return STREAM_S + 0.055 * x * x + 0.9 * sin(0.38 * x) * bend;
}

// How far (x, s) is from the stream's middle, square to it, m; signed, and
// far off past its ends.
float streamAcross(float x, float s) {
  if (x > STREAM_FROM_X + 1.0 || x < STREAM_TO_X) return 1000.0;
  float slope = (streamCentre(x + 0.01) - streamCentre(x - 0.01)) / 0.02;
  return (s - streamCentre(x)) / sqrt(1.0 + slope * slope);
}

// Half the stream's width at x, its banks a little uneven.
float streamHalf(float x) {
  return STREAM_HALF + (noise(float2(x * 0.7, 3.0)) - 0.5) * 0.16;
}

// How far below the banks the water is at x: level with the pond at its
// shore, dropping to its full depth within a metre.
float streamDepth(float x) {
  return STREAM_DEPTH * (1.0 - smoothstep(1.15, 1.9, x));
}

// How far (x, s) is from the pond's middle, as a share of the way to its
// roughened shore: under 1 is in the pond.
float pondReach(float x, float s) {
  return length((float2(x, s) - POND_AT) / POND_RADII) + (noise(float2(x, s) * 0.9) - 0.5) * 0.08;
}

// The stream's water at (x, s), t metres off, flowing away to the left.
float3 streamWater(float x, float s, float fp, float t) {
  float v = s - streamCentre(x);
  // The pattern rides on the water, so it runs downstream.
  float flow = x + uTime * STREAM_SPEED;
  float streaks = fbm(float2(flow * 1.3, v * 4.5), fp * 4.5);
  float3 water = mix(STREAM_DEEP, STREAM_WATER, smoothstep(0.3, 0.75, streaks));
  // The sky, more of it the lower the angle, broken up where it's rippled.
  float sheen = fbm(float2(flow * 0.5, v * 1.5) + 50.0, fp * 1.5);
  water = mix(water, SKY_HORIZON, (0.12 + 0.3 * smoothstep(4.0, 25.0, t)) * (0.6 + 0.8 * sheen));
  // Glints on the ripples, fading once finer than a pixel.
  float glints = 1.0 - smoothstep(0.02, 0.08, fp);
  if (glints > 0.0) {
    float glint = smoothstep(0.7, 0.9, noise(float2(flow * 3.0, v * 9.0))) * glints;
    water = mix(water, SKY_HORIZON * 1.1, glint * 0.5);
  }
  // White water where it spills out of the pond and drops.
  float spill = smoothstep(0.6, 1.0, x);
  if (spill > 0.0) {
    float churn = smoothstep(0.35, 0.7, fbm(float2(flow * 2.2, v * 4.0) + 9.0, fp * 4.0));
    water = mix(water, POND_FOAM, spill * churn * 0.85);
  }
  // Darker in the shade of its banks, and under the bridge.
  water *= mix(0.72, 1.0, smoothstep(STREAM_HALF, STREAM_HALF * 0.35, abs(v)));
  float under = (1.0 - smoothstep(BRIDGE_HALF, BRIDGE_HALF + 0.35, abs(x)))
    * smoothstep(BRIDGE_S0 - 0.3, BRIDGE_S0, s) * (1.0 - smoothstep(BRIDGE_S1, BRIDGE_S1 + 0.3, s));
  water *= 1.0 - 0.6 * under;
  return water;
}

// The far bank's earth wall; down is how far from its top to the water,
// 0 to 1.
float3 bankWall(float x, float s, float down, float fp) {
  float grain = fbm(float2(x * 3.0, down * 6.0 + s), fp * 3.0);
  float3 wall = mix(BANK, BANK_DARK, smoothstep(0.1, 1.0, down)) * (0.8 + 0.4 * grain);
  // Grass hanging over its top, and a wet line at the water.
  wall = mix(wall, GRASS_DEEP, 1.0 - smoothstep(0.0, 0.18, down + (grain - 0.5) * 0.15));
  wall = mix(wall, BANK_DARK * 0.8, smoothstep(0.75, 0.95, down));
  return wall;
}

// What's on the ground at (x, s); fp is the pixel's footprint there and t
// how far off it is, m.
float3 groundColor(float x, float s, float fp, float t) {
  float rag = (noise(float2(x, s) * 5.0) - 0.5) * 0.12;
  float d = abs(x) - pathEdge(s) + rag; // negative on the trail
  float aa = max(fp * 0.8, 0.025);
  // How far off the trail this spot is: 0 on it, 1 past its edge. Of the
  // trail, the grass and the forest floor, only what shows here is worked
  // out (each is most of the cost of a pixel, and most pixels are one).
  float offTrail = smoothstep(-aa, aa, d);

  float3 mud = float3(0.0);
  if (offTrail < 1.0) {
    // Trail: mottled mud, two worn ruts, damp patches and puddles, pebbles.
    float m = fbm(float2(x * 1.6, s * 1.1), fp * 1.6);
    mud = mix(MUD_DARK, MUD_LIGHT, smoothstep(0.28, 0.75, m));
    mud = mix(mud, MUD, 0.3);
    float rut = exp(-pow((abs(x) - 0.2) / 0.07, 2.0));
    mud = mix(mud, MUD_WET, rut * 0.5);
    float wet = fbm(float2(x * 1.5 + 17.0, s * 0.8), fp * 1.5);
    float inside = 1.0 - smoothstep(-0.2, 0.0, d);
    mud = mix(mud, MUD_WET, smoothstep(0.6, 0.73, wet) * 0.6);
    // Small puddles in the wettest spots, holding a little of the sky.
    float puddle = smoothstep(0.745, 0.765, wet) * inside;
    if (puddle > 0.0) {
      float3 water = mix(PUDDLE, SKY_TOP, 0.2 + 0.2 * noise(float2(x * 3.0, s * 1.5)));
      mud = mix(mud, water, puddle * 0.9);
    }
    // Pebbles: at most one per 8 cm cell, round, placed at random within
    // it, fading out once finer than a pixel.
    float pebbles = 1.0 - smoothstep(0.02, 0.05, fp);
    if (pebbles > 0.0) {
      float2 cell = floor(float2(x, s) * 12.0);
      float2 within = fract(float2(x, s) * 12.0) - 0.5;
      float2 jitter = float2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5;
      float size = 0.12 + 0.18 * hash(cell + 1.3);
      float pebble = step(0.82, hash(cell)) * (1.0 - smoothstep(size * 0.6, size, length(within - jitter * 0.5)));
      mud = mix(mud, MUD_LIGHT * 1.2, pebble * 0.55 * pebbles);
    }
  }

  float fromTower = length(float2(x - TOWER_X, s - TOWER_S));
  float3 grass = float3(0.0);
  if (offTrail > 0.0) {
    // How much of the verge gives way to the forest floor.
    float understory = smoothstep(0.5, 1.9, d + (noise(float2(x, s) * 0.8) - 0.5) * 1.2);
    // Around the CN Tower the trees open into a glade: meadow grass rather
    // than needle litter, with a ragged edge.
    float glade = 1.0 - smoothstep(7.0, 13.0, fromTower + (noise(float2(x, s) * 0.5) - 0.5) * 3.0);
    // And the meadow between the trail and the escarpment, round the pond.
    float ragged = (noise(float2(x, s) * 0.4 + 30.0) - 0.5) * 4.0;
    float meadow = smoothstep(0.0, 1.5, x) * smoothstep(FACE_S0 - 13.0, FACE_S0 - 8.0, s + ragged) * (1.0 - smoothstep(FACE_S1, FACE_S1 + 5.0, s + ragged));
    // And past the stream, the open meadow; its edge must match meadowEdge()
    // in world.ts, where the trees stop.
    float edgeS = MEADOW_FROM + 3.0 * sin(0.45 * x) + 2.0 * sin(1.3 * x + 1.0);
    float fieldHalf = min(MEADOW_HALF, MEADOW_START + MEADOW_WIDENING * max(s - MEADOW_FROM, 0.0));
    float field = smoothstep(edgeS - 2.0, edgeS + 3.0, s) * (1.0 - smoothstep(fieldHalf - 3.0, fieldHalf + 1.0, abs(x)));
    float wood = understory * (1.0 - max(max(glade, meadow), field));

    if (wood < 1.0) {
      // Grass: broad patches of deep and bright green, drier stretches, and
      // fine blade grain up close.
      float g = fbm(float2(x * 0.7, s * 0.5) + 40.0, fp * 0.7);
      grass = mix(GRASS_DEEP, GRASS, smoothstep(0.25, 0.7, g));
      float g2 = fbm(float2(x * 2.4, s * 1.8) + 90.0, fp * 2.4);
      grass = mix(grass, GRASS_LIGHT, smoothstep(0.55, 0.8, g2) * 0.75);
      float dry = fbm(float2(x * 0.3, s * 0.22) + 7.0, fp * 0.3);
      grass = mix(grass, GRASS_DRY, smoothstep(0.62, 0.85, dry) * 0.45);
      float fineBlades = 1.0 - smoothstep(0.012, 0.03, fp);
      float blades = 0.5;
      if (fineBlades > 0.0) {
        blades = mix(0.5, noise(float2(x * 34.0, s * 26.0)), fineBlades);
      }
      grass *= 0.82 + 0.36 * blades;
      // Shaded where the verge meets the trail.
      grass *= mix(0.72, 1.0, smoothstep(0.0, 0.5, d));
    }

    if (wood > 0.0) {
      // Beyond the verges, under the trees: needle litter and moss in the
      // canopy's shade, with patches of sunlight coming through.
      float litter = fbm(float2(x * 0.9, s * 0.7) + 63.0, fp * 0.9);
      float3 forest = mix(FOREST_FLOOR, NEEDLES, smoothstep(0.35, 0.7, litter));
      float mossy = fbm(float2(x * 0.45, s * 0.35) + 21.0, fp * 0.45);
      forest = mix(forest, FLOOR_MOSS, smoothstep(0.5, 0.7, mossy) * 0.8);
      float fineGrain = 1.0 - smoothstep(0.02, 0.05, fp);
      float grain = 0.5;
      if (fineGrain > 0.0) {
        grain = mix(0.5, noise(float2(x * 18.0, s * 14.0)), fineGrain);
      }
      forest *= 0.85 + 0.3 * grain;
      float light = fbm(float2(x * 0.35, s * 0.3) + 5.0, fp * 0.35);
      forest = mix(forest, SUNFLECK, smoothstep(0.62, 0.78, light) * 0.55);
      grass = mix(grass, forest, wood);
    }
  }

  float3 ground = mix(mud, grass, offTrail);

  // The tower's plaza: stone paving in a circle round its foot, with a
  // darker kerb, and a paved path joining it to the right edge of the trail.
  float plaza = 1.0 - smoothstep(PLAZA_R - aa, PLAZA_R + aa, fromTower);
  float side = (1.0 - smoothstep(SIDE_HALF - aa, SIDE_HALF + aa, abs(s - TOWER_S)))
    * smoothstep(pathEdge(s) - 0.15 - aa, pathEdge(s) - 0.15 + aa, x)
    * (1.0 - smoothstep(TOWER_X - aa, TOWER_X + aa, x));
  float paved = max(plaza, side);
  if (paved > 0.0) {
    float3 stone = STONE * (0.92 + 0.12 * fbm(float2(x, s) * 2.0, fp * 2.0));
    // Joints between slabs, 1.2 m square, fading out once they're finer
    // than a pixel.
    float2 slab = abs(fract(float2(x, s) / 1.2 + 0.5) - 0.5) * 1.2;
    float joint = 1.0 - smoothstep(0.015, 0.015 + aa, min(slab.x, slab.y));
    stone = mix(stone, STONE_DARK, joint * 0.7 * (1.0 - smoothstep(0.02, 0.06, fp)));
    float kerb = smoothstep(PLAZA_R - 0.45 - aa, PLAZA_R - 0.45 + aa, fromTower) * plaza;
    stone = mix(stone, STONE_DARK, kerb * 0.8);
    ground = mix(ground, stone, paved);
  }

  // The granite the lighthouse stands on: bare rock worn smooth into broad
  // swells, cracked into slabs along its joints, with patches of lichen,
  // its edge ragged where the turf gives way to it, and stopping short of
  // the trail and its verge. Worked out only near it.
  float fromLight = length(float2(x - LIGHT_X, s - LIGHT_S));
  if (fromLight < GRANITE_R + 2.5) {
    float ragged = fromLight + (noise(float2(x, s) * 0.6 + 41.0) - 0.5) * 3.0;
    float bare = (1.0 - smoothstep(GRANITE_R - 1.2, GRANITE_R + 0.6, ragged)) * smoothstep(0.6, 1.6, d);
    if (bare > 0.0) {
      float swell = fbm(float2(x * 0.55, s * 0.55) + 23.0, fp * 0.55);
      float3 rock = mix(GRANITE_DARK, GRANITE_LIT, smoothstep(0.2, 0.8, swell));
      rock = mix(rock, GRANITE, 0.35);
      // Grain, fading out once finer than a pixel.
      float grainy = 1.0 - smoothstep(0.02, 0.06, fp);
      if (grainy > 0.0) {
        rock *= 1.0 + (noise(float2(x, s) * 22.0) - 0.5) * 0.12 * grainy;
      }
      // Joints: cracks running two ways between slabs, wavering, fading out
      // once finer than a pixel.
      float2 q = float2(x * 0.8 + s * 0.35, s * 0.8 - x * 0.35);
      float waver = (noise(q * 0.7 + 5.0) - 0.5) * 0.6;
      float2 slab = abs(fract(float2(q.x + waver, q.y * 0.6 - waver) / 1.6) - 0.5) * 1.6;
      float crackWidth = max(fp * 1.2, 0.025);
      float crack = 1.0 - smoothstep(crackWidth * 0.5, crackWidth, min(slab.x, slab.y * 1.3));
      rock = mix(rock, GRANITE_JOINT, crack * 0.6 * (1.0 - smoothstep(0.08, 0.25, fp)));
      // Lichen: ochre patches, and grey ones.
      float lichen = fbm(float2(x, s) * 0.9 + 77.0, fp * 0.9);
      rock = mix(rock, LICHEN, smoothstep(0.68, 0.76, lichen) * 0.35);
      rock = mix(rock, LICHEN_GREY, smoothstep(0.55, 0.65, 1.0 - lichen) * 0.35);
      ground = mix(ground, rock, bare);
    }
  }

  // Rubble fallen from the escarpment's face, piled along its foot.
  float toRock = rockX(s) - x;
  if (toRock < 3.0) {
    float rubble = 1.0 - smoothstep(0.5, 2.2, toRock + (noise(float2(x, s) * 1.3) - 0.5) * 1.2);
    float3 scree = SCREE * (0.72 + 0.5 * fbm(float2(x, s) * 3.0, fp * 3.0));
    ground = mix(ground, scree, rubble);
  }

  // The pond at the falls' foot, its shore darkened where it's wet.
  float reach = pondReach(x, s);
  float edge = aa / POND_RADII.x;
  ground = mix(ground, SHORE_WET, (1.0 - smoothstep(1.0, 1.1, reach)) * 0.6);
  float pond = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, reach);
  if (pond > 0.0) {
    float3 water = mix(POND_WATER, POND_DEEP, smoothstep(0.1, 0.8, 1.0 - reach));
    // How far this spot is from where the falls land, m: out toward the
    // trail, and past either end of them.
    float span = clamp(s, FALLS_S0, FALLS_S1);
    float outward = lipX(span) - THROW - x;
    float fromFalls = length(float2(max(outward, 0.0), s - span));
    // The sky, more of it the lower the angle we see the water at, broken
    // up where the surface is disturbed.
    float sheen = fbm(float2(x * 0.6, s * 0.25) + 70.0, fp * 0.6);
    water = mix(water, SKY_HORIZON, (0.1 + 0.3 * smoothstep(6.0, 28.0, t)) * (0.6 + 0.8 * sheen));
    // Ripples spreading out in rings from the falls: their crests catch
    // the light. Faded once finer than a pixel.
    float ripples = 1.0 - smoothstep(0.05, 0.16, fp);
    if (ripples > 0.0) {
      float wobble = noise(float2(x * 0.8, s * 0.5)) * 2.5;
      float ripple = sin(fromFalls * 3.4 - uTime * 3.5 + wobble);
      float crest = smoothstep(0.5, 0.92, ripple) * ripples;
      water = mix(water, SKY_HORIZON * 1.12, crest * 0.6 * (1.0 - smoothstep(2.0, 9.0, fromFalls) * 0.6));
    }
    // Foam churned up where the water lands, drifting out in streaks and
    // breaking into patches further out.
    float churn = exp(-fromFalls / 3.0);
    float drift = fbm(float2((fromFalls - uTime * 0.9) * 1.1, s * 0.6 + x * 0.4), fp * 1.1);
    float foam = smoothstep(0.5, 0.78, drift * 0.6 + churn * 0.7);
    water = mix(water, POND_FOAM, foam * 0.9);
    ground = mix(ground, water, pond);
  }

  // The stream's banks: bare, damp earth along the edge of its channel.
  float fromStream = abs(streamAcross(x, s));
  if (fromStream < STREAM_HALF + 0.6) {
    float halfWidth = streamHalf(x);
    float lip = 1.0 - smoothstep(halfWidth, halfWidth + 0.3, fromStream + (noise(float2(x, s) * 4.0) - 0.5) * 0.12);
    ground = mix(ground, BANK, lip * 0.75 * smoothstep(0.0, 0.05, streamDepth(x)) * smoothstep(1.0, 1.08, reach));
  }
  return ground;
}

// What a ray from the eye meets, with the camera camS along the trail:
// the ground, or, where it comes down into the stream's channel, whatever
// it meets further down — the water, or the far bank's wall if it gets
// there first — so the near bank hides the water just under it, as it
// would. The channel's edge is antialiased over the pixel's footprint,
// which is never taken as less than fpFloor (for motion blur).
float3 shadeRay(float dx, float dy, float a, float camS, float fpFloor) {
  float root = sqrt(max(dy * dy - 4.0 * a * uEyeH, 0.0));
  float t = (-dy - root) / (2.0 * a);
  float x = t * dx;
  float s = camS + t;
  // How much ground one pixel covers there, m: along the trail it grows
  // without bound toward the crest.
  float fp = max(max((abs(dy) / max(root, 0.0001) - 1.0) / (2.0 * a * uFocal), t / uFocal), fpFloor);
  float3 ground = groundColor(x, s, fp, t);

  float depth = streamDepth(x);
  if (depth <= 0.005) return ground;
  float halfW = streamHalf(x);
  float soft = max(fp, 0.01);
  float inside = (1.0 - smoothstep(-soft, soft, abs(streamAcross(x, s)) - halfW)) * smoothstep(0.98, 1.02, pondReach(x, s));
  if (inside <= 0.0) return ground;

  float3 channel;
  float root1 = sqrt(max(dy * dy - 4.0 * a * (uEyeH + depth), 0.0));
  float t1 = (-dy - root1) / (2.0 * a);
  float x1 = t1 * dx;
  float s1 = camS + t1;
  if (abs(streamAcross(x1, s1)) < halfW) {
    channel = streamWater(x1, s1, fp * t1 / t, t1);
  } else {
    // Where the ray meets the wall, between the two.
    float lo = t;
    float hi = t1;
    for (int i = 0; i < 6; i++) {
      float mid = (lo + hi) * 0.5;
      if (abs(streamAcross(mid * dx, camS + mid)) < halfW) lo = mid; else hi = mid;
    }
    float tw = (lo + hi) * 0.5;
    channel = bankWall(tw * dx, camS + tw, (tw - t) / max(t1 - t, 0.0001), fp);
  }
  return mix(ground, channel, inside);
}

float ring(float2 p, float2 center, float width) {
  return 1.0 - smoothstep(width, width * 2.0, abs(length(p - center) - 1.0));
}

half4 main(float2 xy) {
  float dx = (xy.x - uEye.x) / uFocal;
  float dy = (uEye.y - xy.y) / uFocal; // up is positive

  // The horizon's crest in this pixel's column.
  float a = (1.0 + dx * dx) / (2.0 * uRadius);
  float crestY = uEye.y + uFocal * sqrt(4.0 * a * uEyeH);

  float up = clamp((crestY - xy.y) / crestY, 0.0, 1.0);
  float3 sky = mix(SKY_HORIZON, SKY_TOP, pow(up, 0.7));
  // How much of this pixel is ground, antialiasing the horizon.
  float cover = clamp(xy.y - crestY + 0.5, 0.0, 1.0);
  if (cover <= 0.0) {
    return half4(half3(sky), 1.0);
  }

  // Where this pixel's ray meets the ground.
  float root = sqrt(max(dy * dy - 4.0 * a * uEyeH, 0.0));
  float t = (-dy - root) / (2.0 * a);
  float x = t * dx;
  float s = uCamS + t;
  // How much ground one pixel covers there, m: along the trail it grows
  // without bound toward the crest.
  float fp = max((abs(dy) / max(root, 0.0001) - 1.0) / (2.0 * a * uFocal), t / uFocal);

  // Motion blur along the trail, where the ground moves more than a pixel
  // or so a frame (the bottom of the screen): the camera's movement while
  // the frame is exposed, in four steps.
  // The stream's banks are sharper than anything else on the ground, so
  // near them it takes twice the steps not to show them.
  float3 ground;
  if (uBlur > fp * 1.5) {
    float blurred = max(fp, uBlur * 0.25);
    bool sharp = abs(streamAcross(x, s)) < STREAM_HALF + 0.5;
    ground = float3(0.0);
    if (sharp) {
      for (int i = 0; i < 8; i++) {
        ground += shadeRay(dx, dy, a, uCamS + (float(i) / 7.0 - 0.5) * uBlur, blurred);
      }
      ground *= 0.125;
    } else {
      for (int i = 0; i < 4; i++) {
        ground += shadeRay(dx, dy, a, uCamS + (float(i) / 3.0 - 0.5) * uBlur, blurred);
      }
      ground *= 0.25;
    }
  } else {
    ground = shadeRay(dx, dy, a, uCamS, 0.0);
  }

  if (uDebug > 0.5) {
    // Faded out where a pixel spans more ground than the lines are wide,
    // near the horizon, rather than smearing into a band.
    float legible = 1.0 - smoothstep(0.08, 0.3, fp);
    float w = max(fp * 1.2, 0.03);
    float across = abs(fract(x + 0.5) - 0.5);
    float along = abs(fract(s / 2.0 + 0.5) - 0.5) * 2.0;
    float grid = max(1.0 - smoothstep(w * 0.5, w, across), 1.0 - smoothstep(w * 0.5, w, along));
    ground = mix(ground, float3(1.0, 0.82, 0.2), grid * 0.85 * legible);
    float2 p = float2(x, s);
    float rw = max(w, 0.09);
    float spots = max(max(ring(p, uSpotsA.xy, rw), ring(p, uSpotsA.zw, rw)),
                      max(ring(p, uSpotsB.xy, rw), ring(p, uSpotsB.zw, rw)));
    ground = mix(ground, float3(0.95, 0.12, 0.1), spots * (1.0 - smoothstep(0.25, 0.6, fp)));
  }

  // Haze toward the horizon — the same curve hazeAt() applies to sprites.
  float horizon = sqrt(2.0 * uRadius * uEyeH);
  float k = clamp(t / (horizon * 1.15), 0.0, 1.0);
  ground = mix(ground, HAZE, k * k * MAX_HAZE);

  return half4(half3(mix(sky, ground, cover)), 1.0);
}
`;
