// Surface shaders for the escarpment's rock face and the falling water,
// Skia runtime effects. Both are painted onto the projected columns of
// falls.ts through their texture coordinates, so the pattern is fixed to
// the surface in the world and keeps its true perspective.

import { CLIFF_HEIGHT, GRAVITY } from './falls';
import { Palette, rgb } from './palette';

const color = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return `float3(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)})`;
};

const NOISE = `
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

// Octaves finer than the pixel's footprint fp (in p's units) are replaced
// by their average, so the surface calms with distance instead of shimmering.
float fbm(float2 p, float fp) {
  float sum = 0.0;
  float amp = 0.5;
  float scale = 1.0;
  for (int i = 0; i < 4; i++) {
    float detail = 1.0 - smoothstep(0.3, 0.9, fp * scale);
    sum += amp * mix(0.5, noise(p * scale + float2(float(i) * 13.7, float(i) * 7.1)), detail);
    scale *= 2.03;
    amp *= 0.5;
  }
  return sum / 0.9375;
}
`;

// The rock face. Coordinates: metres along the face, metres above the
// ground. Uniforms:
//   uFp   how much face one pixel covers here, m
//   uWet  1 behind the falls, where spray darkens the rock
export const ROCK_SKSL = `
uniform float uFp;
uniform float uWet;

const float3 CAP = ${color(Palette.cliffCap)};
const float3 CAP_LIT = ${color(Palette.cliffCapLit)};
const float3 STRATA = ${color(Palette.cliffStrata)};
const float3 SHALE = ${color(Palette.cliffShale)};
const float3 WET = ${color(Palette.cliffWet)};
const float3 JOINT = ${color(Palette.cliffJoint)};
const float3 MOSS = ${color(Palette.cliffMoss)};
const float HEIGHT = ${CLIFF_HEIGHT.toFixed(4)};
// The hard cap rock is the top few metres.
const float CAP_BOTTOM = ${(CLIFF_HEIGHT - 3.4).toFixed(4)};
${NOISE}
half4 main(float2 p) {
  float u = p.x;
  float h = p.y;
  float fp = uFp;
  float fine = 1.0 - smoothstep(0.08, 0.3, fp);
  // Beds of rock, gently warped, so their lines aren't ruled.
  float warp = (fbm(float2(u * 0.12, h * 0.2), fp * 0.2) - 0.5) * 0.9;
  float bed = h + warp;
  float course = floor(bed / 0.8);
  float capped = smoothstep(CAP_BOTTOM - 0.12, CAP_BOTTOM + 0.12, bed);
  float3 rock = mix(SHALE, STRATA, smoothstep(1.5, CAP_BOTTOM - 1.0, bed));
  rock = mix(rock, CAP, capped);
  // Each bed a slightly different shade.
  rock *= 0.9 + 0.2 * hash(float2(course, 2.9));
  // Mottling.
  float mottle = fbm(float2(u * 0.6, h * 0.9) + 11.0, fp * 0.9);
  rock *= 0.82 + 0.36 * mottle;
  // Long dark stains down the face, where water has run off the top.
  float stain = fbm(float2(u * 0.9, h * 0.06) + 40.0, fp * 0.9);
  rock *= 1.0 - 0.28 * smoothstep(0.5, 0.75, stain);
  // The softer rock under the cap is worn back, leaving it in shadow.
  float undercut = exp(-pow((bed - (CAP_BOTTOM - 0.35)) / 0.45, 2.0));
  rock *= 1.0 - 0.35 * undercut;
  // Bedding lines, about every 0.8 m, fading once finer than a pixel. Not
  // every bed shows a clean line.
  float lineWidth = max(fp * 1.2, 0.05);
  float along = abs(fract(bed / 0.8 + 0.5 * noise(float2(u * 0.05, 3.0))) - 0.5) * 0.8;
  float clean = smoothstep(0.35, 0.7, noise(float2(u * 0.15, course * 5.3)));
  float bedding = (1.0 - smoothstep(lineWidth * 0.5, lineWidth, along)) * fine * clean;
  rock = mix(rock, JOINT, bedding * 0.5);
  // Moss on the ledges, lower down where it stays damp.
  float ledge = (1.0 - smoothstep(0.0, 0.18, along)) * step(0.55, noise(float2(u * 0.7, course * 3.1)));
  rock = mix(rock, MOSS, ledge * (1.0 - capped) * 0.45);
  // Cracks: the cap rock splits into uneven blocks, a crack only here and
  // there down the shale. Each bed's cracks sit at their own places.
  float blockAt = u / (2.2 + 1.6 * hash(float2(course, 8.1))) + hash(float2(course, 1.7)) * 7.0;
  float crackDist = abs(fract(blockAt + (noise(float2(u * 0.4, bed * 0.6)) - 0.5) * 0.2) - 0.5) * 2.5;
  float cracked = step(0.45, hash(float2(floor(blockAt), course))) * mix(0.35, 1.0, capped);
  float cracks = (1.0 - smoothstep(lineWidth * 0.5, lineWidth * 1.2, crackDist)) * fine * cracked;
  rock = mix(rock, JOINT, cracks * 0.55);
  // Sunlit rim along the top, and grass and scrub hanging over its edge,
  // except where the water pours over.
  rock = mix(rock, CAP_LIT, smoothstep(HEIGHT - 0.6, HEIGHT - 0.15, h) * 0.7);
  float fringe = HEIGHT - 0.25 - 0.7 * fbm(float2(u * 0.9, 7.0), fp * 0.9);
  float soft = max(fp, 0.04);
  float overgrown = smoothstep(fringe - soft, fringe + soft, h) * (1.0 - uWet);
  float3 scrub = MOSS * (0.6 + 0.5 * noise(float2(u * 3.0, h * 3.0)));
  rock = mix(rock, scrub, overgrown);
  // Wet and dark behind the water.
  rock = mix(rock, WET * (0.85 + 0.3 * stain), uWet * 0.6);
  return half4(half3(rock), 1.0);
}
`;

