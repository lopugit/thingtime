type ReadyRouter = {
  state: { initialized: boolean; navigation: { state: string }; errors: unknown };
  subscribe: (listener: () => void) => () => void;
};

// React Router records render exceptions in its component error boundary, not
// necessarily router.state.errors. Keep its onError signal as a separate veto.
export function createDesktopRendererBootHealth() {
  let failed = false;
  return { isHealthy: () => !failed, onError: () => { failed = true; } };
}

/** A loaded HTML document is not a successfully committed application. */
export function watchDesktopRendererReady({
  router, root, bridge, isHealthy = () => true, requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame, onError = () => console.warn('Desktop startup acknowledgment failed.')
}: {
  router: ReadyRouter;
  root: Pick<HTMLElement, 'childElementCount'>;
  bridge: { rendererReady?: () => Promise<boolean> } | null | undefined;
  isHealthy?: () => boolean;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
  onError?: () => void;
}) {
  if (!bridge?.rendererReady) return () => {};
  let closed = false, sent = false;
  let frame: number | undefined;
  const ready = () => isHealthy() && router.state.initialized && router.state.navigation.state === 'idle' &&
    (!router.state.errors || Object.keys(router.state.errors).length === 0);
  const cancel = () => { if (frame !== undefined) cancelFrame(frame); frame = undefined; };
  const schedule = () => {
    cancel();
    if (closed || sent || !ready()) return;
    frame = requestFrame(() => {
      frame = requestFrame(() => {
        frame = undefined;
        if (closed || sent || !ready() || root.childElementCount === 0) return;
        sent = true;
        void Promise.resolve().then(() => { if (!closed) return bridge.rendererReady!(); }).catch(onError);
      });
    });
  };
  const unsubscribe = router.subscribe(schedule);
  schedule();
  return () => { closed = true; cancel(); unsubscribe(); };
}
