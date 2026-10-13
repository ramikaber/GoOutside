// Draws one frame of the intro's world onto a Skia canvas.
//
// createScene() builds every path, paint, picture and shader once, up
// front; drawScene() then only positions them, so it can run every frame
// on the UI thread. It takes the Skia API as an argument rather than
// importing it, so the same code can render frames outside the app (a
// headless Node script) to check them.
//
// Every call into Skia from the frame loop crosses from JavaScript into
// native code, and the forest puts a few hundred trees on screen at once,
// so each sprite is drawn with as few calls as possible: its whole
// transform in one concat(), and a tree as one pre-recorded picture.

import type { SkCanvas, SkColor, SkColorFilter, SkPaint, SkPath, SkRect, SkRSXform, SkSurface, Skia as SkiaValue } from '@shopify/react-native-skia';
import { AlphaType, BlendMode, ClipOp, ColorType, PaintStyle, PathOp, PointMode, StrokeCap, TileMode, VertexMode } from '@shopify/react-native-skia';

import { ROCK_ART, TREE_ART, TUFT_ART } from './art';
import { BEAR_ART, BEAR_LIMBS, BEAR_TREE, bearPose, bearX } from './bear';
import { BIRD_FRAMES, FLOCK, birdAt } from './birds';
import { DEER_ART, DEER_LEGS, HOOF, deerPose, legBone } from './deer';
import { FOREARM, HIKER_ART, HOLDING_SHOULDER, UPPER_ARM, WAVING_SHOULDER, armJoints, hikerPose } from './hiker';
import { FOOTING, POD, SKY_POD, TOWER_ART, type Ring } from './tower';
import {
  DOOR,
  GALLERY,
  GLAZING_BARS,
  LANTERN,
  LIGHTHOUSE_ART,
  LIGHTHOUSE_FOOTING,
  RAIL_POSTS,
  SHAFT,
  WINDOW,
  lighthouseRadius,
} from './lighthouse';
import { CLIFF_COLUMNS, CLIFF_HEIGHT, FALLS_ROWS, FALLS_S0, FALLS_S1, lipX, rockX, throwAt, topAt } from './falls';
import { ROCK_SKSL, WATER_SKSL } from './falls-shaders';
import { BRIDGE, STREAM_S } from './stream';
import { PLANE_COLORS, PLANE_MODEL, WRITE_DEPTH, planeAt, planeAttitude, wordLayout } from './plane';
import { PUFFS, puffRadius } from './skywriting';
import { COMPASS_DEPTH, LOGO_CENTRE, SPIN_FROM, compassPlacement, compassScale, compassTurn } from './compass';
import { LEAF_PATH, LETTERS_PATH, STAR_PATH, TICKS } from '../compass-geometry';
import { GROUND_SKSL } from './ground-shader';
import { Palette, rgb } from './palette';
import {
  CAMERA,
  DEBUG_SPOTS,
  FAR,
  MAX_HAZE,
  NEAR,
  SPRITES,
  SPRITE_BEAR,
  SPRITE_BRIDGE,
  SPRITE_CLIFF,
  SPRITE_DEER,
  SPRITE_HIKER,
  SPRITE_LIGHTHOUSE,
  SPRITE_ROCK,
  SPRITE_TOWER,
  SPRITE_TREE,
  SPRITE_TUFT,
  cameraAt,
  crestAt,
  deerX,
  groundDrop,
  hazeAt,
  type Sprite,
} from './world';

type SkiaApi = typeof SkiaValue;

// How far the camera travels while one frame is exposed, m (60 fps with a
// half-frame shutter), for motion blur on the nearest ground.
const MOTION_BLUR = (CAMERA.speed / 60) * 0.5;

// Haze is applied in steps this fine: rocks, tufts and shadows through
// color filters made up front, trees baked into their pictures.
const HAZE_LEVELS = 32;
const TREE_HAZE_LEVELS = 16;

// How far trees and grass sway either way, degrees.
const TREE_SWAY = 0.7;
const TUFT_SWAY = 6;

// Tree tones: as painted, a little darker and cooler, a little lighter and
// warmer. Multipliers on red, green and blue.
const TREE_TINTS = [
  [1, 1, 1],
  [0.8, 0.87, 0.9],
  [1.1, 1.08, 0.95],
];

export interface SceneOptions {
  // Overlay a world grid and rings round a few trees' spots on the ground.
  debug?: boolean;
  // Leave out the ground, sky and shadows (for checking sprites on their own).
  noGround?: boolean;
  // Draw only this tree (its index in FOREST) and no other sprites.
  onlyTree?: number;
  // Paint trees in plain opaque black: the same geometry with nothing that
  // could make it see-through, to compare the real render against.
  silhouette?: boolean;
  // Draw only trees, each in a flat color encoding its index in FOREST
  // (index + 1 as 24-bit RGB), without antialiasing, to count what shows.
  treeIds?: boolean;
  // Draw only the deer, or only the hiker (for checking them on their own).
  onlyDeer?: boolean;
  onlyHiker?: boolean;
  onlyTower?: boolean;
  onlyBear?: boolean;
  onlyBirds?: boolean;
  onlyFalls?: boolean;
  onlyBridge?: boolean;
  onlyPlane?: boolean;
  onlySmoke?: boolean;
  onlyCompass?: boolean;
  onlyLighthouse?: boolean;
  // Keep the camera where it is at this moment while everything else
  // (water, animals, wind) carries on, for checking how things move.
  holdCamera?: number;
  // Draw the ground and sky at this many pixels per point, into a surface
  // of their own scaled up onto the screen, rather than at the screen's own
  // resolution. Their shader is most of the GPU's work, and the ground is
  // smoothed to about a point anyway. Left out, they're drawn directly.
  groundResolution?: number;
}

export type DrawScene = (
  canvas: SkCanvas,
  time: number,
  width: number,
  height: number,
  options: SceneOptions,
) => void;

