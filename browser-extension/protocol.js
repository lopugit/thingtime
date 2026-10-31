export const DEFAULT_ORIGIN = 'https://thingtime.com';
export const VERSION = 1;
export const PROVIDER_PATH = '/passwords/provider';
export function safeOrigin(value) {
  try {
    const u = new URL(value);
    if (u.username || u.password || !['https:', 'http:'].includes(u.protocol)) return null;
    if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) return null;
    return u.origin;
  } catch { return null; }
}
export function providerOrigin(value) {
  const origin = safeOrigin(value);
  if (!origin) throw new Error('Use an HTTPS origin or an explicit localhost development origin.');
  const u = new URL(value);
  if (u.pathname !== '/' || u.search || u.hash) throw new Error('Enter an origin without a path, query or fragment.');
  return origin;
}
export function senderOrigin(sender) {
  if (!sender.tab || sender.frameId !== 0 || !sender.documentId) return null;
  const origin = safeOrigin(sender.url);
  return origin && origin === safeOrigin(sender.tab.url) && sender.origin === origin ? origin : null;
}
export function matchesDocument(request, sender, provider = false) {
  return sender.frameId === 0 && sender.tab?.id === (provider ? request.providerTabId : request.tabId)
    && sender.documentId === (provider ? request.providerDocumentId : request.documentId)
    && senderOrigin(sender) === (provider ? request.providerOrigin : request.origin);
}
export function validRequest(message) {
  return message?.version === VERSION && typeof message.id === 'string'
    && /^[a-f0-9-]{36}$/.test(message.id) && ['create', 'get'].includes(message.type)
    && message.publicKey && typeof message.publicKey === 'object'
    && typeof message.publicKey.challenge === 'string';
}
export function safeError(error, fallback = 'The passkey request could not complete.') {
  const names = ['AbortError', 'NotAllowedError', 'NotSupportedError', 'SecurityError', 'InvalidStateError', 'ConstraintError'];
  return {name: names.includes(error?.name) ? error.name : 'NotAllowedError', message: fallback};
}


// Closed labels for the hook's fixed numeric status. No page-supplied text is
// presented, and these diagnostics never authorize interception or vault access.
export const DIAGNOSTIC_REASONS = [
  'No native fallback observed.', 'Page observed Thingtime disabled.',
  'Page did not receive extension state before the request.', 'Conditional sign-in uses the native provider.',
  'Unsupported request options use the native provider.', 'Website hints use the native provider.',
  'Unsupported WebAuthn extensions use the native provider.', 'Unsupported algorithms use the native provider.',
  'Requested attestation uses the native provider.', 'Requested authenticator attachment uses the native provider.',
  'The extension delegated to the browser’s native provider.', 'WebAuthn is unavailable in this document.',
  'The page did not allow a Thingtime hook to be installed.'
];
export function hookDiagnostics(value) {
  if (value?.available !== true) return {available: false};
  const hook = value.hook;
  if (!hook || typeof hook !== 'object') return {available: true, hook: null};
  return {available: true, hook: {
    installed: {create: hook.installed?.create === true, get: hook.installed?.get === true},
    current: {create: hook.current?.create === true, get: hook.current?.get === true},
    enabledSeen: typeof hook.enabledSeen === 'boolean' ? hook.enabledSeen : null,
    fallbackReason: Number.isInteger(hook.fallbackReason) && hook.fallbackReason >= 0 && hook.fallbackReason < DIAGNOSTIC_REASONS.length ? hook.fallbackReason : 0
  }};
}
