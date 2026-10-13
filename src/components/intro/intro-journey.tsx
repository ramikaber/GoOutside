import { PixelRatio, StyleSheet, useWindowDimensions } from 'react-native';
import { Canvas, Picture, Skia, createPicture } from '@shopify/react-native-skia';
import { useDerivedValue, useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { createScene } from './scene';

// Built once: every path, paint and the ground shader.
const drawScene = createScene(Skia);

// The ground and sky's resolution, pixels per point, best first (never more
// than the screen's own). Their shader is most of the GPU's work, and the
// ground is smoothed to about a point anyway, so half a 3x screen's
// resolution hardly shows. On a phone that can't keep up, the intro steps
// down through the rest.
export const GROUND_RESOLUTIONS = [1.5, 1.125, 0.75];

// Stepping down: once the walk is under way, and again after each step,
// frames are timed in windows of this many; a window averaging slower than
// this, ms (about 50 fps), steps down one.
const WINDOW = 12;
const SETTLE = 10;
const SLOW_FRAME_MS = 20;

// Moments drawn once, offscreen and at full size, before the first frame,
// so every shader and kind of drawing is prepared (compiled) while the
// native splash is still up rather than as it first appears: the forest
// and deer, the falls, tower and bear, the bridge and stream, the
// skywriting and plane, the compass.
const WARM_UP_AT = [0.5, 2.6, 4.3, 5.0, 6.2];

// The intro's world, drawn full-screen at `time` seconds into the walk.
// Each frame is recorded on the UI thread straight from the shared value,
// so nothing re-renders in React while it plays. `onReady` is called once
// the first frame has been drawn, `level` (if given) follows the ground's
// resolution as an index into GROUND_RESOLUTIONS.
//
// An error drawing a frame is thrown on the UI thread, where it never reaches
// React and is fatal. Given onError, drawing stops at the first one and it's
// handed over instead.
export function IntroJourney({
  time,
  debug = false,
  onError,
  onReady,
  level: levelProp,
}: {
  time: SharedValue<number>;
  debug?: boolean;
  onError?: (message: string) => void;
  onReady?: () => void;
  level?: SharedValue<number>;
}) {
  const { width, height } = useWindowDimensions();
  const pixelRatio = PixelRatio.get();
  const ownLevel = useSharedValue(0);
  const level = levelProp ?? ownLevel;
  const failed = useSharedValue(false);
  const ready = useSharedValue(false);

  const frames = useSharedValue(0);
  const total = useSharedValue(0);
  const settle = useSharedValue(SETTLE);
  useFrameCallback(({ timeSincePreviousFrame: interval }) => {
    if (interval === null || !ready.value || time.value <= 0) return;
    if (settle.value > 0) {
      settle.value -= 1;
      return;
    }
    frames.value += 1;
    total.value += interval;
    if (frames.value < WINDOW) return;
    const mean = total.value / frames.value;
    frames.value = 0;
    total.value = 0;
    if (mean > SLOW_FRAME_MS && level.get() < GROUND_RESOLUTIONS.length - 1) {
      level.set(level.get() + 1);
      settle.value = SETTLE;
    }
  });

  const warmUp = (groundResolution: number) => {
    'worklet';
    const surface = Skia.Surface.MakeOffscreen(Math.ceil(width * pixelRatio), Math.ceil(height * pixelRatio));
    if (!surface) return;
    const target = surface.getCanvas();
    target.scale(pixelRatio, pixelRatio);
    for (let i = 0; i < WARM_UP_AT.length; i++) drawScene(target, WARM_UP_AT[i], width, height, { groundResolution });
    surface.flush();
    surface.dispose();
  };

  const picture = useDerivedValue(() =>
    createPicture((canvas) => {
      // useDerivedValue works out its first value on the JS thread, as this
      // renders; the scene is only ever drawn on the UI thread.
      if (!(globalThis as { _WORKLET?: boolean })._WORKLET || failed.value) return;
      const groundResolution = Math.min(GROUND_RESOLUTIONS[level.get()], pixelRatio);
      try {
        if (!ready.value) warmUp(groundResolution);
        drawScene(canvas, time.value, width, height, { debug, groundResolution });
        if (!ready.value) {
          ready.value = true;
          if (onReady) scheduleOnRN(onReady);
        }
      } catch (error) {
        if (!onError) throw error;
        failed.value = true;
        scheduleOnRN(onError, error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error));
      }
    }),
  );
  return (
    <Canvas style={StyleSheet.absoluteFill}>
      <Picture picture={picture} />
    </Canvas>
  );
}
