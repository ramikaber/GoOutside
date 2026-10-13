import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useVideoPlayer, VideoView } from 'expo-video';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Fonts } from '@/constants/theme';
import type { IntroProps } from './intro';

// The compass intro: a pre-rendered video (assets/intro/intro.mp4, silent)
// with its sound as a separate file (assets/intro/intro-sound.m4a), so the
// sound follows the phone's silent switch while the picture always plays.
// Made with tools/intro-video (see its README). It ends looking straight
// down at the dial; just before, it grows and fades into the app as if the
// camera dived on through the dial.

const VIDEO = require('@/assets/intro/intro.mp4');
const SOUND = require('@/assets/intro/intro-sound.m4a');

// The hand-off into the app. It starts while the camera is still diving
// into the dial (at this point in the video, s), so the dive carries on
// straight into the app with no stop: the picture keeps growing, faster and
// faster, and fades out late, over HANDOFF_MS. The video's own last 0.8 s
// (the dive slowing down, then a held frame) is never seen.
const HANDOFF_AT_S = 6.6;
const HANDOFF_MS = 650;
const HANDOFF_SCALE = 1.6;
// A skip fades out this fast, ms.
const SKIP_FADE_MS = 300;
// With Reduce Motion on there's no video: just this fade onto the app, ms.
const REDUCED_MOTION_FADE_MS = 350;
// Watchdogs, both errors (so SafeIntro logs it and takes the intro away): the
// first frame isn't on screen this long after the intro mounts, or the intro
// hasn't ended this long after it started.
const FIRST_FRAME_TIMEOUT_MS = 3000;
const MAX_RUN_MS = 9000;
// The sound plays alongside other apps' audio, stays quiet when the phone is
// on silent, and never plays in the background.
const SOUND_MODE = { playsInSilentMode: false, interruptionMode: 'mixWithOthers', shouldPlayInBackground: false } as const;
// How long the sound waits after the video starts before starting too, in
// step with the picture, ms. Nothing is heard before 0.42 s. See below.
const SOUND_SETTLE_MS = 100;

