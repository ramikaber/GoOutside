import { Component, useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import * as SplashScreen from 'expo-splash-screen';

import type { IntroProps } from './intro';
import { introMarks, sinceStart } from './perf';

// Which intro plays on launch: 'video' is the pre-rendered compass
// (video-intro.tsx), 'skia' is the walk down the trail drawn live (intro.tsx).
const INTRO_KIND: 'video' | 'skia' = 'video';

// The intro is a nicety as the app starts, so nothing in it may stop the app
// from starting. If its code fails to load, or anything throws while it plays
// (rendering it, or drawing a frame on the UI thread), the error is logged and
// the intro counts as finished: the native splash comes down, onFinish takes
// it away, and the app carries on. Next launch, it's tried again.
export function SafeIntro({ onFinish }: { onFinish: () => void }) {
  const [loaded] = useState(loadIntro);
  const failed = useRef(false);
  const fail = useCallback(
    (error: unknown) => {
      if (failed.current) return;
      failed.current = true;
      console.error('Intro skipped after an error:', error);
      SplashScreen.hide();
      onFinish();
    },
    [onFinish],
  );
  useEffect(() => {
    if (!loaded.Intro) fail(loaded.error);
  }, [loaded, fail]);

  if (!loaded.Intro) return null;
  return (
    <IntroBoundary onError={fail}>
      <loaded.Intro onFinish={onFinish} onError={fail} />
    </IntroBoundary>
  );
}

type Loaded = { Intro: ComponentType<IntroProps>; error?: undefined } | { Intro?: undefined; error: unknown };

// Loads the intro's code, only when it's going to play.
//
// An error thrown while a module loads never reaches a try/catch around the
// require, nor the .catch of an import(): Metro's require catches it, reports
// it to the global error handler as fatal (a red screen in development, a
// crash in a release build) and hands back undefined. So for the moment the
// intro loads, the global handler is swapped for one that just keeps the
// error. The require is synchronous, so nothing else can report in between.
function loadIntro(): Loaded {
  introMarks.mounted = sinceStart();
  const loadingFrom = performance.now();
  const previousHandler = ErrorUtils.getGlobalHandler();
  let failure: { error: unknown } | undefined;
  ErrorUtils.setGlobalHandler((error) => {
    failure ??= { error };
  });
  let intro: { default?: unknown } | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- synchronous on purpose, as above
    intro = INTRO_KIND === 'video' ? require('./video-intro') : require('./intro');
  } catch (error) {
    failure ??= { error };
  } finally {
    ErrorUtils.setGlobalHandler(previousHandler);
    introMarks.loadMs = Math.round(performance.now() - loadingFrom);
  }
  if (failure) return failure;
  if (typeof intro?.default !== 'function') return { error: new Error("The intro's module has no default export") };
  return { Intro: intro.default as ComponentType<IntroProps> };
}

// Hands an error thrown while rendering the intro to onError, and shows
// nothing in its place, rather than taking down the app around it.
class IntroBoundary extends Component<{ onError: (error: unknown) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
