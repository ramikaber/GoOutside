import { useState } from 'react';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

// For measuring the intro on a phone. Set EXPO_PUBLIC_INTRO_PERF=1 when
// starting the server (it's built into the bundle) and the intro shows its
// frame rate, the ground's resolution and how long it took to start, and the
// /intro-preview screen opens outside development builds too.
export const INTRO_PERF = process.env.EXPO_PUBLIC_INTRO_PERF === '1';

// How the intro's start went, ms after this module loaded, which is as the
// app's JavaScript starts (the root layout imports it, through safe-intro).
export const introMarks: {
  jsStart: number;
  // The intro mounted, once the app's fonts were in.
  mounted?: number;
  // How long loading its code took.
  loadMs?: number;
  // Its first frame was drawn on the UI thread (shaders warmed up first).
  firstFrame?: number;
} = { jsStart: performance.now() };

export const sinceStart = () => Math.round(performance.now() - introMarks.jsStart);

// Frames per second on the UI thread, where the scene is drawn, over the
// last second, and the slowest frame in it, as a line of text.
export function useFrameRate(): string {
  const [text, setText] = useState('');
  const frames = useSharedValue(0);
  const elapsed = useSharedValue(0);
  const slowest = useSharedValue(0);
  useFrameCallback(({ timeSincePreviousFrame: interval }) => {
    if (interval === null) return;
    frames.value += 1;
    elapsed.value += interval;
    slowest.value = Math.max(slowest.value, interval);
    if (elapsed.value < 1000) return;
    const rate = `${Math.round((frames.value * 1000) / elapsed.value)} fps · slowest frame ${Math.round(slowest.value)} ms`;
    scheduleOnRN(setText, rate);
    frames.value = 0;
    elapsed.value = 0;
    slowest.value = 0;
  });
  return text;
}