export default function VideoIntro({ onFinish, onError }: IntroProps) {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const [started, setStarted] = useState(false);
  const fade = useSharedValue(1);
  const scale = useSharedValue(1);

  const done = useRef(false);
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onFinish();
  }, [onFinish]);

  // The video is silent, and mixes with other apps' audio (on iOS a player
  // otherwise pauses them, even when it's muted).
  const player = useVideoPlayer(reduceMotion ? null : VIDEO, (p) => {
    p.muted = true;
    p.loop = false;
    p.audioMixingMode = 'mixWithOthers';
    // Reports the playing position every 50 ms, to start the hand-off on time.
    p.timeUpdateEventInterval = 0.05;
  });

  const sound = useRef<AudioPlayer | null>(null);
  useEffect(() => {
    if (reduceMotion) return;
    try {
      sound.current = createAudioPlayer(SOUND);
    } catch (error) {
      // No sound is fine; the intro still plays.
      console.warn('Intro sound unavailable:', error);
    }
    return () => {
      sound.current?.remove();
      sound.current = null;
    };
  }, [reduceMotion]);

  // Set once the intro starts to go (it ended, was skipped, or Reduce Motion).
  const leaving = useRef(false);
  const leave = useCallback(
    (ms: number, grow: boolean) => {
      if (done.current || leaving.current) return;
      leaving.current = true;
      const end = (finished?: boolean) => {
        'worklet';
        if (finished) scheduleOnRN(finish);
      };
      // Into the app: the fade holds off, then goes, while the growth speeds
      // up (both ease in). A skip just fades, fast at first.
      fade.set(withTiming(0, { duration: ms, easing: grow ? Easing.in(Easing.quad) : Easing.out(Easing.cubic) }, end));
      if (grow) scale.set(withTiming(HANDOFF_SCALE, { duration: ms, easing: Easing.in(Easing.cubic) }));
    },
    [fade, scale, finish],
  );

  // The video starts once it's ready to play, and the sound follows it.
  useEffect(() => {
    if (reduceMotion) return;
    const start = () => {
      if (!leaving.current) player.play();
    };
    const status = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'readyToPlay') start();
      else if (status === 'error') onError?.(new Error(error?.message ?? "The intro video couldn't play"));
    });
    const timeUpdate = player.addListener('timeUpdate', ({ currentTime }) => {
      if (currentTime >= HANDOFF_AT_S) leave(HANDOFF_MS, true);
    });
    // In case the time updates miss it, the end of the video starts it too.
    const ended = player.addListener('playToEnd', () => leave(HANDOFF_MS, true));
    // It may have been ready before anything was listening.
    if (player.status === 'readyToPlay') start();
    return () => {
      status.remove();
      timeUpdate.remove();
      ended.remove();
    };
  }, [player, reduceMotion, leave, onError]);

  // The sound starts each time the video starts playing, at the point the
  // picture is at, and pauses when it stops. It can't simply start with it:
  // on iOS, whenever a video starts or stops, expo-video switches the app's
  // audio session to its own mode (which ignores the silent switch), a few ms
  // later on another thread. So the sound waits a moment, puts its own mode
  // back, then starts.
  useEffect(() => {
    if (reduceMotion) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const playing = player.addListener('playingChange', ({ isPlaying }) => {
      clearTimeout(timer);
      const audio = sound.current;
      if (!audio) return;
      if (!isPlaying) {
        audio.pause();
        return;
      }
      timer = setTimeout(async () => {
        try {
          await setAudioModeAsync(SOUND_MODE);
          await audio.seekTo(player.currentTime);
          if (player.playing && !leaving.current) audio.play();
        } catch (error) {
          console.warn('Intro sound unavailable:', error);
        }
      }, SOUND_SETTLE_MS);
    });
    return () => {
      clearTimeout(timer);
      playing.remove();
    };
  }, [player, reduceMotion]);

  // The native splash comes down once the video's first frame is on screen.
  const onFirstFrame = useCallback(() => {
    if (started) return;
    SplashScreen.hide();
    setStarted(true);
  }, [started]);

  useEffect(() => {
    if (reduceMotion || started) return;
    const timer = setTimeout(() => onError?.(new Error("The intro's first frame wasn't shown in time")), FIRST_FRAME_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [reduceMotion, started, onError]);

  useEffect(() => {
    if (!started) return;
    const timer = setTimeout(() => {
      if (!leaving.current) onError?.(new Error(`The intro hadn't ended ${MAX_RUN_MS / 1000} s after it started`));
    }, MAX_RUN_MS);
    return () => clearTimeout(timer);
  }, [started, onError]);

  const skip = useCallback(() => {
    if (!started || done.current) return;
    player.pause();
    sound.current?.pause();
    leave(SKIP_FADE_MS, false);
  }, [started, player, leave]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  const videoStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  if (reduceMotion) {
    return (
      <Animated.View
        style={[styles.overlay, overlayStyle]}
        onLayout={() => {
          SplashScreen.hide();
          setStarted(true);
          leave(REDUCED_MOTION_FADE_MS, false);
        }}
      />
    );
  }

  return (
    <Animated.View style={[styles.overlay, styles.dark, overlayStyle]}>
      <Animated.View style={[StyleSheet.absoluteFill, videoStyle]}>
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
          fullscreenOptions={{ enable: false }}
          allowsPictureInPicture={false}
          // Android: a TextureView, so the fade and grow at the end apply to
          // the video too (the default SurfaceView ignores its parents').
          surfaceType="textureView"
          onFirstFrameRender={onFirstFrame}
        />
      </Animated.View>
      <Pressable style={StyleSheet.absoluteFill} onPress={skip} accessibilityRole="button" accessibilityLabel="Skip the intro" />
      <Pressable
        onPress={skip}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Skip the intro"
        style={({ pressed }) => [styles.skip, { top: insets.top + 10, opacity: pressed ? 0.7 : 1 }]}>
        <Text style={styles.skipText}>Skip</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
    overflow: 'hidden',
    backgroundColor: Colors.parchment,
  },
  // Behind the video while it loads: the dark of the desk in its first frame.
  dark: { backgroundColor: '#2A1D14' },
  skip: {
    position: 'absolute',
    right: 16,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(46, 40, 18, 0.45)',
  },
  skipText: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: Colors.parchment,
  },
});
