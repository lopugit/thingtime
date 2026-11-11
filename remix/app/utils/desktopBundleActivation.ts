import { desktopBundleSafety, waitForDesktopUpdateWork } from './desktopBundleSafety';
import { rootIdentity } from './rootIdentity';
import type { DesktopBundleCheckpointReason, ThingtimeDesktopBridge } from './electronBridge';

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
  let diagnosticReasonsEnabled = false, cancellationReason: DesktopBundleCheckpointReason | null = null;
  const sendCheckpoint = (expected: string, ready: boolean, reason: DesktopBundleCheckpointReason) =>
    bridge.bundleActivationCheckpoint!({ nonce: expected, ready, ...(diagnosticReasonsEnabled ? { reason } : {}) });
  const cancel = (reason: DesktopBundleCheckpointReason = 'cancel-input') => {
    cancellationReason = reason;
    lastActivity = Date.now(); controller?.abort(); valid = null;
    if (nonce) void sendCheckpoint(nonce, false, reason).catch(() => {});
  };
  const dirtyControls = new Set<Element>();
  const edited = (event: Event) => {
    for (const element of dirtyControls) if (!element.isConnected) dirtyControls.delete(element);
    if (event.target instanceof Element && event.target.matches('input, textarea, select, [contenteditable="true"]')) dirtyControls.add(event.target);
    cancel();
  };
  const readinessReason = (): DesktopBundleCheckpointReason | null => {
    if (disposed) return 'renderer-disposed';
    if (doc.hasFocus()) return 'renderer-focused';
    if (!(Date.now() - lastActivity >= idleMs)) return 'renderer-recent-activity';
    if (!isHealthy()) return 'renderer-unhealthy';
    if (rootIdentity.read().pending) return 'identity-pending';
    if (!router.state.initialized || router.state.navigation.state !== 'idle' || (router.state.errors && Object.keys(router.state.errors).length)) return 'router-unready';
    if (hasUnknownDesktopDraft(doc)) return 'unknown-draft';
    if ([...dirtyControls].some(element => element.isConnected)) return 'dirty-control';
    return null;
  };
  const ready = () => { try { return readinessReason() === null; } catch { return false; } };
  const beforeUnload = (event: BeforeUnloadEvent) => {
    // This is only a final race veto; it is never the durability certificate.
    if (closing && (!valid || !ready() || !valid())) { event.preventDefault(); event.returnValue = ''; }
  };
  const unsubscribe = bridge.onBundleActivation(message => {
    if (message.type === 'release') { if (nonce === message.nonce) { controller?.abort(); valid = null; closing = message.keepVeto === true; if (!closing) nonce = null; } return; }
    if (message.type !== 'prepare' || !/^[a-f0-9-]{36}$/i.test(message.nonce)) return;
    const idleSince = lastActivity;
    cancel('checkpoint-invalidated'); nonce = message.nonce; closing = true; cancellationReason = null;
    const expected = nonce, identity = rootIdentity.read().generation;
    // Do not reset the already observed idle interval merely for a request.
    lastActivity = idleSince;
    controller = new AbortController();
    const signal = controller.signal;
    let refusal: DesktopBundleCheckpointReason = 'readiness-unavailable';
    void (async () => {
      try {
        const preflight = readinessReason();
        if (preflight) { refusal = preflight; throw Error('Renderer is busy'); }
        refusal = 'host-unsupported';
        const info = await waitForDesktopUpdateWork(bridge.getInfo!(), signal);
        const feature = info.nativeFeatures?.features?.['native.web-bundle-activation'];
        if (info.nativeFeatures?.origin !== win.location.origin || !compatible(feature?.version) || !info.sessionHash) throw Error('Unsupported desktop host');
        valid = await desktopBundleSafety.checkpoint(signal, info.sessionHash, reason => { refusal = reason; });
        const finalReadiness = readinessReason();
        refusal = finalReadiness || 'checkpoint-invalidated';
        if (finalReadiness || identity !== rootIdentity.read().generation || signal.aborted || nonce !== expected || !valid()) throw Error('Renderer changed');
        await sendCheckpoint(expected, true, 'renderer-ready');
      } catch { if (nonce === expected) { valid = null; await sendCheckpoint(expected, false, cancellationReason || refusal).catch(() => {}); } }
    })();
  });
  const events = ['pointerdown', 'keydown', 'beforeinput', 'input', 'change', 'focus', 'pagehide'] as const;
  const activity = (event: Event) => cancel(event.type === 'focus' ? 'cancel-focus' : event.type === 'pagehide' ? 'cancel-pagehide' : 'cancel-input');
  for (const event of events) win.addEventListener(event, activity, true);
  win.addEventListener('beforeunload', beforeUnload);
  win.addEventListener('input', edited, true); win.addEventListener('change', edited, true);
  const offRouter = router.subscribe(() => cancel('cancel-router')), offIdentity = rootIdentity.subscribe(() => cancel('cancel-identity')), offSafety = desktopBundleSafety.subscribe(() => cancel('cancel-safety'));
  const observer = new MutationObserver(() => { if (nonce) cancel('cancel-dom'); });
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
      diagnosticReasonsEnabled = Number(info.nativeFeatures.features['native.web-bundle-activation'].version.split('.')[1]) >= 3;
      const next = !rootIdentity.read().pending && desktopBundleSafety.automaticUpdatesEnabled(info.sessionHash || '');
      enabled = next; await bridge.setBundleUpdatePolicy!({ enabled });
    } catch { /* Older/unresponsive bridge leaves download and activation pending. */ }
    })().finally(() => { policyRequest = null; });
    return policyRequest;
  };
  const timer = win.setInterval(() => { void refreshPolicy(); }, 5000);
  void refreshPolicy();
  return () => {
    disposed = true; cancel('cancel-dispose'); observer.disconnect(); win.clearInterval(timer); unsubscribe(); offRouter(); offIdentity(); offSafety();
    for (const event of events) win.removeEventListener(event, activity, true);
    win.removeEventListener('beforeunload', beforeUnload);
    win.removeEventListener('input', edited, true); win.removeEventListener('change', edited, true);
  };
}