// The falling water. Coordinates: metres along the trail, metres fallen from
// the lip. Uniforms:
//   uTime   s since the start
//   uCamS   the camera's distance along the trail, m
//   uFocal  focal length, px
export const WATER_SKSL = `
uniform float uTime;
uniform float uCamS;
uniform float uFocal;

const float3 GLASS = ${color(Palette.fallsGlass)};
const float3 GREEN = ${color(Palette.fallsGreen)};
const float3 WHITE = ${color(Palette.fallsWhite)};
const float3 STREAK = ${color(Palette.fallsStreak)};
const float G = ${GRAVITY.toFixed(4)};
const float HEIGHT = ${CLIFF_HEIGHT.toFixed(4)};
${NOISE}
half4 main(float2 p) {
  float s = p.x;
  float fall = max(p.y, 0.0);
  float fp = max(s - uCamS, 1.0) / uFocal;
  // The pattern rides on the water: each parcel keeps its streaks as it
  // falls, speeding up, so they stretch on the way down.
  float flight = sqrt(2.0 * fall / G);
  float flow = flight - uTime;
  float streaks = fbm(float2(s * 2.6, flow * 2.4), fp * 2.6);
  float fine = mix(0.5, noise(float2(s * 9.0, flow * 7.0)), 1.0 - smoothstep(0.03, 0.1, fp));
  // Glassy green over the lip, breaking into white within a few metres.
  float broken = smoothstep(0.5, 3.0, fall + (streaks - 0.5) * 3.0);
  float3 glass = mix(GLASS, GREEN, smoothstep(0.3, 0.75, streaks));
  float3 white = mix(STREAK, WHITE, smoothstep(0.3, 0.6, streaks * 0.75 + fine * 0.25));
  float3 water = mix(glass, white, broken);
  // Brightest where it curls over the lip, and in the spray near the foot.
  water = mix(water, WHITE, (1.0 - smoothstep(0.0, 0.25 + fp, fall)) * 0.45);
  water = mix(water, WHITE, smoothstep(HEIGHT - 3.0, HEIGHT, fall) * 0.55);
  return half4(half3(water), 1.0);
}
`;
