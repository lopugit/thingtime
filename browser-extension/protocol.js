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