export function createScene(Skia: SkiaApi): DrawScene {
  const effect = Skia.RuntimeEffect.Make(GROUND_SKSL);
  if (!effect) throw new Error('Intro ground shader failed to compile');
  const rockEffect = Skia.RuntimeEffect.Make(ROCK_SKSL);
  if (!rockEffect) throw new Error('Intro rock shader failed to compile');
  const waterEffect = Skia.RuntimeEffect.Make(WATER_SKSL);
  if (!waterEffect) throw new Error('Intro water shader failed to compile');

  const path = (d: string): SkPath => {
    const result = Skia.Path.MakeFromSVGString(d);
    if (!result) throw new Error(`Bad intro path: ${d.slice(0, 40)}…`);
    return result;
  };
  const op = (one: SkPath, two: SkPath, kind: PathOp): SkPath => {
    const result = Skia.Path.MakeFromOp(one, two, kind);
    if (!result) throw new Error('Intro path op failed');
    return result;
  };
  const union = (paths: SkPath[]) => paths.reduce((all, next) => op(all, next, PathOp.Union));
  const color = (hex: string, alpha = 1): SkColor => {
    const [r, g, b] = rgb(hex);
    return Float32Array.of(r, g, b, alpha);
  };
  const paint = (hex?: string) => {
    const result = Skia.Paint();
    result.setAntiAlias(true);
    if (hex) result.setColor(color(hex));
    return result;
  };
  // A vertical gradient over a unit-height shape standing on the origin:
  // `stops` run from its base (0) to its top (1).
  const verticalPaint = (stops: [number, string][]) => {
    const result = paint();
    result.setShader(
      Skia.Shader.MakeLinearGradient(
        Skia.Point(0, 0),
        Skia.Point(0, -1),
        stops.map(([, hex]) => color(hex)),
        stops.map(([at]) => at),
        TileMode.Clamp,
      ),
    );
    return result;
  };

  // Haze: blends colors toward the horizon haze while keeping coverage
  // exactly as it was, so a distant tree is paler, never see-through.
  const hazeFilter = (amount: number) => Skia.ColorFilter.MakeBlend(color(Palette.haze, amount), BlendMode.SrcATop);
  const hazeFilters = Array.from({ length: HAZE_LEVELS + 1 }, (_, level) =>
    hazeFilter((level / HAZE_LEVELS) * MAX_HAZE),
  );

  // Trees: each tier's lit side and shaded underside are cut back wherever
  // a higher tier overlaps it, so the whole crown can be painted as three
  // merged layers instead of tier by tier.
  const trees = TREE_ART.map((art) => {
    const outlines = art.tiers.map((tier) => path(tier.outline));
    const lit: SkPath[] = [];
    const underside: SkPath[] = [];
    art.tiers.forEach((tier, i) => {
      let tierLit = op(path(tier.lit), outlines[i], PathOp.Intersect);
      let tierUnderside = op(path(tier.underside), outlines[i], PathOp.Intersect);
      if (i < outlines.length - 1) {
        const above = union(outlines.slice(i + 1));
        tierLit = op(tierLit, above, PathOp.Difference);
        tierUnderside = op(tierUnderside, above, PathOp.Difference);
      }
      lit.push(tierLit);
      underside.push(tierUnderside);
    });
    return {
      trunk: path(art.trunk),
      trunkLit: path(art.trunkLit),
      crown: union(outlines),
      lit: union(lit),
      underside: union(underside),
    };
  });
  const rocks = ROCK_ART.map(path);
  const tufts = TUFT_ART.map(path);

  const trunkPaint = paint(Palette.trunk);
  const trunkLitPaint = paint(Palette.trunkLit);
  const crownPaint = verticalPaint([
    [0.1, Palette.pineDeep],
    [0.45, Palette.pine],
    [1, Palette.pineMid],
  ]);
  const litPaint = verticalPaint([
    [0.15, Palette.pine],
    [0.65, Palette.pineLit],
    [1, Palette.pineTip],
  ]);
  const undersidePaint = paint(Palette.pineDeep);
  const treeLayers: [keyof (typeof trees)[number], SkPaint][] = [
    ['trunk', trunkPaint],
    ['trunkLit', trunkLitPaint],
    ['crown', crownPaint],
    ['lit', litPaint],
    ['underside', undersidePaint],
  ];
  const silhouettePaint = paint('#000000');
  const idPaint = Skia.Paint();
  idPaint.setAntiAlias(false);

  // Every tree look recorded once as a picture — shape, tone and haze level
  // baked in — so drawing a tree is a single call.
  const tintFilters: SkColorFilter[] = TREE_TINTS.map(([r, g, b]) =>
    Skia.ColorFilter.MakeMatrix([r, 0, 0, 0, 0, 0, g, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0]),
  );
  const treePictures = trees.map((tree) =>
    tintFilters.map((tint) =>
      Array.from({ length: TREE_HAZE_LEVELS + 1 }, (_, level) => {
        const filter = Skia.ColorFilter.MakeCompose(hazeFilter((level / TREE_HAZE_LEVELS) * MAX_HAZE), tint);
        const recorder = Skia.PictureRecorder();
        const canvas = recorder.beginRecording(Skia.XYWHRect(-1, -1.2, 2, 1.4));
        for (const [layer, layerPaint] of treeLayers) {
          layerPaint.setColorFilter(filter);
          canvas.drawPath(tree[layer], layerPaint);
        }
        return recorder.finishRecordingAsPicture();
      }),
    ),
  );

  // Rocks: lit from the upper left, like everything else, in three stones,
  // and the lighthouse's granite.
  const rockPaints = [
    [Palette.rockLit, Palette.rock, Palette.rockDark],
    [Palette.sandstoneLit, Palette.sandstone, Palette.sandstoneDark],
    [Palette.rockLit, Palette.moss, Palette.rockDark],
    [Palette.graniteLit, Palette.granite, Palette.graniteDark],
  ].map((stops) => {
    const result = paint();
    result.setShader(
      Skia.Shader.MakeLinearGradient(
        Skia.Point(-0.3, -0.55),
        Skia.Point(0.35, 0.05),
        stops.map((hex) => color(hex)),
        [0, 0.45, 1],
        TileMode.Clamp,
      ),
    );
    return result;
  });

  // Tufts: dark at the root, lighter toward the tips, in three colorings.
  const tuftPaints = [
    verticalPaint([
      [0, Palette.grassDeep],
      [0.45, Palette.grass],
      [1, Palette.grassLight],
    ]),
    verticalPaint([
      [0, Palette.pineDeep],
      [0.4, Palette.grassDeep],
      [1, Palette.grass],
    ]),
    verticalPaint([
      [0, Palette.grassDeep],
      [0.4, Palette.grass],
      [1, Palette.grassDry],
    ]),
  ];

  // The deer: its body parts, a pair of bones for each leg, and a hoof.
  // The upper bone is broad at the top, so it reads as shoulder or thigh.
  const deer = {
    body: path(DEER_ART.body),
    belly: path(DEER_ART.belly),
    neck: path(DEER_ART.neck),
    throat: path(DEER_ART.throat),
    head: path(DEER_ART.head),
    nose: path(DEER_ART.nose),
    eye: path(DEER_ART.eye),
    ears: path(DEER_ART.ears),
    antlers: path(DEER_ART.antlers),
    tail: path(DEER_ART.tail),
    hoof: path(HOOF),
    bones: DEER_LEGS.map((leg) => ({
      upper: path(legBone(leg.upper, leg.front ? 0.2 : 0.25, 0.07)),
      lower: path(legBone(leg.lower, 0.065, 0.04)),
    })),
  };
  // Darker along the back, lighter toward the belly.
  const coatPaint = paint();
  coatPaint.setShader(
    Skia.Shader.MakeLinearGradient(
      Skia.Point(0, -1.05),
      Skia.Point(0, -0.6),
      [color(Palette.deerBack), color(Palette.deerCoat), color(Palette.deerCoatLit)],
      [0, 0.45, 1],
      TileMode.Clamp,
    ),
  );
  const nearLegPaint = paint(Palette.deerCoat);
  const farLegPaint = paint(Palette.deerFar);
  const palePaint = paint(Palette.deerPale);
  const darkPaint = paint(Palette.deerDark);
  const antlerPaint = paint(Palette.antler);
  antlerPaint.setStyle(PaintStyle.Stroke);
  antlerPaint.setStrokeWidth(0.028);
  antlerPaint.setStrokeCap(StrokeCap.Round);
  const deerPaints = [coatPaint, nearLegPaint, farLegPaint, palePaint, darkPaint, antlerPaint];
  const silhouetteStroke = paint('#000000');
  silhouetteStroke.setStyle(PaintStyle.Stroke);
  silhouetteStroke.setStrokeWidth(0.028);
  silhouetteStroke.setStrokeCap(StrokeCap.Round);

  // The hiker. The plaid's checks are cut to the jacket once, here.
  const jacket = path(HIKER_ART.jacket);
  const hiker = {
    pack: path(HIKER_ART.pack),
    legs: path(HIKER_ART.legs),
    legShade: path(HIKER_ART.legShade),
    boots: path(HIKER_ART.boots),
    jacket,
    plaid: op(path(HIKER_ART.plaid), jacket, PathOp.Intersect),
    straps: path(HIKER_ART.straps),
    neck: path(HIKER_ART.neck),
    head: path(HIKER_ART.head),
    beard: path(HIKER_ART.beard),
    mouth: path(HIKER_ART.mouth),
    eyes: path(HIKER_ART.eyes),
    toque: path(HIKER_ART.toque),
    cuff: path(HIKER_ART.cuff),
    pom: path(HIKER_ART.pom),
    hand: path(HIKER_ART.hand),
    upperArm: path(legBone(UPPER_ARM, 0.095, 0.08)),
    forearm: path(legBone(FOREARM, 0.08, 0.065)),
    // One metre long; stretched to reach from hand to ground.
    pole: path(legBone(1, 0.02, 0.02)),
  };
  const jacketPaint = paint(Palette.hikerJacket);
  const plaidPaint = paint(Palette.hikerPlaid);
  const pantsPaint = paint(Palette.hikerPants);
  const pantsShadePaint = paint(Palette.hikerPantsShade);
  const bootPaint = paint(Palette.hikerBoots);
  const skinPaint = paint(Palette.hikerSkin);
  const beardPaint = paint(Palette.hikerBeard);
  const toquePaint = paint(Palette.hikerToque);
  const cuffPaint = paint(Palette.hikerToqueCuff);
  const pomPaint = paint(Palette.hikerPom);
  const packPaint = paint(Palette.hikerPack);
  const strapPaint = paint(Palette.hikerStrap);
  const polePaint = paint(Palette.hikerPole);
  const hikerPaints = [
    jacketPaint,
    plaidPaint,
    pantsPaint,
    pantsShadePaint,
    bootPaint,
    skinPaint,
    beardPaint,
    toquePaint,
    cuffPaint,
    pomPaint,
    packPaint,
    strapPaint,
    polePaint,
    darkPaint,
  ];

  // The CN Tower's fixed shapes, in its own units (height 1).
  const towerShapes = {
    body: path(TOWER_ART.body),
    lit: path(TOWER_ART.lit),
    shade: path(TOWER_ART.shade),
    grooves: path(TOWER_ART.grooves),
    upperShaft: path(TOWER_ART.upperShaft),
    antenna: path(TOWER_ART.antenna),
    antennaBands: path(TOWER_ART.antennaBands),
    beacon: path(TOWER_ART.beacon),
  };
  const towerPaint = paint(Palette.tower);
  const towerLitPaint = paint(Palette.towerLit);
  const towerShadePaint = paint(Palette.towerShade);
  const towerUnderPaint = paint(Palette.towerUnder);
  const glassPaint = paint(Palette.towerGlass);
  const beaconPaint = paint(Palette.beacon);
  const towerPaints = [towerPaint, towerLitPaint, towerShadePaint, towerUnderPaint, glassPaint, beaconPaint];
  // Where the tower meets the ground is a circle on the ground, filled
  // solid: in its own colour, and plain black or its ID colour for checks.
  const FOOTING_POINTS = 24;
  // Points along each half of a pod's ring.
  const RING_STEPS = 24;
  const footingColors = (c: SkColor) => Array.from({ length: FOOTING_POINTS + 2 }, () => c);
  const footingFill = footingColors(color(Palette.towerShade));
  const footingBlack = footingColors(color('#000000'));
  const footingId = footingColors(Float32Array.of(1, 1, 254 / 255, 1));

  // Peggy's Cove lighthouse, in its own units: white, sunlit on its left,
  // shaded across its width as a round tower is; its lantern and roof red.
  const lighthouse = {
    body: path(LIGHTHOUSE_ART.body),
    plinth: path(LIGHTHOUSE_ART.plinth),
    door: path(LIGHTHOUSE_ART.door),
    window: path(LIGHTHOUSE_ART.window),
    rod: path(LIGHTHOUSE_ART.rod),
  };
  const shaftPaint = paint();
  shaftPaint.setShader(
    Skia.Shader.MakeLinearGradient(
      Skia.Point(-SHAFT.bottom, 0),
      Skia.Point(SHAFT.bottom, 0),
      [color(Palette.lighthouseLit), color(Palette.lighthouse), color(Palette.lighthouseShade), color(Palette.lighthouseShade)],
      [0.05, 0.4, 0.85, 1],
      TileMode.Clamp,
    ),
  );
  const plinthPaint = paint(Palette.lighthousePlinth);
  const redPaint = paint(Palette.lighthouseRed);
  const redShadePaint = paint(Palette.lighthouseRedShade);
  const underPaint = paint(Palette.lighthouseUnder);
  const lanternGlassPaint = paint(Palette.lighthouseGlass);
  const lampPaint = paint(Palette.lighthouseLamp);
  const doorPaint = paint(Palette.lighthouseDoor);
  const windowPaint = paint(Palette.lighthouseGlass);
  // The railing's posts and the lantern's glazing bars: thin red lines.
  const barPaint = paint(Palette.lighthouseRed);
  barPaint.setStyle(PaintStyle.Stroke);
  const lighthousePaints = [
    shaftPaint,
    plinthPaint,
    redPaint,
    redShadePaint,
    underPaint,
    lanternGlassPaint,
    lampPaint,
    doorPaint,
    windowPaint,
    barPaint,
  ];
  const lighthouseFooting = footingColors(color(Palette.lighthousePlinth));
  const lighthouseId = Float32Array.of(248 / 255, 0, 0, 1);
  const lighthouseFootingId = footingColors(lighthouseId);

  // The bear: its body parts, a pair of bones for each limb, a paw.
  const bear = {
    body: path(BEAR_ART.body),
    rim: path(BEAR_ART.rim),
    head: path(BEAR_ART.head),
    muzzle: path(BEAR_ART.muzzle),
    nose: path(BEAR_ART.nose),
    ears: path(BEAR_ART.ears),
    eye: path(BEAR_ART.eye),
    paw: path(BEAR_ART.paw),
    claws: path(BEAR_ART.claws),
    bones: BEAR_LIMBS.map((limb) => ({
      upper: path(legBone(limb.upper, limb.front ? 0.16 : 0.2, 0.12)),
      lower: path(legBone(limb.lower, 0.12, 0.1)),
    })),
  };
  const furPaint = paint(Palette.bearFur);
  const farFurPaint = paint(Palette.bearFar);
  // Near limbs a shade lighter, so they stand out against the body.
  const nearFurPaint = paint(Palette.bearNear);
  const rimPaint = paint(Palette.bearRim);
  const muzzlePaint = paint(Palette.bearMuzzle);
  const bearDarkPaint = paint(Palette.bearDark);
  const clawPaint = paint(Palette.bearClaw);
  const bearPaints = [furPaint, farFurPaint, nearFurPaint, rimPaint, muzzlePaint, bearDarkPaint, clawPaint];

  // The flock's wingbeat, as six outlines.
  const birdFrames = BIRD_FRAMES.map(path);
  const birdPaint = paint(Palette.bird);

  // The escarpment and the falls. Rock and water are painted by their
  // shaders through each column's texture coordinates; the rock's shading
  // (how squarely each piece faces the sun, darker toward its foot) comes in
  // through its corners' colors, multiplied in. Their outlines against the
  // sky are traced with a thin antialiased line, since the columns' own
  // edges aren't antialiased (that keeps the seams between them closed).
  const rockPaint = paint();
  const waterPaint = paint();
  const mistPaint = paint();
  const rockEdgePaint = paint(Palette.cliffCapLit);
  rockEdgePaint.setStyle(PaintStyle.Stroke);
  rockEdgePaint.setStrokeWidth(0.7);
  const waterEdgePaint = paint(Palette.fallsWhite);
  waterEdgePaint.setStyle(PaintStyle.Stroke);
  waterEdgePaint.setStrokeWidth(0.7);
  const lipPaint = paint(Palette.fallsGreen);
  lipPaint.setStyle(PaintStyle.Stroke);
  lipPaint.setStrokeWidth(0.7);
  const fallsPaints = [rockPaint, waterPaint, mistPaint, rockEdgePaint, waterEdgePaint, lipPaint];
  // Which way the sun is, across and along the trail: to the left, a
  // little behind us.
  const SUN_X = -0.96;
  const SUN_S = -0.29;
  const [mistR, mistG, mistB] = rgb(Palette.mist);
  // The spray at the falls' foot: a dense veil just in front of the water
  // and a thinner, taller cloud further out. How far out from where the
  // water lands, how high each rises, m, how thick it is at its thickest,
  // and at the water (the outer cloud thins to nothing there, so its foot
  // doesn't draw a line across the pond).
  const MIST_LAYERS = [
    { out: 0.4, height: 3.6, alpha: 0.6, foot: 0.55 },
    { out: 2.2, height: 6, alpha: 0.32, foot: 0 },
  ];
  const WATER_VERTICES = 2 * (FALLS_ROWS + 1);
  const plainColors = (count: number, c: SkColor) => Array.from({ length: count }, () => c);
  const rockIdColors = plainColors(4, Float32Array.of(252 / 255, 1 / 255, 0, 1));
  const waterIdColors = plainColors(WATER_VERTICES, Float32Array.of(252 / 255, 2 / 255, 0, 1));
  const rockBlack = plainColors(4, color('#000000'));
  const waterBlack = plainColors(WATER_VERTICES, color('#000000'));

  // The footbridge: every face a flat colour, lit as it faces the sun.
  const bridgePaint = paint();
  const plankColors = [color(Palette.plank), color(Palette.plankLight), color(Palette.plankDark)];
  const bridgeColors = {
    gap: color(Palette.plankGap),
    face: color(Palette.deckFace),
    kerbLit: color(Palette.kerb),
    kerbShade: color(Palette.kerbShade),
    kerbTop: color(Palette.kerbTop),
    kerbEnd: color(Palette.kerbEnd),
  };
  const bridgeId = Float32Array.of(251 / 255, 0, 0, 1);
  const black = color('#000000');
  // How near the camera a face of the bridge is cut off, m ahead, as we
  // walk over it; by then it's well below the bottom of the screen.
  const CLIP_AHEAD = 0.3;

  // Smoke: every puff drawn from one soft, round image, lit a little from
  // the upper left, scaled and placed per puff in a single call.
  const PUFF_PX = 64;
  const puffImage = (() => {
    const bytes = new Uint8Array(PUFF_PX * PUFF_PX * 4);
    for (let j = 0; j < PUFF_PX; j++) {
      for (let i = 0; i < PUFF_PX; i++) {
        const dx = (i + 0.5) / (PUFF_PX / 2) - 1;
        const dy = (j + 0.5) / (PUFF_PX / 2) - 1;
        const r = Math.hypot(dx, dy);
        const edge = Math.min(Math.max((1 - r) / 0.55, 0), 1);
        const alpha = edge * edge * (3 - 2 * edge);
        // Brighter toward the light, a cool grey in its shade.
        const light = Math.min(Math.max(0.9 - 0.12 * (dx + dy), 0.74), 1);
        const k = (j * PUFF_PX + i) * 4;
        bytes[k] = Math.round(255 * light * alpha);
        bytes[k + 1] = Math.round(255 * Math.min(light + 0.01, 1) * alpha);
        bytes[k + 2] = Math.round(255 * Math.min(light + 0.03, 1) * alpha);
        bytes[k + 3] = Math.round(255 * alpha);
      }
    }
    const image = Skia.Image.MakeImage(
      { width: PUFF_PX, height: PUFF_PX, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Premul },
      Skia.Data.fromBytes(bytes),
      PUFF_PX * 4,
    );
    if (!image) throw new Error('Intro smoke puff failed to build');
    return image;
  })();
  const puffSource = Skia.XYWHRect(0, 0, PUFF_PX, PUFF_PX);
  const puffSources: SkRect[] = PUFFS.map(() => puffSource);
  const smokePaint = paint();
  // How dense the smoke is, and how much greyer its darkest puffs are.
  const SMOKE_ALPHA = 0.92;
  const SMOKE_SHADE = 0.12;
  const smokeId = Float32Array.of(250 / 255, 2 / 255, 0, 1);

  // The plane: its faces lit as they face the sun (up to the left, behind
  // us), in one call, nearest last.
  const planePaint = paint();
  const planeColors = PLANE_COLORS.map((hex) => rgb(hex));
  // Worked out here, not per face: rgb isn't a worklet, so drawScene can't
  // call it on the UI thread.
  const hazeRgb = rgb(Palette.haze);
  const planeId = Float32Array.of(250 / 255, 1 / 255, 0, 1);
  const SUN = (() => {
    const v = [-0.55, 0.7, -0.45];
    const l = Math.hypot(v[0], v[1], v[2]);
    return v.map((c) => c / l);
  })();
  // Haze on the plane, at most: it's in clear air above the trees.
  const PLANE_HAZE = 0.12;

  // The compass: the app's logo, the same marks as the in-app emblem, in
  // its pine, recorded once in the logo's own units (and plain black, and
  // in its ID colour, for checks), so drawing it is one call.
  const compassPictures = [Palette.compass, '#000000', null].map((hex) => {
    const ink = hex ? color(hex) : Float32Array.of(249 / 255, 0, 0, 1);
    const fillPaint = Skia.Paint();
    fillPaint.setAntiAlias(!!hex);
    fillPaint.setColor(ink);
    const strokePaint = Skia.Paint();
    strokePaint.setAntiAlias(!!hex);
    strokePaint.setColor(ink);
    strokePaint.setStyle(PaintStyle.Stroke);
    strokePaint.setStrokeCap(StrokeCap.Round);
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, 100, 100));
    strokePaint.setStrokeWidth(2.4);
    canvas.drawCircle(50, 50, 47, strokePaint);
    strokePaint.setStrokeWidth(0.6);
    canvas.drawCircle(50, 50, 44.8, strokePaint);
    for (const tick of TICKS) {
      strokePaint.setStrokeWidth(tick.width);
      canvas.drawLine(tick.x1, tick.y1, tick.x2, tick.y2, strokePaint);
    }
    canvas.drawPath(path(LETTERS_PATH), fillPaint);
    canvas.drawPath(path(STAR_PATH), fillPaint);
    strokePaint.setStrokeWidth(0.9);
    canvas.drawCircle(50, 50, 9.5, strokePaint);
    canvas.drawPath(path(LEAF_PATH), fillPaint);
    return recorder.finishRecordingAsPicture();
  });

  // As the intro ends the smoke drifts apart: each puff off on its own
  // slow way, swelling and thinning.
  const DRIFT_SPEED = 0.3; // units/s, each puff's own drift
  const WIND = [0.12, -0.04]; // units/s, all together
  const DRIFT_SWELL = 0.15; // a share bigger, a second on
  const DRIFT_THIN = 0.5; // a share thinner, a second on

  // A soft contact shadow: darkest at its centre point, fading to nothing
  // at the rim points around it (its colours are in shadowHazes, below).
  const shadowPaint = paint();
  const SHADOW_POINTS = 20;

  // How far each shape reaches either side of its root and above it, in its
  // own units, allowing for the most it ever sways. Used to skip sprites only
  // once every pixel of them is off-screen or below the horizon, so nothing
  // is dropped while a sliver of it could still show.
  const reachOf = (shape: SkPath, sway: number) => {
    const bounds = shape.computeTightBounds();
    const lean = -bounds.y * Math.sin((sway * Math.PI) / 180);
    return { left: bounds.x - lean, right: bounds.x + bounds.width + lean, top: -bounds.y };
  };
  const reaches = [
    trees.map((tree) => reachOf(op(tree.crown, tree.trunk, PathOp.Union), TREE_SWAY)),
    rocks.map((rock) => reachOf(rock, 0)),
    tufts.map((tuft) => reachOf(tuft, TUFT_SWAY)),
    // The deer, from tail to nose and hoof to antler tip, with room for its
    // stride and head nod.
    [{ left: -0.85, right: 1.12, top: 1.98 }],
    // The hiker, from the waving hand to the trekking pole and up to the
    // raised hand.
    [{ left: -0.8, right: 0.5, top: 1.95 }],
    // The tower, in its own units: its footing is the widest part.
    [{ left: -0.1, right: 0.1, top: 1 }],
    // The bear, from the trunk out to its back, up to its raised paws; set
    // wide enough to cover its height up the trunk (it's drawn from the
    // ground) and the tree's sway.
    [{ left: -0.3, right: 0.9, top: 6 }],
    // The escarpment and the bridge draw themselves.
    [],
    [],
    // The lighthouse, in its own units: its footing is the widest part.
    [{ left: -LIGHTHOUSE_FOOTING.radius, right: LIGHTHOUSE_FOOTING.radius, top: 1 }],
  ];

  const groundPaint = paint();
  // Spots ringed on the ground in the debug view, two to a uniform.
  const spots = DEBUG_SPOTS.flatMap((tree) => [tree.x, tree.s]);
  // Where the ground and sky go when they're drawn at their own resolution:
  // a surface kept from one frame to the next (made again only if the size
  // changes), or `failed` if one can't be made, when they're drawn directly.
  const groundTarget: { surface: SkSurface | null; canvas: SkCanvas | null; width: number; height: number; failed: boolean } = {
    surface: null,
    canvas: null,
    width: 0,
    height: 0,
    failed: false,
  };
  // Scaling it up: a Catmull-Rom cubic, sharper than bilinear.
  const UPSCALE_B = 0;
  const UPSCALE_C = 0.5;

  // How far off each sprite can be and still show anything over the
  // horizon's crest, m: from its height (and what it stands on), the way
  // FAR is worked out from the tallest. A sprite further off than this is
  // hidden whatever the head bob or its place across the trail, so it can be
  // passed over without working out where it lands. The escarpment and the
  // bridge draw themselves, so they're never passed over.
  const crestReach = Math.sqrt(2 * CAMERA.globeRadius);
  const highestEye = Math.sqrt(CAMERA.eyeHeight + CAMERA.bob);
  const showsWithin = Float64Array.from(SPRITES, (sprite) => {
    if (sprite.kind === SPRITE_CLIFF || sprite.kind === SPRITE_BRIDGE) return Infinity;
    const top = reaches[sprite.kind][sprite.variant].top * sprite.size + sprite.lift;
    return crestReach * (highestEye + Math.sqrt(Math.max(top, 0))) + 0.5;
  });
  // Beyond the crest, where no contact shadow shows.
  const shadowsWithin = crestReach * highestEye + 0.5;

  // Contact shadows, all drawn in one call: each one's fan of points, its
  // haze mixed into its colours (as the haze filter would, over a shadow
  // colour that's the same at the centre and the rim, so either way of
  // blending vertex colours gives the same result).
  const shadowRgb = rgb(Palette.shadow);
  const shadowHazes = Array.from({ length: HAZE_LEVELS + 1 }, (_, level) => {
    const amount = (level / HAZE_LEVELS) * MAX_HAZE;
    const mixed = shadowRgb.map((c, i) => c * (1 - amount) + hazeRgb[i] * amount);
    return { centre: Float32Array.of(mixed[0], mixed[1], mixed[2], 0.42), rim: Float32Array.of(mixed[0], mixed[1], mixed[2], 0) };
  });

  // The haze level each of the rocks', tufts' and birds' paints is set to
  // (-1 for none yet), so a paint isn't set again to the filter it already
  // has: the sprites come furthest first, so neighbours mostly share one.
  // Slots: rock tones 0–3, tuft tones 4–6, the birds 7.
  const hazeSet = new Int32Array(8).fill(-1);
  const BIRD_SLOT = 7;
  const setHaze = (target: SkPaint, slot: number, level: number) => {
    'worklet';
    if (hazeSet[slot] === level) return;
    hazeSet[slot] = level;
    target.setColorFilter(hazeFilters[level]);
  };

  return function drawScene(canvas, time, width, height, options) {
    'worklet';
    const camera = cameraAt(options.holdCamera ?? time, width, height);
    const onlyTree = options.onlyTree ?? -1;
    const treesOnly = onlyTree >= 0 || !!options.treeIds;
    const deerOnly = !!options.onlyDeer;
    const hikerOnly = !!options.onlyHiker;
    const towerOnly = !!options.onlyTower;
    const bearOnly = !!options.onlyBear;
    const birdsOnly = !!options.onlyBirds;
    const fallsOnly = !!options.onlyFalls;
    const bridgeOnly = !!options.onlyBridge;
    const planeOnly = !!options.onlyPlane;
    const smokeOnly = !!options.onlySmoke;
    const compassOnly = !!options.onlyCompass;
    const lighthouseOnly = !!options.onlyLighthouse;
    const soloActor =
      deerOnly ||
      hikerOnly ||
      towerOnly ||
      bearOnly ||
      birdsOnly ||
      fallsOnly ||
      bridgeOnly ||
      planeOnly ||
      smokeOnly ||
      compassOnly ||
      lighthouseOnly;

    // Where a sprite lands on screen, or null if none of it can show.
    const place = (sprite: Sprite) => {
      'worklet';
      const z = sprite.s - camera.s;
      const scale = camera.focal / z; // px per metre at this distance
      const k = sprite.size * scale; // px per unit of its shape
      const kx = k * sprite.xScale;
      const reach = reaches[sprite.kind][sprite.variant];
      // The deer is the one thing that moves: across the trail, never along it.
      const x = sprite.kind === SPRITE_DEER ? deerX(time) : sprite.kind === SPRITE_BEAR ? bearX(time) : sprite.x;
      const sx = camera.cx + x * scale;
      const left = sx + Math.min(reach.left * kx, reach.right * kx);
      const right = sx + Math.max(reach.left * kx, reach.right * kx);
      if (right < -1 || left > width + 1) return null;
      // Its root, on the curved ground.
      const sy = camera.cy + (camera.eyeHeight + groundDrop(x, z) - sprite.lift) * scale;
      // Beyond the horizon's crest, everything below the crest line is
      // hidden behind the curve of the ground.
      const crest = crestAt(camera, x / z);
      const clipY = z > crest.distance ? crest.y : -1;
      if (clipY >= 0 && sy - reach.top * k >= clipY) return null;
      return { z, k, kx, x, sx, sy, clipY, reach, haze: hazeAt(camera, z) / MAX_HAZE };
    };

    // The ground and sky at `resolution` pixels per point, into their own
    // surface, then scaled up onto the screen; false if there's no surface.
    const drawGroundAt = (resolution: number) => {
      'worklet';
      const w = Math.ceil(width * resolution);
      const h = Math.ceil(height * resolution);
      if (groundTarget.width !== w || groundTarget.height !== h) {
        groundTarget.surface = groundTarget.failed ? null : Skia.Surface.MakeOffscreen(w, h);
        groundTarget.canvas = groundTarget.surface ? groundTarget.surface.getCanvas() : null;
        groundTarget.failed = !groundTarget.surface;
        groundTarget.width = w;
        groundTarget.height = h;
      }
      const surface = groundTarget.surface;
      const target = groundTarget.canvas;
      if (!surface || !target) return false;
      target.save();
      target.scale(resolution, resolution);
      target.drawRect({ x: 0, y: 0, width, height }, groundPaint);
      target.restore();
      surface.flush();
      const src = { x: 0, y: 0, width: w, height: h };
      const dst = { x: 0, y: 0, width: w / resolution, height: h / resolution };
      canvas.drawImageRectCubic(surface.makeImageSnapshot(), src, dst, UPSCALE_B, UPSCALE_C, null);
      return true;
    };

    if (!options.noGround && !treesOnly && !soloActor) {
      groundPaint.setShader(
        effect.makeShader([
          camera.cx,
          camera.cy,
          camera.focal,
          camera.eyeHeight,
          CAMERA.globeRadius,
          camera.s,
          MOTION_BLUR,
          options.debug ? 1 : 0,
          ...spots,
          time,
        ]),
      );
      // In the debug view, at full resolution, so the grid stays crisp.
      const resolution = options.debug ? undefined : options.groundResolution;
      if (!resolution || !drawGroundAt(resolution)) canvas.drawRect({ x: 0, y: 0, width, height }, groundPaint);

      // Contact shadows are part of the ground, so they go down before any
      // sprite: a soft patch on the ground under each tree, rock and animal,
      // a fixed size in the world. Each is a fan of points around its
      // centre, every point projected onto the curved ground like the ground
      // itself, so a shadow keeps its true shape even right under the
      // camera. None behind the crest, where the ground is out of sight.
      // They're gathered up, furthest first, and drawn in one call.
      const fanPoints: { x: number; y: number }[] = [];
      const fanColors: SkColor[] = [];
      const fanIndices: number[] = [];
      for (let i = 0; i < SPRITES.length; i++) {
        const sprite = SPRITES[i];
        // Nothing on the plateau casts a shadow we could see.
        if (sprite.kind === SPRITE_TUFT || sprite.kind === SPRITE_CLIFF || sprite.kind === SPRITE_BRIDGE || sprite.lift > 0) continue;
        const z = sprite.s - camera.s;
        if (z > shadowsWithin) continue;
        if (z < NEAR) break;
        const at = place(sprite);
        if (!at || at.clipY >= 0) continue;
        // Its extent across and along the trail, m.
        let across: number;
        let along: number;
        if (sprite.kind === SPRITE_DEER) {
          across = 0.95;
          along = 0.4;
        } else if (sprite.kind === SPRITE_HIKER) {
          across = 0.33;
          along = 0.28;
        } else {
          across = ((at.reach.right - at.reach.left) / 2) * sprite.size * Math.abs(sprite.xScale) * (sprite.kind === SPRITE_TREE ? 1.05 : 1.2);
          along = across;
        }
        const centreX = at.x + 0.15 * across;
        // Its centre, then the points round its rim.
        const base = fanPoints.length;
        for (let p = 0; p <= SHADOW_POINTS; p++) {
          const angle = (p / SHADOW_POINTS) * Math.PI * 2;
          const x = p === 0 ? centreX : centreX + across * Math.cos(angle);
          // Points behind the camera go far below the screen, out of sight.
          const ahead = Math.max(p === 0 ? z : z + along * Math.sin(angle), 0.2);
          const perMetre = camera.focal / ahead;
          fanPoints.push({ x: camera.cx + x * perMetre, y: camera.cy + (camera.eyeHeight + groundDrop(x, ahead)) * perMetre });
        }
        const haze = shadowHazes[Math.round(at.haze * HAZE_LEVELS)];
        fanColors.push(haze.centre);
        for (let p = 1; p <= SHADOW_POINTS; p++) {
          fanColors.push(haze.rim);
          fanIndices.push(base, base + p, base + (p % SHADOW_POINTS) + 1);
        }
      }
      if (fanIndices.length) {
        canvas.drawVertices(Skia.MakeVertices(VertexMode.Triangles, fanPoints, null, fanColors, fanIndices), BlendMode.Dst, shadowPaint);
      }
    }

    // The flock: where each bird is now, nearest last. They fly toward and
    // away from us, so unlike everything else they're sorted every frame,
    // and drawn in among the sprites at their distance.
    const birds: { index: number; z: number; k: number; sx: number; sy: number; bank: number; frame: number }[] = [];
    const drawBirds = !soloActor || birdsOnly;
    if (drawBirds && (!treesOnly || options.treeIds)) {
      for (let b = 0; b < FLOCK.length; b++) {
        const state = birdAt(FLOCK[b], time);
        const z = state.s - camera.s;
        if (z < NEAR) continue;
        const perMetre = camera.focal / z;
        const k = FLOCK[b].size * perMetre;
        const sx = camera.cx + state.x * perMetre;
        const sy = camera.cy - (state.height - camera.eyeHeight - groundDrop(state.x, z)) * perMetre;
        if (sx + k < 0 || sx - k > width || sy + k < 0 || sy - k > height) continue;
        birds.push({ index: b, z, k, sx, sy, bank: state.bank, frame: Math.floor(state.flap * birdFrames.length) % birdFrames.length });
      }
      birds.sort((a, b) => b.z - a.z);
    }
    let nextBird = 0;
    const drawBirdsBeyond = (z: number) => {
      'worklet';
      while (nextBird < birds.length && birds[nextBird].z > z) {
        const bird = birds[nextBird++];
        let birdFill: SkPaint = birdPaint;
        if (options.treeIds) {
          idPaint.setColor(Float32Array.of(254 / 255, (bird.index + 1) / 255, 2 / 255, 1));
          birdFill = idPaint;
        } else if (options.silhouette) {
          birdFill = silhouettePaint;
        } else {
          setHaze(birdPaint, BIRD_SLOT, Math.round((hazeAt(camera, bird.z) / MAX_HAZE) * HAZE_LEVELS));
        }
        const bank = (bird.bank * Math.PI) / 180;
        canvas.save();
        canvas.concat([bird.k * Math.cos(bank), -bird.k * Math.sin(bank), bird.sx, bird.k * Math.sin(bank), bird.k * Math.cos(bank), bird.sy, 0, 0, 1]);
        canvas.drawPath(birdFrames[bird.frame], birdFill);
        canvas.restore();
      }
    };

    const waterShader = waterEffect.makeShader([time, camera.s, camera.focal]);
    // Where a point of the escarpment or the falls lands on screen: `x`
    // across the trail, `s` along it, `h` above the ground there.
    const project = (x: number, s: number, h: number) => {
      'worklet';
      const ahead = s - camera.s;
      const perMetre = camera.focal / ahead;
      return { x: camera.cx + x * perMetre, y: camera.cy - (h - camera.eyeHeight - groundDrop(x, ahead)) * perMetre };
    };
    // The horizon's crest across the whole screen, and everything above it:
    // what's left of a surface lying beyond the crest. The crest's height
    // on screen changes with direction, so it's traced point by point, the
    // same curve the ground shader draws, rather than taken as level.
    const horizon = Math.sqrt(2 * CAMERA.globeRadius * camera.eyeHeight);
    let aboveCrest: SkPath | null = null;
    const clipToCrest = () => {
      'worklet';
      if (!aboveCrest) {
        const steps = 48;
        let d = 'M0 -1';
        for (let i = 0; i <= steps; i++) {
          const sx = (camera.width * i) / steps;
          d += ' L' + sx.toFixed(2) + ' ' + crestAt(camera, (sx - camera.cx) / camera.focal).y.toFixed(2);
        }
        aboveCrest = Skia.Path.MakeFromSVGString(d + ' L' + camera.width.toFixed(2) + ' -1 Z');
      }
      if (aboveCrest) canvas.clipPath(aboveCrest, ClipOp.Intersect, true);
    };
    // Whether a spot on the ground is beyond the crest, out of sight.
    const beyondCrest = (x: number, s: number) => {
      'worklet';
      return Math.hypot(x, s - camera.s) > horizon;
    };

    // The haze level the escarpment's paints are set to, so neighbouring
    // columns at the same distance don't set it again.
    let fallsHaze = -1;
    // One column of the escarpment: its rock face, then the water pouring
    // down in front of it and the spray at the water's foot.
    const drawCliffColumn = (index: number) => {
      'worklet';
      const column = CLIFF_COLUMNS[index];
      const middle = (column.s0 + column.s1) / 2;
      const z = middle - camera.s;
      if (column.s0 - camera.s < 1) return;
      const x0 = rockX(column.s0);
      const x1 = rockX(column.s1);
      const top0 = project(x0, column.s0, topAt(column.s0));
      const top1 = project(x1, column.s1, topAt(column.s1));
      const foot0 = project(x0, column.s0, 0);
      const foot1 = project(x1, column.s1, 0);
      // The falls' foot juts out toward the trail, further left on screen
      // than the rock's.
      const waterFoot = column.falls ? project(lipX(column.s1) - throwAt(0) - 2.2, column.s1, 0).x : foot1.x;
      if (Math.min(top0.x, top1.x, foot0.x, foot1.x, waterFoot) > camera.width + 1) return;
      // Behind the horizon's crest, only what rises above its line shows:
      // the rock and the water, whose feet are metres apart, each judged
      // by where its own foot is.
      const rockBeyond = beyondCrest(rockX(middle), middle);
      const waterBeyond = column.falls && beyondCrest(lipX(middle) - throwAt(0), middle);
      const crestAtTop = (point: { x: number; y: number }) => {
        'worklet';
        return point.y >= crestAt(camera, (point.x - camera.cx) / camera.focal).y;
      };
      if (rockBeyond && crestAtTop(top0) && crestAtTop(top1)) return;
      const hazeLevel = Math.round((hazeAt(camera, z) / MAX_HAZE) * HAZE_LEVELS);
      if (hazeLevel !== fallsHaze) {
        for (let p = 0; p < fallsPaints.length; p++) fallsPaints[p].setColorFilter(hazeFilters[hazeLevel]);
        fallsHaze = hazeLevel;
      }
      const flat = options.treeIds || options.silhouette;
      canvas.save();
      if (rockBeyond) clipToCrest();

      // The rock: lit as squarely as it faces the sun, and darker toward
      // its foot, where less of the sky reaches it. Each edge is lit by
      // which way the face turns right there, so the light runs smoothly
      // from one column into the next.
      const litAt = (s: number) => {
        'worklet';
        const slope = (rockX(s + 0.05) - rockX(s - 0.05)) / 0.1;
        const facing = Math.max(0, (-slope * SUN_S - SUN_X) / Math.sqrt(1 + slope * slope));
        return 0.55 + 0.45 * facing;
      };
      const lit0 = litAt(column.s0);
      const lit1 = litAt(column.s1);
      const rockShades = [
        Float32Array.of(lit0, lit0, lit0, 1),
        Float32Array.of(lit0 * 0.78, lit0 * 0.78, lit0 * 0.78, 1),
        Float32Array.of(lit1, lit1, lit1, 1),
        Float32Array.of(lit1 * 0.78, lit1 * 0.78, lit1 * 0.78, 1),
      ];
      const rockCorners = [top0, foot0, top1, foot1];
      if (flat) {
        canvas.drawVertices(
          Skia.MakeVertices(VertexMode.TriangleStrip, rockCorners, null, options.treeIds ? rockIdColors : rockBlack),
          BlendMode.Dst,
          idPaint,
        );
      } else {
        rockPaint.setShader(rockEffect.makeShader([z / camera.focal, column.wet]));
        const texture = [
          { x: column.along0, y: CLIFF_HEIGHT },
          { x: column.along0, y: 0 },
          { x: column.along1, y: CLIFF_HEIGHT },
          { x: column.along1, y: 0 },
        ];
        canvas.drawVertices(
          Skia.MakeVertices(VertexMode.TriangleStrip, rockCorners, texture, rockShades),
          BlendMode.Modulate,
          rockPaint,
        );
        canvas.drawLine(top0.x, top0.y, top1.x, top1.y, rockEdgePaint);
      }

      canvas.restore();

      if (column.falls) {
        canvas.save();
        if (waterBeyond) clipToCrest();
        // The water, row by row down from the lip, spaced so each row has
        // come out the same distance further than the last.
        const points = [];
        const texture = [];
        const nearEdge = [];
        const farEdge = [];
        for (let r = 0; r <= FALLS_ROWS; r++) {
          const fall = CLIFF_HEIGHT * (r / FALLS_ROWS) ** 2;
          const out = throwAt(CLIFF_HEIGHT - fall);
          const a = project(lipX(column.s0) - out, column.s0, CLIFF_HEIGHT - fall);
          const b = project(lipX(column.s1) - out, column.s1, CLIFF_HEIGHT - fall);
          points.push(a, b);
          texture.push({ x: column.s0, y: fall }, { x: column.s1, y: fall });
          nearEdge.push(a);
          farEdge.push(b);
        }
        if (flat) {
          canvas.drawVertices(
            Skia.MakeVertices(VertexMode.TriangleStrip, points, null, options.treeIds ? waterIdColors : waterBlack),
            BlendMode.Dst,
            idPaint,
          );
        } else {
          waterPaint.setShader(waterShader);
          canvas.drawVertices(Skia.MakeVertices(VertexMode.TriangleStrip, points, texture), BlendMode.Dst, waterPaint);
          // The lip, and the curtain's profile at each end of the falls.
          canvas.drawLine(points[0].x, points[0].y, points[1].x, points[1].y, lipPaint);
          if (Math.abs(column.s0 - FALLS_S0) < 1e-6) canvas.drawPoints(PointMode.Polygon, nearEdge, waterEdgePaint);
          if (Math.abs(column.s1 - FALLS_S1) < 1e-6) canvas.drawPoints(PointMode.Polygon, farEdge, waterEdgePaint);

          // Spray rising off the pond where the water lands, billowing, and
          // thinning out toward the ends of the falls; the further layer is
          // nearer us, so it goes on last.
          const edges = [column.s0, column.s1];
          for (let m = 0; m < MIST_LAYERS.length; m++) {
            const layer = MIST_LAYERS[m];
            const mist = [];
            const mistColors = [];
            for (let e = 0; e < 2; e++) {
              const s = edges[e];
              const footX = lipX(s) - throwAt(0) - layer.out;
              const rise = layer.height * (1 + 0.2 * Math.sin(time * 1.7 + s * 0.9 + m * 2.1));
              const ends = Math.min(s - FALLS_S0, FALLS_S1 - s);
              const alpha = layer.alpha * Math.min(Math.max(ends / 3, 0), 1) ** 0.7;
              mist.push(project(footX, s, rise), project(footX, s, rise * 0.25), project(footX, s, 0));
              mistColors.push(
                Float32Array.of(mistR, mistG, mistB, 0),
                Float32Array.of(mistR, mistG, mistB, alpha),
                Float32Array.of(mistR, mistG, mistB, alpha * layer.foot),
              );
            }
            // Two bands, upper and lower, as triangles: 0-1-3 1-4-3, 1-2-4 2-5-4.
            canvas.drawVertices(
              Skia.MakeVertices(VertexMode.Triangles, mist, null, mistColors, [0, 1, 3, 1, 4, 3, 1, 2, 4, 2, 5, 4]),
              BlendMode.Dst,
              mistPaint,
            );
          }
        }
        canvas.restore();
      }
    };

    // A flat face given by its corners in the world (x, s, h), cut off
    // where it comes nearer than CLIP_AHEAD, as a path on screen.
    const face = (corners: number[][]) => {
      'worklet';
      const near = camera.s + CLIP_AHEAD;
      const kept: number[][] = [];
      for (let i = 0; i < corners.length; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % corners.length];
        const aIn = a[1] >= near;
        if (aIn) kept.push(a);
        if (aIn !== b[1] >= near) {
          const k = (near - a[1]) / (b[1] - a[1]);
          kept.push([a[0] + (b[0] - a[0]) * k, near, a[2] + (b[2] - a[2]) * k]);
        }
      }
      if (kept.length < 3) return null;
      let d = '';
      for (let i = 0; i < kept.length; i++) {
        const q = project(kept[i][0], kept[i][1], kept[i][2]);
        d += (i ? 'L' : 'M') + q.x.toFixed(2) + ' ' + q.y.toFixed(2);
      }
      return Skia.Path.MakeFromSVGString(d + 'Z');
    };
    // The footbridge: its deck of planks with gaps between, the deck's
    // front edge, and a log kerb along each side. Only the faces turned
    // toward the trail's middle, where the camera is, can show.
    const drawBridge = () => {
      'worklet';
      const { halfWidth: hw, s0, s1, deck, kerbWidth, kerbHeight } = BRIDGE;
      if (s1 - camera.s < CLIP_AHEAD) return;
      const beyond = Math.hypot(hw, s0 - camera.s) > horizon;
      if (beyond && s0 - camera.s > horizon + 8) return;
      const flat = options.treeIds ? bridgeId : options.silhouette ? black : null;
      bridgePaint.setColorFilter(flat ? null : hazeFilters[Math.round((hazeAt(camera, STREAM_S - camera.s) / MAX_HAZE) * HAZE_LEVELS)]);
      const fill = (corners: number[][], c: SkColor) => {
        'worklet';
        const shape = face(corners);
        if (!shape) return;
        bridgePaint.setColor(flat ?? c);
        canvas.drawPath(shape, bridgePaint);
      };
      canvas.save();
      if (beyond) clipToCrest();
      // The deck: dark between the planks, then the planks.
      fill([[-hw, s0, deck], [hw, s0, deck], [hw, s1, deck], [-hw, s1, deck]], bridgeColors.gap);
      const count = Math.round((s1 - s0) / (BRIDGE.plank + BRIDGE.gap));
      const pitch = (s1 - s0) / count;
      for (let i = 0; i < count; i++) {
        const a = s0 + i * pitch + BRIDGE.gap / 2;
        const b = a + pitch - BRIDGE.gap;
        const inset = 0.02 + 0.015 * ((i * 5) % 3);
        fill([[-hw + inset, a, deck], [hw - inset, a, deck], [hw - inset, b, deck], [-hw + inset, b, deck]], plankColors[(i * 7) % 3]);
      }
      // Its front edge, standing on the bank.
      fill([[-hw, s0, 0], [hw, s0, 0], [hw, s0, deck], [-hw, s0, deck]], bridgeColors.face);
      // The kerbs: the inner side (the right one's toward the sun), the
      // top, and the near end.
      for (let side = -1; side <= 1; side += 2) {
        const inner = side * (hw - kerbWidth);
        const outer = side * hw;
        const top = deck + kerbHeight;
        fill([[inner, s0, deck], [inner, s1, deck], [inner, s1, top], [inner, s0, top]], side > 0 ? bridgeColors.kerbLit : bridgeColors.kerbShade);
        fill([[inner, s0, top], [outer, s0, top], [outer, s1, top], [inner, s1, top]], bridgeColors.kerbTop);
        fill([[inner, s0, deck], [outer, s0, deck], [outer, s0, top], [inner, s0, top]], bridgeColors.kerbEnd);
      }
      canvas.restore();
    };

    // The skywriting: the smoke where the plane has been, fixed in the sky
    // at the plane's writing depth, facing us; and the plane, wherever it
    // is in its flight.
    const layout = wordLayout(width, height);
    const drawSmoke = () => {
      'worklet';
      const transforms: SkRSXform[] = [];
      const sources: SkRect[] = [];
      const tints: SkColor[] = [];
      // How far into drifting apart, s, easing in.
      const since = Math.max(time - SPIN_FROM, 0);
      const drift = since > 0 ? since - 0.25 * (1 - Math.exp(-since / 0.25)) : 0;
      const spread = Math.min(since, 1);
      for (let p = 0; p < PUFFS.length; p++) {
        const puff = PUFFS[p];
        if (puff.born > time) continue;
        const radius = puffRadius(time - puff.born, puff.size) * (1 + DRIFT_SWELL * spread) * layout.unit;
        const scale = (radius * 2) / PUFF_PX;
        // Each puff's own way: round the circle by the golden angle, so
        // neighbours go different ways.
        const way = p * 2.39996;
        const dx = (Math.cos(way) * DRIFT_SPEED * puff.size + WIND[0]) * drift;
        const dy = (Math.sin(way) * DRIFT_SPEED * puff.size + WIND[1]) * drift;
        // A plain object, which Skia reads as it would one of its own
        // (sparing a call into it for each puff).
        transforms.push({
          scos: scale,
          ssin: 0,
          tx: layout.left + (puff.x + dx) * layout.unit - radius,
          ty: layout.baseline + (puff.y + dy) * layout.unit - radius,
        } as SkRSXform);
        sources.push(puffSources[p]);
        const grey = 1 - SMOKE_SHADE * puff.shade;
        tints.push(options.treeIds ? smokeId : options.silhouette ? black : Float32Array.of(grey, grey, grey, SMOKE_ALPHA * (1 - DRIFT_THIN * spread)));
      }
      if (transforms.length) canvas.drawAtlas(puffImage, sources, transforms, smokePaint, BlendMode.Modulate, tints);
    };
    const plane = planeAt(time, width, height, camera.focal, camera.cy);
    // The compass, sprung in and turning, about its centre.
    const compass = compassPlacement(width, height);
    const drawCompass = () => {
      'worklet';
      const size = compassScale(time) * compass.unit;
      if (size <= 0) return;
      const turn = compassTurn(time);
      const cos = Math.cos(turn) * size;
      const sin = Math.sin(turn) * size;
      canvas.save();
      // Round its centre, then out from the logo's centre.
      canvas.concat([cos, -sin, compass.cx - (cos - sin) * LOGO_CENTRE, sin, cos, compass.cy - (sin + cos) * LOGO_CENTRE, 0, 0, 1]);
      canvas.drawPicture(compassPictures[options.treeIds ? 2 : options.silhouette ? 1 : 0]);
      canvas.restore();
    };
    // The plane, in two parts either side of the compass's distance, so as
    // it goes through the ring the part already through is behind the
    // compass and the rest in front.
    const drawPlane = (nearest: number, furthest: number) => {
      'worklet';
      if (!plane) return;
      const pose = planeAttitude(time, width, height, camera.focal, camera.cy, CAMERA.speed);
      const { forward: f, right: r, up: u } = pose;
      // Every corner, in the camera's frame.
      const corners = PLANE_MODEL.vertices.map((v) => [
        plane.x + v[0] * f.x + v[1] * r.x + v[2] * u.x,
        plane.y + v[0] * f.y + v[1] * r.y + v[2] * u.y,
        plane.z + v[0] * f.z + v[1] * r.z + v[2] * u.z,
      ]);
      const faces: { depth: number; index: number }[] = [];
      for (let k = 0; k < PLANE_MODEL.faces.length; k++) {
        const points = PLANE_MODEL.faces[k].points;
        let depth = 0;
        let behind = false;
        for (let q = 0; q < points.length; q++) {
          const c = corners[points[q]];
          if (c[2] < 0.5) behind = true;
          depth += c[2];
        }
        const middle = depth / points.length;
        if (!behind && middle > nearest && middle <= furthest) faces.push({ depth: middle, index: k });
      }
      if (!faces.length) return;
      faces.sort((a, b) => b.depth - a.depth);
      const haze = Math.min(hazeAt(camera, plane.z), PLANE_HAZE);
      const positions = [];
      const colors = [];
      for (let k = 0; k < faces.length; k++) {
        const face = PLANE_MODEL.faces[faces[k].index];
        const pts = face.points.map((q) => corners[q]);
        // Its normal, turned to face us, and how squarely that faces the sun.
        const a = pts[0];
        const b = pts[1];
        const c = pts[2];
        let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
        let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
        let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        const length = Math.hypot(nx, ny, nz) || 1;
        nx /= length;
        ny /= length;
        nz /= length;
        if (nx * -a[0] + ny * -a[1] + nz * -a[2] < 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        const light = 0.55 + 0.45 * Math.max(0, nx * SUN[0] + ny * SUN[1] + nz * SUN[2]);
        const base = planeColors[face.color];
        let fill: SkColor;
        if (options.treeIds) fill = planeId;
        else if (options.silhouette) fill = black;
        else {
          fill = Float32Array.of(
            base[0] * light * (1 - haze) + hazeRgb[0] * haze,
            base[1] * light * (1 - haze) + hazeRgb[1] * haze,
            base[2] * light * (1 - haze) + hazeRgb[2] * haze,
            1,
          );
        }
        const screen = pts.map((p) => ({ x: camera.cx + (p[0] * camera.focal) / p[2], y: camera.cy - (p[1] * camera.focal) / p[2] }));
        for (let q = 1; q + 1 < screen.length; q++) {
          positions.push(screen[0], screen[q], screen[q + 1]);
          colors.push(fill, fill, fill);
        }
      }
      canvas.drawVertices(Skia.MakeVertices(VertexMode.Triangles, positions, null, colors), BlendMode.Dst, planePaint);
    };
    // The two, drawn among everything else at their distances, the plane
    // in front of its own smoke.
    const showPlane = !soloActor || planeOnly;
    const skyLayers = [
      { z: WRITE_DEPTH, draw: drawSmoke, show: !soloActor || smokeOnly },
      { z: COMPASS_DEPTH, draw: drawCompass, show: !soloActor || compassOnly },
      { z: plane ? Math.max(plane.z, COMPASS_DEPTH + 0.01) : -1, draw: () => drawPlane(COMPASS_DEPTH, Infinity), show: showPlane },
      { z: plane ? Math.min(plane.z, COMPASS_DEPTH) - 0.01 : -1, draw: () => drawPlane(-Infinity, COMPASS_DEPTH), show: showPlane },
    ].sort((a, b) => b.z - a.z);
    let nextSky = 0;
    const drawSkyBeyond = (z: number) => {
      'worklet';
      while (nextSky < skyLayers.length && skyLayers[nextSky].z > z) {
        const layer = skyLayers[nextSky++];
        if (layer.show && layer.z > 0.5 && (!treesOnly || options.treeIds)) layer.draw();
      }
    };

    // Horizontal rings round a tall, round landmark (the CN Tower, the
    // lighthouse) standing where `at` places it, `height` m tall, its rings
    // in its own units. Each is projected point by point, as it would
    // really look from here, like the ground: from below we see a ring's
    // underside, more of it the closer we come.
    const ringsOf = (at: NonNullable<ReturnType<typeof place>>, height: number, plain: SkPaint | null) => {
      'worklet';
      const groundBelowEye = camera.eyeHeight + groundDrop(at.x, at.z);
      const ringPoint = (r: Ring, angle: number, grow = 1) => {
        'worklet';
        const x = at.x + r.radius * grow * height * Math.cos(angle);
        const ahead = Math.max(at.z + r.radius * grow * height * Math.sin(angle), 0.2);
        const perMetre = camera.focal / ahead;
        return [camera.cx + x * perMetre, camera.cy - (r.height * height - groundBelowEye) * perMetre];
      };
      // Part of a ring's outline as path commands, from one angle to
      // another; negative sines are its near side.
      const arc = (r: Ring, from: number, to: number, startPath: boolean, grow = 1) => {
        'worklet';
        const steps = Math.round((RING_STEPS * Math.abs(to - from)) / Math.PI);
        let d = '';
        for (let i = 0; i <= steps; i++) {
          const [x, y] = ringPoint(r, from + ((to - from) * i) / steps, grow);
          d += (startPath && i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2);
        }
        return d;
      };
      // The angles where a ring's outline turns back on screen — its left
      // and right edges under perspective — with its near side between.
      const edges = (r: Ring) => {
        'worklet';
        const offset = Math.atan2(at.x, at.z);
        const tilt = Math.asin(Math.min(Math.max((-r.radius * height) / Math.hypot(at.x, at.z), -1), 1));
        return [Math.PI - tilt - offset, 2 * Math.PI + tilt - offset];
      };
      const fill = (d: string, fillPaint: SkPaint) => {
        'worklet';
        const shape = Skia.Path.MakeFromSVGString(d + 'Z');
        if (shape) canvas.drawPath(shape, plain ?? fillPaint);
      };
      return {
        ringPoint,
        arc,
        edges,
        fill,
        // Where it meets the ground: the circle round its foot, each point
        // projected onto the curved ground like the ground itself, so the
        // base sits exactly on the ground even close up.
        footing: (r: Ring, colors: SkColor[], footingPaint: SkPaint) => {
          'worklet';
          const points = [];
          for (let p = -1; p <= FOOTING_POINTS; p++) {
            const angle = (p / FOOTING_POINTS) * Math.PI * 2;
            const x = p < 0 ? at.x : at.x + r.radius * height * Math.cos(angle);
            const ahead = Math.max(p < 0 ? at.z : at.z + r.radius * height * Math.sin(angle), 0.2);
            const perMetre = camera.focal / ahead;
            points.push({ x: camera.cx + x * perMetre, y: camera.cy + (camera.eyeHeight + groundDrop(x, ahead)) * perMetre });
          }
          canvas.drawVertices(Skia.MakeVertices(VertexMode.TriangleFan, points, null, colors), BlendMode.Dst, footingPaint);
        },
        // A ring's underside: its whole disc, over a slightly larger one in
        // `edgePaint` (to cover the slivers between the straight segments
        // that approximate both), so its edge against the sides doesn't show
        // a seam.
        underside: (r: Ring, underPaint: SkPaint, edgePaint: SkPaint) => {
          'worklet';
          if (!plain) fill(arc(r, 0, Math.PI * 2, true, 1.03), edgePaint);
          fill(arc(r, 0, Math.PI * 2, true), underPaint);
        },
        // The near face of the side between two rings, its right part —
        // away from the sun — in `shadePaint`, if one's given.
        band: (lower: Ring, upper: Ring, bandPaint: SkPaint, shadePaint: SkPaint | null) => {
          'worklet';
          const [lowerLeft, lowerRight] = edges(lower);
          const [upperLeft, upperRight] = edges(upper);
          const d = arc(lower, lowerLeft, lowerRight, true) + arc(upper, upperRight, upperLeft, false);
          fill(d, bandPaint);
          if (!shadePaint || plain) return;
          canvas.save();
          canvas.clipRect({ x: at.sx + 0.35 * upper.radius * at.k, y: -10000, width: 20000, height: 30000 }, ClipOp.Intersect, true);
          fill(d, shadePaint);
          canvas.restore();
        },
      };
    };

    // Furthest first, so nearer things paint over them.
    for (let i = 0; i < SPRITES.length; i++) {
      const sprite = SPRITES[i];
      const z = sprite.s - camera.s;
      drawSkyBeyond(z);
      if (z > FAR) continue;
      drawBirdsBeyond(z);
      if (z < NEAR) break; // the rest are nearer still
      if (z > showsWithin[i]) continue; // still below the crest
      // In the ID view the hiker is drawn too, in white, to measure how much
      // of them the trees hide.
      const inIds =
        sprite.kind === SPRITE_HIKER ||
        sprite.kind === SPRITE_TOWER ||
        sprite.kind === SPRITE_BEAR ||
        sprite.kind === SPRITE_CLIFF ||
        sprite.kind === SPRITE_BRIDGE ||
        sprite.kind === SPRITE_LIGHTHOUSE;
      if (treesOnly && sprite.kind !== SPRITE_TREE && !(options.treeIds && inIds)) continue;
      if (onlyTree >= 0 && sprite.id !== onlyTree) continue;
      if (deerOnly && sprite.kind !== SPRITE_DEER) continue;
      if (hikerOnly && sprite.kind !== SPRITE_HIKER) continue;
      if (towerOnly && sprite.kind !== SPRITE_TOWER) continue;
      if (lighthouseOnly && sprite.kind !== SPRITE_LIGHTHOUSE) continue;
      if (bearOnly && sprite.kind !== SPRITE_BEAR) continue;
      if (birdsOnly) continue;
      if (fallsOnly && sprite.kind !== SPRITE_CLIFF) continue;
      if (bridgeOnly && sprite.kind !== SPRITE_BRIDGE) continue;
      if (planeOnly || smokeOnly || compassOnly) continue;
      if (sprite.kind === SPRITE_CLIFF) {
        drawCliffColumn(sprite.variant);
        continue;
      }
      if (sprite.kind === SPRITE_BRIDGE) {
        drawBridge();
        continue;
      }
      const at = place(sprite);
      if (!at) continue;

      canvas.save();
      if (at.clipY >= 0) canvas.clipRect({ x: 0, y: 0, width, height: at.clipY }, ClipOp.Intersect, true);

      if (sprite.kind === SPRITE_TREE) {
        // A slow sway, pivoting at the roots.
        const angle = ((TREE_SWAY * Math.PI) / 180) * Math.sin(time * 1.3 + sprite.phase);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        canvas.concat([at.kx * cos, -at.kx * sin, at.sx, at.k * sin, at.k * cos, at.sy, 0, 0, 1]);
        if (options.silhouette || options.treeIds) {
          const plain = options.silhouette ? silhouettePaint : idPaint;
          if (options.treeIds) {
            const id = sprite.id + 1;
            plain.setColor(Float32Array.of(((id >> 16) & 255) / 255, ((id >> 8) & 255) / 255, (id & 255) / 255, 1));
          }
          const tree = trees[sprite.variant];
          for (let layer = 0; layer < treeLayers.length; layer++) canvas.drawPath(tree[treeLayers[layer][0]], plain);
        } else {
          canvas.drawPicture(treePictures[sprite.variant][sprite.tone][Math.round(at.haze * TREE_HAZE_LEVELS)]);
        }
      } else if (sprite.kind === SPRITE_ROCK) {
        const rockPaint = rockPaints[sprite.tone];
        setHaze(rockPaint, sprite.tone, Math.round(at.haze * HAZE_LEVELS));
        canvas.concat([at.k, 0, at.sx, 0, at.k, at.sy, 0, 0, 1]);
        canvas.drawPath(rocks[sprite.variant], rockPaint);
      } else if (sprite.kind === SPRITE_TUFT) {
        const tuftPaint = tuftPaints[sprite.tone];
        setHaze(tuftPaint, 4 + sprite.tone, Math.round(at.haze * HAZE_LEVELS));
        // Wind: a wave rolling across the grass, so neighbours bend together.
        const angle = ((TUFT_SWAY * Math.PI) / 180) * Math.sin(time * 2.4 - sprite.s * 0.6 + sprite.x * 0.9);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        canvas.concat([at.k * cos, -at.k * sin, at.sx, at.k * sin, at.k * cos, at.sy, 0, 0, 1]);
        canvas.drawPath(tufts[sprite.variant], tuftPaint);
      } else if (sprite.kind === SPRITE_DEER) {
        const haze = hazeFilters[Math.round(at.haze * HAZE_LEVELS)];
        for (let p = 0; p < deerPaints.length; p++) deerPaints[p].setColorFilter(haze);
        const plain = options.silhouette ? silhouettePaint : null;
        canvas.concat([at.k, 0, at.sx, 0, at.k, at.sy, 0, 0, 1]);
        const pose = deerPose(time);

        // One leg: its upper and lower bones and its hoof, each turned to lie
        // along the line between its joints.
        const drawLeg = (index: number, legPaint: SkPaint) => {
          'worklet';
          const leg = pose.legs[index];
          const bones = deer.bones[index];
          const segments: [number[], number[], SkPath][] = [
            [leg.hip, leg.joint, bones.upper],
            [leg.joint, leg.hoof, bones.lower],
          ];
          let turn = 0;
          for (let b = 0; b < segments.length; b++) {
            const [from, to, bone] = segments[b];
            turn = Math.atan2(to[1] - from[1], to[0] - from[0]) - Math.PI / 2;
            const cos = Math.cos(turn);
            const sin = Math.sin(turn);
            canvas.save();
            canvas.concat([cos, -sin, from[0], sin, cos, from[1], 0, 0, 1]);
            canvas.drawPath(bone, plain ?? legPaint);
            canvas.restore();
          }
          // The hoof follows the angle of the lower leg.
          const cos = Math.cos(turn);
          const sin = Math.sin(turn);
          canvas.save();
          canvas.concat([cos, -sin, leg.hoof[0], sin, cos, leg.hoof[1], 0, 0, 1]);
          canvas.drawPath(deer.hoof, plain ?? darkPaint);
          canvas.restore();
        };

        // Far legs, in shadow behind the body.
        for (let l = 0; l < DEER_LEGS.length; l++) if (!DEER_LEGS[l].near) drawLeg(l, farLegPaint);

        // The tail flicks about its root.
        const flick = (pose.tail * Math.PI) / 180;
        const tailX = DEER_ART.tailRoot[0];
        const tailY = DEER_ART.tailRoot[1] + pose.bob;
        canvas.save();
        const flag = 1.5;
        canvas.concat([
          flag * Math.cos(flick),
          -flag * Math.sin(flick),
          tailX,
          flag * Math.sin(flick),
          flag * Math.cos(flick),
          tailY,
          0,
          0,
          1,
        ]);
        canvas.drawPath(deer.tail, plain ?? palePaint);
        canvas.restore();

        // Body, rising and falling with the stride.
        canvas.save();
        canvas.concat([1, 0, 0, 0, 1, pose.bob, 0, 0, 1]);
        canvas.drawPath(deer.body, plain ?? coatPaint);
        canvas.drawPath(deer.belly, plain ?? palePaint);
        // Neck and head nod together about the base of the neck.
        const nod = (pose.nod * Math.PI) / 180;
        const cos = Math.cos(nod);
        const sin = Math.sin(nod);
        const px = 0.5;
        const py = -0.95;
        canvas.concat([cos, -sin, px - cos * px + sin * py, sin, cos, py - sin * px - cos * py, 0, 0, 1]);
        canvas.drawPath(deer.neck, plain ?? coatPaint);
        canvas.drawPath(deer.ears, plain ?? coatPaint);
        canvas.drawPath(deer.head, plain ?? coatPaint);
        canvas.drawPath(deer.throat, plain ?? palePaint);
        canvas.drawPath(deer.antlers, options.silhouette ? silhouetteStroke : antlerPaint);
        canvas.drawPath(deer.eye, plain ?? darkPaint);
        canvas.drawPath(deer.nose, plain ?? darkPaint);
        canvas.restore();

        // Near legs, over the body.
        for (let l = 0; l < DEER_LEGS.length; l++) if (DEER_LEGS[l].near) drawLeg(l, nearLegPaint);
      } else if (sprite.kind === SPRITE_HIKER) {
        const haze = hazeFilters[Math.round(at.haze * HAZE_LEVELS)];
        for (let p = 0; p < hikerPaints.length; p++) hikerPaints[p].setColorFilter(haze);
        let plain: SkPaint | null = options.silhouette ? silhouettePaint : null;
        if (options.treeIds) {
          idPaint.setColor(Float32Array.of(1, 1, 1, 1));
          plain = idPaint;
        }
        canvas.concat([at.k, 0, at.sx, 0, at.k, at.sy, 0, 0, 1]);
        const pose = hikerPose(time);

        // A bone from one joint to the next, turned to lie along them and
        // stretched to `length` (1 keeps its own length).
        const bone = (shape: SkPath, from: number[], to: number[], length: number, bonePaint: SkPaint) => {
          'worklet';
          const turn = Math.atan2(to[1] - from[1], to[0] - from[0]) - Math.PI / 2;
          const cos = Math.cos(turn);
          const sin = Math.sin(turn);
          canvas.save();
          canvas.concat([cos, -sin * length, from[0], sin, cos * length, from[1], 0, 0, 1]);
          canvas.drawPath(shape, plain ?? bonePaint);
          canvas.restore();
        };
        const arm = (shoulder: number[], elbow: number[], hand: number[]) => {
          'worklet';
          bone(hiker.upperArm, shoulder, elbow, 1, jacketPaint);
          bone(hiker.forearm, elbow, hand, 1, jacketPaint);
          canvas.save();
          canvas.concat([1, 0, hand[0], 0, 1, hand[1], 0, 0, 1]);
          canvas.drawPath(hiker.hand, plain ?? skinPaint);
          canvas.restore();
        };

        // Weight shifting from foot to foot: the body leans from the hips
        // while the boots stay planted.
        const lean = (pose.sway * Math.PI) / 180;
        const cos = Math.cos(lean);
        const sin = Math.sin(lean);
        const hipY = -0.9;
        const leaned = (point: number[]) => {
          'worklet';
          const dy = point[1] - hipY;
          return [point[0] * cos - dy * sin, hipY + point[0] * sin + dy * cos];
        };

        canvas.drawPath(hiker.legs, plain ?? pantsPaint);
        canvas.drawPath(hiker.legShade, plain ?? pantsShadePaint);
        canvas.drawPath(hiker.boots, plain ?? bootPaint);

        // A trekking pole from the hand to a spot on the ground beside the
        // boots, its rounded tip just touching it.
        const holding = armJoints(HOLDING_SHOULDER, pose.holding.upper, pose.holding.fore);
        const grip = leaned([holding.hand[0] - 0.005, holding.hand[1] - 0.1]);
        const tip = [holding.hand[0] + 0.03, 0];
        const poleLength = Math.hypot(tip[0] - grip[0], tip[1] - grip[1]) - 0.01;
        bone(hiker.pole, grip, tip, poleLength, polePaint);

        canvas.save();
        canvas.concat([cos, -sin, -hipY * -sin, sin, cos, hipY - hipY * cos, 0, 0, 1]);
        canvas.drawPath(hiker.pack, plain ?? packPaint);
        canvas.drawPath(hiker.jacket, plain ?? jacketPaint);
        canvas.drawPath(hiker.plaid, plain ?? plaidPaint);
        canvas.drawPath(hiker.straps, plain ?? strapPaint);
        arm(HOLDING_SHOULDER, holding.elbow, holding.hand);

        canvas.drawPath(hiker.neck, plain ?? skinPaint);
        canvas.drawPath(hiker.head, plain ?? skinPaint);
        canvas.drawPath(hiker.beard, plain ?? beardPaint);
        canvas.drawPath(hiker.mouth, plain ?? darkPaint);
        canvas.drawPath(hiker.eyes, plain ?? darkPaint);
        canvas.drawPath(hiker.toque, plain ?? toquePaint);
        canvas.drawPath(hiker.cuff, plain ?? cuffPaint);
        canvas.drawPath(hiker.pom, plain ?? pomPaint);

        // The waving arm, in front.
        const waving = armJoints(WAVING_SHOULDER, pose.waving.upper, pose.waving.fore);
        arm(WAVING_SHOULDER, waving.elbow, waving.hand);
        canvas.restore();
      } else if (sprite.kind === SPRITE_TOWER) {
        const haze = hazeFilters[Math.round(at.haze * HAZE_LEVELS)];
        for (let p = 0; p < towerPaints.length; p++) towerPaints[p].setColorFilter(haze);
        let plain: SkPaint | null = options.silhouette ? silhouettePaint : null;
        if (options.treeIds) {
          idPaint.setColor(Float32Array.of(1, 1, 254 / 255, 1));
          plain = idPaint;
        }
        const height = sprite.size;
        const rings = ringsOf(at, height, plain);

        // Where it meets the ground: the circle round its foot, on its plaza.
        const footingColor = options.treeIds ? footingId : options.silhouette ? footingBlack : footingFill;
        rings.footing(FOOTING, footingColor, plain ?? towerShadePaint);

        // The shaft, masts and antenna: upright and round, so drawn flat,
        // facing the camera, in the tower's own units.
        canvas.save();
        canvas.concat([at.k, 0, at.sx, 0, at.k, at.sy, 0, 0, 1]);
        canvas.drawPath(towerShapes.body, plain ?? towerPaint);
        canvas.drawPath(towerShapes.lit, plain ?? towerLitPaint);
        canvas.drawPath(towerShapes.shade, plain ?? towerShadePaint);
        canvas.drawPath(towerShapes.grooves, plain ?? towerShadePaint);
        canvas.drawPath(towerShapes.upperShaft, plain ?? towerPaint);
        canvas.drawPath(towerShapes.antenna, plain ?? towerPaint);
        canvas.drawPath(towerShapes.antennaBands, plain ?? towerShadePaint);
        canvas.drawPath(towerShapes.beacon, plain ?? beaconPaint);
        canvas.restore();

        // The pods stick out sideways, so they're drawn as rings: from below
        // we see a pod's underside, more of it the closer we come, and the
        // near face of its sides.
        rings.band(POD.bottom, POD.top, towerPaint, towerShadePaint);
        rings.band(POD.windowsBottom, POD.windowsTop, glassPaint, null);
        rings.underside(POD.bottom, towerUnderPaint, towerPaint);
        rings.band(SKY_POD.bottom, SKY_POD.top, towerPaint, towerShadePaint);
        rings.underside(SKY_POD.bottom, towerUnderPaint, towerPaint);
      } else if (sprite.kind === SPRITE_LIGHTHOUSE) {
        const haze = hazeFilters[Math.round(at.haze * HAZE_LEVELS)];
        for (let p = 0; p < lighthousePaints.length; p++) lighthousePaints[p].setColorFilter(haze);
        let plain: SkPaint | null = options.silhouette ? silhouettePaint : null;
        if (options.treeIds) {
          idPaint.setColor(lighthouseId);
          plain = idPaint;
        }
        const height = sprite.size;
        const rings = ringsOf(at, height, plain);

        // Where it meets the granite.
        const footingColor = options.treeIds ? lighthouseFootingId : options.silhouette ? footingBlack : lighthouseFooting;
        rings.footing(LIGHTHOUSE_FOOTING, footingColor, plain ?? plinthPaint);

        // Seen from below, back to front. First the gallery deck's underside,
        // whose far side the shaft stands in front of.
        rings.underside(GALLERY.deck, underPaint, underPaint);

        // The shaft: upright and round, so drawn flat, facing the camera, in
        // its own units. Its door and window are on its surface, so as we
        // pass they turn with it: each is drawn where its side of the shaft
        // is from here, narrowing as it turns away, and not at all once it's
        // round the back.
        const distance = Math.hypot(at.x, at.z);
        const onShaft = (shape: SkPath, place: { height: number; facing: number }, shapePaint: SkPaint) => {
          'worklet';
          const angle = -Math.PI / 2 + place.facing;
          const toward = -(Math.cos(angle) * at.x + Math.sin(angle) * at.z) / distance;
          if (toward < 0.2) return;
          const across = (lighthouseRadius(place.height) * (Math.cos(angle) * at.z - Math.sin(angle) * at.x)) / distance;
          canvas.save();
          canvas.concat([toward, 0, across, 0, 1, -place.height, 0, 0, 1]);
          canvas.drawPath(shape, shapePaint);
          canvas.restore();
        };
        canvas.save();
        canvas.concat([at.k, 0, at.sx, 0, at.k, at.sy, 0, 0, 1]);
        canvas.drawPath(lighthouse.body, plain ?? shaftPaint);
        if (!plain) {
          canvas.drawPath(lighthouse.plinth, plinthPaint);
          onShaft(lighthouse.door, DOOR, doorPaint);
          onShaft(lighthouse.window, WINDOW, windowPaint);
        }
        canvas.restore();
        // The top of the shaft as it really curves from below, rather than
        // the flat drawing's straight edge: the near side of a short band of
        // it, traced in its own units so it takes the shaft's shading.
        const collarHeight = SHAFT.height - 0.04;
        const collar = [
          { height: collarHeight, radius: lighthouseRadius(collarHeight) },
          { height: SHAFT.height, radius: SHAFT.top },
        ];
        let top = '';
        for (let c = 0; c < 2; c++) {
          const [left, right] = rings.edges(collar[c]);
          for (let i = 0; i <= RING_STEPS; i++) {
            const angle = c === 0 ? left + ((right - left) * i) / RING_STEPS : right + ((left - right) * i) / RING_STEPS;
            const [x, y] = rings.ringPoint(collar[c], angle);
            top += (top ? 'L' : 'M') + ((x - at.sx) / at.k).toFixed(5) + ' ' + ((y - at.sy) / at.k).toFixed(5);
          }
        }
        const collarShape = Skia.Path.MakeFromSVGString(top + 'Z');
        if (collarShape) {
          canvas.save();
          canvas.concat([at.k, 0, at.sx, 0, at.k, at.sy, 0, 0, 1]);
          canvas.drawPath(collarShape, plain ?? shaftPaint);
          canvas.restore();
        }

        // Lines between two rings at angles fixed round the tower (posts,
        // glazing bars), on its near side, so they turn as we pass.
        const bars = (lower: Ring, upper: Ring, count: number, width: number) => {
          'worklet';
          if (plain) return;
          const [left, right] = rings.edges(lower);
          let d = '';
          for (let b = 0; b < count; b++) {
            let angle = (b / count) * Math.PI * 2;
            while (angle < left) angle += Math.PI * 2;
            if (angle > right) continue;
            const [x0, y0] = rings.ringPoint(lower, angle);
            const [x1, y1] = rings.ringPoint(upper, angle);
            d += 'M' + x0.toFixed(2) + ' ' + y0.toFixed(2) + 'L' + x1.toFixed(2) + ' ' + y1.toFixed(2);
          }
          const shape = d ? Skia.Path.MakeFromSVGString(d) : null;
          if (!shape) return;
          barPaint.setStrokeWidth(width * at.k);
          canvas.drawPath(shape, barPaint);
        };

        // The roof's eaves from below, behind the lantern; then the lantern
        // room, its glazing with the lamp behind it and its bars; then the
        // roof, from the eaves up to its apex.
        rings.underside(LANTERN.eaves, underPaint, underPaint);
        rings.band(LANTERN.bottom, LANTERN.top, lanternGlassPaint, null);
        if (!plain) {
          canvas.save();
          canvas.concat([at.k, 0, at.sx, 0, at.k, at.sy, 0, 0, 1]);
          canvas.drawCircle(0, -(LANTERN.bottom.height + LANTERN.top.height) / 2, 0.024, lampPaint);
          canvas.restore();
        }
        bars(LANTERN.bottom, LANTERN.top, GLAZING_BARS, 0.005);
        const [eaveLeft, eaveRight] = rings.edges(LANTERN.eaves);
        const [apexX, apexY] = rings.ringPoint({ height: LANTERN.apex, radius: 0 }, 0);
        const roof = rings.arc(LANTERN.eaves, eaveLeft, eaveRight, true) + 'L' + apexX.toFixed(2) + ' ' + apexY.toFixed(2);
        rings.fill(roof, redPaint);
        if (!plain) {
          canvas.save();
          canvas.clipRect({ x: at.sx + 0.35 * LANTERN.eaves.radius * at.k, y: -10000, width: 20000, height: 30000 }, ClipOp.Intersect, true);
          rings.fill(roof, redShadePaint);
          canvas.restore();
        }

        // In front of the lantern's foot, the gallery: its deck's edge, then
        // the railing's posts and top rail.
        rings.band(GALLERY.deck, GALLERY.deckTop, redPaint, redShadePaint);
        bars(GALLERY.deckTop, GALLERY.rail, RAIL_POSTS, 0.004);
        rings.band({ height: GALLERY.rail.height - 0.006, radius: GALLERY.rail.radius }, GALLERY.rail, redPaint, redShadePaint);

        // The ventilator ball on top, and the rod above it.
        canvas.save();
        canvas.concat([at.k, 0, at.sx, 0, at.k, at.sy, 0, 0, 1]);
        canvas.drawCircle(0, -LANTERN.ball.height, LANTERN.ball.radius, plain ?? redPaint);
        canvas.drawPath(lighthouse.rod, plain ?? underPaint);
        canvas.restore();
      } else if (sprite.kind === SPRITE_BEAR) {
        for (let p = 0; p < bearPaints.length; p++) bearPaints[p].setColorFilter(hazeFilters[Math.round(at.haze * HAZE_LEVELS)]);
        let plain: SkPaint | null = options.silhouette ? silhouettePaint : null;
        if (options.treeIds) {
          idPaint.setColor(Float32Array.of(253 / 255, 0, 1 / 255, 1));
          plain = idPaint;
        }
        canvas.concat([at.k, 0, at.sx, 0, at.k, at.sy, 0, 0, 1]);
        // It sways with its tree, about the tree's root, so it stays on the
        // trunk.
        const treeSway = ((TREE_SWAY * Math.PI) / 180) * Math.sin(time * 1.3 + BEAR_TREE.phase);
        const rootX = BEAR_TREE.x - at.x;
        const cos = Math.cos(treeSway);
        const sin = Math.sin(treeSway);
        canvas.concat([cos, -sin, rootX - cos * rootX, sin, cos, -sin * rootX, 0, 0, 1]);
        const pose = bearPose(time);
        // Up the trunk to its rump, then a slight roll against the bark.
        const roll = (pose.sway * Math.PI) / 180;
        canvas.concat([Math.cos(roll), -Math.sin(roll), 0, Math.sin(roll), Math.cos(roll), -pose.rise, 0, 0, 1]);

        const limb = (index: number, limbPaint: SkPaint) => {
          'worklet';
          const l = pose.limbs[index];
          const bones = bear.bones[index];
          const parts: [number[], number[], SkPath][] = [
            [l.pivot, l.joint, bones.upper],
            [l.joint, l.paw, bones.lower],
          ];
          for (let b = 0; b < parts.length; b++) {
            const [from, to, bone] = parts[b];
            const turn = Math.atan2(to[1] - from[1], to[0] - from[0]) - Math.PI / 2;
            canvas.save();
            canvas.concat([Math.cos(turn), -Math.sin(turn), from[0], Math.sin(turn), Math.cos(turn), from[1], 0, 0, 1]);
            canvas.drawPath(bone, plain ?? limbPaint);
            canvas.restore();
          }
          // The paw, claws into the bark.
          canvas.save();
          canvas.concat([1, 0, l.paw[0], 0, 1, l.paw[1], 0, 0, 1]);
          canvas.drawPath(bear.paw, plain ?? limbPaint);
          canvas.drawPath(bear.claws, plain ?? clawPaint);
          canvas.restore();
        };

        // Far limbs behind the body, in shadow.
        for (let l = 0; l < BEAR_LIMBS.length; l++) if (!BEAR_LIMBS[l].near) limb(l, farFurPaint);
        canvas.drawPath(bear.body, plain ?? furPaint);
        canvas.drawPath(bear.rim, plain ?? rimPaint);
        for (let l = 0; l < BEAR_LIMBS.length; l++) if (BEAR_LIMBS[l].near && !BEAR_LIMBS[l].front) limb(l, nearFurPaint);
        // The head lifts and dips with the climb, about the neck.
        const lift = (pose.lift * Math.PI) / 180;
        const hx = 0.24;
        const hy = -1.1;
        canvas.save();
        canvas.concat([Math.cos(lift), -Math.sin(lift), hx - Math.cos(lift) * hx + Math.sin(lift) * hy, Math.sin(lift), Math.cos(lift), hy - Math.sin(lift) * hx - Math.cos(lift) * hy, 0, 0, 1]);
        canvas.drawPath(bear.ears, plain ?? furPaint);
        canvas.drawPath(bear.head, plain ?? furPaint);
        canvas.drawPath(bear.muzzle, plain ?? muzzlePaint);
        canvas.drawPath(bear.nose, plain ?? bearDarkPaint);
        canvas.drawPath(bear.eye, plain ?? bearDarkPaint);
        canvas.restore();
        for (let l = 0; l < BEAR_LIMBS.length; l++) if (BEAR_LIMBS[l].near && BEAR_LIMBS[l].front) limb(l, nearFurPaint);
      }
      canvas.restore();
    }
    drawBirdsBeyond(-Infinity);
    drawSkyBeyond(-Infinity);
  };
}
