import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  Easing,
  cancelAnimation,
  useAnimatedReaction,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Fonts } from '@/constants/theme';
import { GROUND_RESOLUTIONS, IntroJourney } from './intro-journey';
import { useFrameRate } from './perf';
import { RUN_SECONDS } from './world';

const STEP = 0.25;

// Dev-only (or with EXPO_PUBLIC_INTRO_PERF=1, see perf.ts): the intro's
// world on its own, for checking each stage as it's built. Plays on a
// loop; pause to step through it a quarter second at a
// time, and turn on the grid to see the ground's world grid and the rings
// round a few trees' spots. `?t=2.5` opens frozen at that moment,
// `&debug=1` with the grid on and `&ui=0` without the controls. The line
// above the controls is the UI thread's frame rate, where the scene is drawn:
// frames per second over the last second, and the slowest frame in it; and
// the ground's resolution, which steps down if frames are slow.
export default function IntroPreviewScreen() {
  const params = useLocalSearchParams<{ t?: string; debug?: string; ui?: string }>();
  const frozenAt = params.t !== undefined ? Number(params.t) : null;
  const insets = useSafeAreaInsets();

  const time = useSharedValue(frozenAt ?? 0);
  const [playing, setPlaying] = useState(frozenAt === null);
  const [debug, setDebug] = useState(params.debug === '1');
  const [pausedAt, setPausedAt] = useState(frozenAt ?? 0);
  const frameRate = useFrameRate();
  const level = useSharedValue(0);
  const [resolution, setResolution] = useState(GROUND_RESOLUTIONS[0]);
  useAnimatedReaction(
    () => level.value,
    (value) => scheduleOnRN(setResolution, GROUND_RESOLUTIONS[value]),
  );

  useEffect(() => {
    if (!playing) return;
    time.value = 0;
    time.value = withRepeat(
      withTiming(RUN_SECONDS, { duration: RUN_SECONDS * 1000, easing: Easing.linear }),
      -1,
    );
    return () => cancelAnimation(time);
  }, [playing, time]);

  const pause = () => {
    cancelAnimation(time);
    const at = Math.round(time.value / STEP) * STEP;
    time.value = at;
    setPausedAt(at);
    setPlaying(false);
  };
  const step = (by: number) => {
    const at = Math.min(Math.max(pausedAt + by, 0), RUN_SECONDS);
    time.value = at;
    setPausedAt(at);
  };

  return (
    <View style={styles.screen}>
      <IntroJourney time={time} debug={debug} level={level} />
      {params.ui !== '0' && (
        <Text style={[styles.frameRate, { bottom: insets.bottom + 72 }]}>
          {frameRate ? `${frameRate} · ground ${resolution} px/pt` : ''}
        </Text>
      )}
      {params.ui !== '0' && (
        <View style={[styles.controls, { bottom: insets.bottom + 12 }]}>
          <Button label={playing ? 'Pause' : 'Play'} onPress={playing ? pause : () => setPlaying(true)} />
          <Button label="−¼s" onPress={() => step(-STEP)} disabled={playing} />
          <Text style={styles.time}>{playing ? 'playing' : `${pausedAt.toFixed(2)}s`}</Text>
          <Button label="+¼s" onPress={() => step(STEP)} disabled={playing} />
          <Button label={debug ? 'Grid on' : 'Grid off'} onPress={() => setDebug(!debug)} />
        </View>
      )}
    </View>
  );
}

function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.button, disabled && styles.disabled]}>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.ink },
  controls: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(46,40,18,0.78)',
  },
  button: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: Colors.parchment },
  disabled: { opacity: 0.4 },
  label: { fontFamily: Fonts.mono, fontSize: 12, color: Colors.ink },
  time: { fontFamily: Fonts.mono, fontSize: 12, color: Colors.parchment, minWidth: 56, textAlign: 'center' },
  frameRate: {
    position: 'absolute',
    left: 12,
    fontFamily: Fonts.mono,
    fontSize: 12,
    color: Colors.parchment,
    backgroundColor: 'rgba(46,40,18,0.78)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    overflow: 'hidden',
  },
});
