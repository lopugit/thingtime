import {DEFAULT_ORIGIN, PROVIDER_PATH, safeOrigin, providerOrigin, senderOrigin, matchesDocument, validRequest, safeError, hookDiagnostics} from './protocol.js';

const pending = new Map();
const settings = async () => ({enabled: false, origin: DEFAULT_ORIGIN, ...await chrome.storage.local.get(['enabled', 'origin'])});
const alarmName = id => `passkey:${id}`;
const send = (tabId, documentId, message) => chrome.tabs.sendMessage(tabId, message, {documentId}).catch(() => null);
const errorResult = (name, message) => ({error: {name, message}});
async function checkpoint() {
  // Only routing handles are retained across worker suspension. Never persist
  // credential options, responses, authentication state or vault material.
  await chrome.storage.session.set({pending: [...pending.values()].map(({id, tabId, documentId, providerTabId, providerDocumentId, providerOrigin}) => ({id, tabId, documentId, providerTabId, providerDocumentId, providerOrigin}))});
}
async function closeOwnedProvider(request) {
  if (!Number.isInteger(request.providerTabId)) return;
  const [frame, tab] = await Promise.all([
    chrome.webNavigation.getFrame({tabId: request.providerTabId, frameId: 0}).catch(() => null),
    chrome.tabs.get(request.providerTabId).catch(() => null),
  ]);
  const providerUrl = value => {
    try { return safeOrigin(value) === request.providerOrigin && new URL(value).pathname === PROVIDER_PATH; }
    catch { return false; }
  };
  // A user navigation also invalidates ownership while still pending: the old
  // provider document may remain committed until the new destination loads.
  if (!tab || tab.pendingUrl && !providerUrl(tab.pendingUrl)) return;
  const current = frame && providerUrl(frame.url) && providerUrl(tab.url)
    && (!request.providerDocumentId || frame.documentId === request.providerDocumentId);
  const initial = !request.providerDocumentId && (!frame || frame.url === 'about:blank')
    && (!tab.url || tab.url === 'about:blank') && providerUrl(tab.pendingUrl);
  if (current || initial) await chrome.tabs.remove(request.providerTabId).catch(() => {});
}
async function finish(request, result) {
  if (pending.get(request.tabId) !== request) return;
  pending.delete(request.tabId); clearTimeout(request.timer);
  await chrome.alarms.clear(alarmName(request.id));
  if (request.providerDocumentId) await send(request.providerTabId, request.providerDocumentId, {action: 'provider-cancel', id: request.id});
  await closeOwnedProvider(request);
  await checkpoint(); request.respond(result);
}
const recovered = (async () => {
  const saved = await chrome.storage.session.get('pending');
  for (const request of saved.pending || []) {
    await closeOwnedProvider(request);
    await chrome.alarms.clear(alarmName(request.id));
  }
  await chrome.storage.session.remove('pending');
})();
async function currentDocument(tabId, documentId, origin, provider = false) {
  try {
    const frame = await chrome.webNavigation.getFrame({tabId, frameId: 0});
    return frame?.documentId === documentId && safeOrigin(frame.url) === origin
      && (!provider || new URL(frame.url).pathname === PROVIDER_PATH);
  } catch { return false; }
}
async function start(message, sender, respond) {
  const origin = senderOrigin(sender);
  if (!origin || !validRequest(message)) return respond(errorResult('SecurityError', 'This page cannot request a Thingtime passkey.'));
  if (pending.has(sender.tab.id)) return respond(errorResult('InvalidStateError', 'A passkey request is already active in this tab.'));
  // Admit synchronously before the first async read: a cancellation during
  // settings or document lookup must fence the operation before any tab opens.
  const request = {id: crypto.randomUUID(), callerId: message.id, type: message.type, publicKey: message.publicKey,
    tabId: sender.tab.id, documentId: sender.documentId, origin, providerOrigin: null,
    providerTabId: null, providerDocumentId: null, delivered: false, respond};
  pending.set(request.tabId, request);
  const live = () => pending.get(request.tabId) === request;
  try {
    const config = await settings();
    if (!live()) return;
    if (!config.enabled || origin === config.origin) return finish(request, {fallback: true});
    try { request.providerOrigin = providerOrigin(config.origin); }
    catch { return finish(request, errorResult('SecurityError', 'Select a valid Thingtime origin in the extension.')); }
    const current = await currentDocument(sender.tab.id, sender.documentId, origin);
    if (!live()) return;
    if (!current) return finish(request, errorResult('AbortError', 'The requesting page changed.'));
    const timeout = Number.isFinite(message.publicKey.timeout) ? Math.max(1, Math.min(message.publicKey.timeout, 120000)) : 120000;
    request.timer = setTimeout(() => void finish(request, errorResult('NotAllowedError', 'The passkey request timed out.')), timeout);
    await chrome.alarms.create(alarmName(request.id), {when: Date.now() + timeout});
    if (!live()) { await chrome.alarms.clear(alarmName(request.id)); return; }
    const tab = await chrome.tabs.create({url: `${request.providerOrigin}${PROVIDER_PATH}`, active: true});
    request.providerTabId = tab.id;
    if (!live()) { await closeOwnedProvider(request); return; }
    await checkpoint();
    if (!live()) return;
    void chrome.tabs.sendMessage(tab.id, {action: 'provider-init'}, {frameId: 0}).catch(() => {});
    // The provider-ready event is the delivery handshake. No request is sent
    // merely because the tab was opened or a page with a matching URL loaded.
  } catch { await finish(request, errorResult('NotAllowedError', 'The Thingtime provider tab could not open.')); }
}
async function handle(message, sender, respond) {
  await recovered;
  // Both action popups and options_ui.open_in_tab use this exact extension
  // document. Chrome includes sender.tab for the latter; web content cannot
  // acquire the extension URL merely by sending runtime messages.
  const internal = sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('popup.html')
    && (sender.frameId === undefined || sender.frameId === 0)
    && (sender.origin === undefined || sender.origin === chrome.runtime.getURL('').replace(/\/$/, ''));
  if (message?.action === 'state') { const config = await settings(); return respond({enabled: config.enabled === true, origin: config.origin}); }
  if (message?.action === 'diagnostics' && internal) {
    try {
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      if (!Number.isInteger(tab?.id)) return respond({available: false});
      const frame = await chrome.webNavigation.getFrame({tabId: tab.id, frameId: 0});
      const origin = safeOrigin(frame?.url);
      if (!origin || !frame.documentId) return respond({available: false});
      const value = await chrome.tabs.sendMessage(tab.id, {action: 'diagnostics-query'}, {documentId: frame.documentId});
      if (!await currentDocument(tab.id, frame.documentId, origin)) return respond({available: false});
      return respond(hookDiagnostics(value));
    } catch { return respond({available: false}); }
  }

  if (['extension-query', 'extension-configure'].includes(message?.action)) {
    const config = await settings();
    const origin = senderOrigin(sender);
    if (origin !== config.origin || !['/passwords', '/settings/passwords'].includes(new URL(sender.url).pathname)
      || !await currentDocument(sender.tab.id, sender.documentId, origin)) return respond({available: false});
    if (message.action === 'extension-configure') { await chrome.runtime.openOptionsPage(); return respond({ok: true}); }
    return respond({version: 1, available: true, enabled: config.enabled === true, origin: config.origin});
  }
  if (message?.action === 'settings' && internal) {
    const origin = providerOrigin(message.origin);
    await chrome.storage.local.set({enabled: message.enabled === true, origin});
    for (const request of [...pending.values()]) await finish(request, errorResult('AbortError', 'The extension settings changed.'));
    return respond({ok: true});
  }
  if (message?.action === 'native-fallback' && internal) {
    const request = pending.get(message.tabId);
    if (request) await finish(request, {fallback: true});
    return respond({ok: true});
  }
  if (message?.action === 'status' && internal) return respond({requests: [...pending.values()].map(r => ({tabId: r.tabId, origin: r.origin}))});
  if (message?.action === 'request') return start(message, sender, respond);
  if (message?.action === 'cancel') {
    const request = pending.get(sender.tab?.id);
    if (request && matchesDocument(request, sender) && request.callerId === message.id) await finish(request, errorResult('AbortError', 'The passkey request was cancelled.'));
    return respond({ok: true});
  }
  const request = [...pending.values()].find(r => r.providerTabId === sender.tab?.id);
  if (!request || sender.frameId !== 0 || senderOrigin(sender) !== request.providerOrigin
    || new URL(sender.url).pathname !== PROVIDER_PATH) return respond({ok: false});
  if (!await currentDocument(request.tabId, request.documentId, request.origin)) {
    await finish(request, errorResult('AbortError', 'The requesting page changed.')); return respond({ok: false});
  }
  if (pending.get(request.tabId) !== request) return respond({ok: false});
  if (message.action === 'provider-ready' && !request.delivered) {
    const config = await settings();
    if (config.enabled !== true || config.origin !== request.providerOrigin) {
      await finish(request, errorResult('AbortError', 'The extension settings changed.')); return respond({ok: false});
    }
    if (!await currentDocument(sender.tab.id, sender.documentId, request.providerOrigin, true) || pending.get(request.tabId) !== request) return respond({ok: false});
    request.providerDocumentId = sender.documentId; request.delivered = true;
    await checkpoint();
    if (pending.get(request.tabId) !== request) return respond({ok: false});
    await send(request.providerTabId, request.providerDocumentId, {action: 'provider-request', request: {version: 1, id: request.id, type: request.type, origin: request.origin, publicKey: request.publicKey}});
    return respond({ok: true});
  }
  if (message.action === 'provider-response' && matchesDocument(request, sender, true) && message.version === 1 && message.id === request.id) {
    if (!await currentDocument(sender.tab.id, sender.documentId, request.providerOrigin, true)) return respond({ok: false});
    const result = message.fallback === true ? {fallback: true} : message.error ? {error: safeError(message.error)} : {response: message.response};
    await finish(request, result); return respond({ok: true});
  }
  respond({ok: false});
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender, respond).catch(() => respond(errorResult('NotAllowedError', 'The extension request failed.')));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => {
  for (const request of pending.values()) if ([request.tabId, request.providerTabId].includes(tabId)) void finish(request, errorResult('AbortError', 'A passkey tab was closed.'));
});
chrome.webNavigation.onCommitted.addListener(details => {
  if (details.frameId !== 0) return;
  for (const request of pending.values()) {
    if (details.tabId === request.tabId && details.documentId !== request.documentId) void finish(request, errorResult('AbortError', 'The requesting page navigated.'));
    if (details.tabId === request.providerTabId && (safeOrigin(details.url) !== request.providerOrigin || new URL(details.url).pathname !== PROVIDER_PATH || request.providerDocumentId && request.providerDocumentId !== details.documentId)) void finish(request, errorResult('AbortError', 'The provider page navigated.'));
  }
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  for (const request of pending.values()) {
    if (change.url && (tabId === request.tabId && safeOrigin(change.url) !== request.origin || tabId === request.providerTabId && (safeOrigin(change.url) !== request.providerOrigin || new URL(change.url).pathname !== PROVIDER_PATH))) void finish(request, errorResult('AbortError', 'A passkey tab changed origin or provider route.'));
    if (tabId === request.providerTabId && change.status === 'complete' && !request.delivered) void chrome.tabs.sendMessage(tabId, {action: 'provider-init'}, {frameId: 0}).catch(() => {});
  }
});
chrome.alarms.onAlarm.addListener(alarm => {
  for (const request of pending.values()) if (alarm.name === alarmName(request.id)) void finish(request, errorResult('NotAllowedError', 'The passkey request timed out.'));
});
