import { Suspense, lazy, useState, type ComponentType } from 'react';

// Renders a component that uses Skia, loading its module on first render.
// On native Skia is ready immediately; skia-gate.web.tsx waits for it to
// load in the browser first.
export function SkiaGate({ getComponent }: { getComponent: () => Promise<{ default: ComponentType }> }) {
  const [Inner] = useState(() => lazy(getComponent));
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
