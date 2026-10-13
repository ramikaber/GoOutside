import { Redirect } from 'expo-router';

import { INTRO_PERF } from '@/components/intro/perf';
import { SkiaGate } from '@/components/intro/skia-gate';

// Dev-only: the intro's world with playback controls, for checking each
// stage as it's built. Not reachable from the app's UI; open /intro-preview.
// Also opens outside development builds with EXPO_PUBLIC_INTRO_PERF=1, to
// measure the frame rate there (see perf.ts).
export default function IntroPreviewRoute() {
  if (!__DEV__ && !INTRO_PERF) return <Redirect href="/" />;
  return <SkiaGate getComponent={() => import('@/components/intro/intro-preview-screen')} />;
}
