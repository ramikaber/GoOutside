import type { ComponentType } from 'react';
import { WithSkiaWeb } from '@shopify/react-native-skia/lib/module/web';

// The intro is mobile-only; this exists so the dev preview can also be
// checked in a browser. Skia's wasm build is fetched from a CDN rather than
// shipped in the repo. Its version must match the canvaskit-wasm that
// @shopify/react-native-skia depends on.
const CANVASKIT = 'https://cdn.jsdelivr.net/npm/canvaskit-wasm@0.41.0/bin/full';

export function SkiaGate({ getComponent }: { getComponent: () => Promise<{ default: ComponentType }> }) {
  return (
    <WithSkiaWeb
      getComponent={getComponent}
      opts={{ locateFile: (file: string) => `${CANVASKIT}/${file}` }}
    />
  );
}
