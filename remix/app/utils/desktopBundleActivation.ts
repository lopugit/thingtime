import { desktopBundleSafety, waitForDesktopUpdateWork } from './desktopBundleSafety';
import { rootIdentity } from './rootIdentity';
import type { ThingtimeDesktopBridge } from './electronBridge';

export const DESKTOP_BUNDLE_ACTIVATION_REQUIREMENTS = { 'native.web-bundle-activation': '1.0.0' } as const;
const compatible = (version?: string) => typeof version === 'string' && /^1\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version);

/** Fail closed for an unknown editor. Explicit participants cover volatile
 * Messenger drafts, voice work, and fulfilled local Thingtime persistence.
 * Other mounted editors/forms keep the release pending rather than asserting
 * that their React/Editor.js state was saved by the tree flush. */
export function hasUnknownDesktopDraft(document: Document) {
  if (document.querySelector('[contenteditable="true"], .monaco-editor, .codex-editor, [role="dialog"], [aria-busy="true"]')) return true;
  if ([...document.querySelectorAll('audio, video')].some(element => {
    const media = element as HTMLMediaElement;
    return !media.paused && !media.ended;
  })) return true;
  return [...document.querySelectorAll('textarea, input')].some(element => {
    const input = element as HTMLInputElement;
    return !['button', 'submit', 'reset', 'hidden', 'checkbox', 'radio'].includes(input.type) && Boolean(input.value);
  });
}
export function watchDesktopBundleActivation({ bridge, router, isHealthy, document: doc = document, window: win = window,
  idleMs = 30000 }: {
  bridge: ThingtimeDesktopBridge | null | undefined;
  router: { state: { initialized: boolean; navigation: { state: string }; errors: unknown }; subscribe: (fn: () => void) => () => void };
  isHealthy: () => boolean; document?: Document; window?: Window; idleMs?: number;
}) {
  if (!bridge || !compatible(bridge.bundleActivationVersion) || !bridge.onBundleActivation || !bridge.bundleActivationCheckpoint || !bridge.setBundleUpdatePolicy) return () => {};
  let disposed = false, lastActivity = Date.now(), controller: AbortController | null = null;
  let nonce: string | null = null, valid: (() => boolean) | null = null, closing = false;
  const cancel = () => {
    lastActivity = Date.now(); controller?.abort(); valid = null;
    if (nonce) void bridge.bundleActivationCheckpoint!({ nonce, ready: false }).catch(() => {});
  };
  const dirtyControls = new Set<Element>();
  const edited = (event: Event) => {
    for (const element of dirtyControls) if (!element.isConnected) dirtyControls.delete(element);
    if (event.target instanceof Element && event.target.matches('input, textarea, select, [contenteditable="true"]')) dirtyControls.add(event.target);
    cancel();
  };
  const ready = () => !disposed && !doc.hasFocus() && Date.now() - lastActivity >= idleMs && isHealthy() &&
    !rootIdentity.read().pending && router.state.initialized && router.state.navigation.state === 'idle' &&
    (!router.state.errors || Object.keys(router.state.errors).length === 0) && !hasUnknownDesktopDraft(doc) && ![...dirtyControls].some(element => element.isConnected);
  const beforeUnload = (event: BeforeUnloadEvent) => {
    // This is only a final race veto; it is never the durability certificate.
    if (closing && (!valid || !ready() || !valid())) { event.preventDefault(); event.returnValue = ''; }
  };
  const unsubscribe = bridge.onBundleActivation(message => {
    if (message.type === 'release') { if (nonce === message.nonce) { controller?.abort(); valid = null; closing = message.keepVeto === true; if (!closing) nonce = null; } return; }
    if (message.type !== 'prepare' || !/^[a-f0-9-]{36}$/i.test(message.nonce)) return;
    const idleSince = lastActivity;
    cancel(); nonce = message.nonce; closing = true;
    const expected = nonce, identity = rootIdentity.read().generation;
    // Do not reset the already observed idle interval merely for a request.
    lastActivity = idleSince;
    controller = new AbortController();
    const signal = controller.signal;
    void (async () => {
      try {
        if (!ready()) throw Error('Renderer is busy');
        const info = await waitForDesktopUpdateWork(bridge.getInfo!(), signal);
        const feature = info.nativeFeatures?.features?.['native.web-bundle-activation'];
        if (info.nativeFeatures?.origin !== win.location.origin || !compatible(feature?.version) || !info.sessionHash) throw Error('Unsupported desktop host');
        valid = await desktopBundleSafety.checkpoint(signal, info.sessionHash);
        if (!ready() || identity !== rootIdentity.read().generation || signal.aborted || nonce !== expected || !valid()) throw Error('Renderer changed');
        await bridge.bundleActivationCheckpoint!({ nonce: expected, ready: true });
      } catch { if (nonce === expected) { valid = null; await bridge.bundleActivationCheckpoint!({ nonce: expected, ready: false }).catch(() => {}); } }
    })();
  });
  const events = ['pointerdown', 'keydown', 'beforeinput', 'input', 'change', 'focus', 'pagehide'] as const;
  for (const event of events) win.addEventListener(event, cancel, true);
  win.addEventListener('beforeunload', beforeUnload);
  win.addEventListener('input', edited, true); win.addEventListener('change', edited, true);
  const offRouter = router.subscribe(cancel), offIdentity = rootIdentity.subscribe(cancel), offSafety = desktopBundleSafety.subscribe(cancel);
  const observer = new MutationObserver(() => { if (nonce) cancel(); });
  observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true, attributes: true });
  let enabled: boolean | undefined;
  let policyRequest: Promise<void> | null = null;
  const refreshPolicy = () => {
    if (policyRequest) return policyRequest;
    policyRequest = (async () => {
    try {
      const info = await bridge.getInfo!();
      if (disposed || info.nativeFeatures?.origin !== win.location.origin ||
        !compatible(info.nativeFeatures?.features?.['native.web-bundle-activation']?.version)) return;
      const next = !rootIdentity.read().pending && desktopBundleSafety.automaticUpdatesEnabled(info.sessionHash || '');
      enabled = next; await bridge.setBundleUpdatePolicy!({ enabled });
    } catch { /* Older/unresponsive bridge leaves download and activation pending. */ }
    })().finally(() => { policyRequest = null; });
    return policyRequest;
  };
  const timer = win.setInterval(() => { void refreshPolicy(); }, 5000);
  void refreshPolicy();
  return () => {
    disposed = true; cancel(); observer.disconnect(); win.clearInterval(timer); unsubscribe(); offRouter(); offIdentity(); offSafety();
    for (const event of events) win.removeEventListener(event, cancel, true);
    win.removeEventListener('beforeunload', beforeUnload);
    win.removeEventListener('input', edited, true); win.removeEventListener('change', edited, true);
  };
}
