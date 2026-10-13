import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Fonts } from '@/constants/theme';
import { HANDOFF_FROM } from './compass';
import { GROUND_RESOLUTIONS, IntroJourney } from './intro-journey';
import { INTRO_PERF, introMarks, sinceStart, useFrameRate } from './perf';
import { RUN_SECONDS } from './world';

// A skip fades the intro out this fast, ms.
const SKIP_FADE_MS = 300;
// With Reduce Motion on there's no journey: just this fade onto the app, ms.
const REDUCED_MOTION_FADE_MS = 350;
// If the first frame hasn't been drawn this long after the intro is on
// screen, something's wrong: it's given up on, ms.
const FIRST_FRAME_TIMEOUT_MS = 8000;

// The intro, over the app as it loads underneath: the walk down the trail,
// the skywriting and the compass, then a fade onto the app while the compass
// is still turning. Tap anywhere, or Skip, to fade straight to the app.
// It hides the native splash, and the walk starts, once its first frame has
// been drawn (with every shader prepared first, behind the splash), and it
// calls onFinish once it's gone, when the caller unmounts it. A frame that
// fails to draw goes to onError (see safe-intro.tsx, which loads this).
export type IntroProps = { onFinish: () => void; onError?: (error: unknown) => void };

export default function Intro({ onFinish, onError }: IntroProps) {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const [started, setStarted] = useState(false);
  const time = useSharedValue(0);
  // On top of the hand-off at the end: 1, or fading for a skip.
  const fade = useSharedValue(1);
  // The ground's resolution, as an index into GROUND_RESOLUTIONS: stepped
  // down by the journey on a phone that can't keep up.
  const level = useSharedValue(0);

  const done = useRef(false);
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onFinish();
  }, [onFinish]);

  // The walk starts with its first frame on screen (or straight away with
  // Reduce Motion on, when there's no walk to draw).
  const [laidOut, setLaidOut] = useState(false);
  const start = useCallback(() => {
    if (introMarks.firstFrame === undefined) introMarks.firstFrame = sinceStart();
    SplashScreen.hide();
    setStarted(true);
  }, []);
  useEffect(() => {
    if (!laidOut || started) return;
    const timer = setTimeout(() => onError?.(new Error("The intro's first frame wasn't drawn in time")), FIRST_FRAME_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [laidOut, started, onError]);

  useEffect(() => {
    if (!started) return;
    const end = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(finish);
    };
    if (reduceMotion) {
      fade.value = withTiming(0, { duration: REDUCED_MOTION_FADE_MS }, end);
      return;
    }
    time.value = withTiming(RUN_SECONDS, { duration: RUN_SECONDS * 1000, easing: Easing.linear }, end);
  }, [started, reduceMotion, finish, time, fade]);

  const skip = useCallback(() => {
    if (!started || done.current) return;
    cancelAnimation(time);
    fade.value = withTiming(0, { duration: SKIP_FADE_MS }, (finished) => {
      'worklet';
      if (finished) scheduleOnRN(finish);
    });
  }, [started, time, fade, finish]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: fade.value * (reduceMotion ? 1 : interpolate(time.value, [HANDOFF_FROM, RUN_SECONDS], [1, 0], 'clamp')),
  }));

  return (
    <Animated.View
      style={[styles.overlay, overlayStyle]}
      onLayout={() => {
        if (reduceMotion) start();
        setLaidOut(true);
      }}>
      {!reduceMotion && <IntroJourney time={time} onError={onError} onReady={start} level={level} />}
      <Pressable style={StyleSheet.absoluteFill} onPress={skip} accessibilityRole="button" accessibilityLabel="Skip the intro" />
      {!reduceMotion && (
        <Pressable
          onPress={skip}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Skip the intro"
          style={({ pressed }) => [styles.skip, { top: insets.top + 10, opacity: pressed ? 0.7 : 1 }]}>
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      )}
      {INTRO_PERF && <PerfReadout level={level} bottom={insets.bottom + 12} />}
    </Animated.View>
  );
}

// Over the intro when measuring it (see perf.ts): its frame rate, the
// ground's resolution, and how its start went.
function PerfReadout({ level, bottom }: { level: SharedValue<number>; bottom: number }) {
  const frameRate = useFrameRate();
  const [resolution, setResolution] = useState(GROUND_RESOLUTIONS[0]);
  useAnimatedReaction(
    () => level.value,
    (value) => scheduleOnRN(setResolution, GROUND_RESOLUTIONS[value]),
  );
  const { mounted, loadMs, firstFrame } = introMarks;
  return (
    <Text pointerEvents="none" style={[styles.perf, { bottom }]}>
      {`${frameRate || 'measuring…'} · ground ${resolution} px/pt\n` +
        `mounted ${mounted ?? '?'} ms after JS start · code loaded in ${loadMs ?? '?'} ms · walk started ${firstFrame ?? '?'} ms`}
    </Text>
  );
}

const styles = StyleSheet.create({
  perf: {
    position: 'absolute',
    left: 12,
    right: 12,
    fontFamily: Fonts.mono,
    fontSize: 11,
    color: Colors.parchment,
    backgroundColor: 'rgba(46,40,18,0.78)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    overflow: 'hidden',
  },
  // Parchment underneath: all there is with Reduce Motion on.
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
    overflow: 'hidden',
    backgroundColor: Colors.parchment,
  },
  skip: {
    position: 'absolute',
    right: 16,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(46, 40, 18, 0.35)',
  },
  skipText: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: Colors.parchment,
  },
});
