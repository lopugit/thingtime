(() => {
  'use strict';
  if (window.top !== window) return;
  const dispatch = (name, detail) => document.dispatchEvent(new CustomEvent(name, {detail: JSON.stringify(detail)}));
  const parse = event => { try { return typeof event.detail === 'string' ? JSON.parse(event.detail) : JSON.parse(JSON.stringify(event.detail)); } catch { return null; } };
  let active = null;
  let providerActive = null;
  const state = async () => {
    try { const value = await chrome.runtime.sendMessage({action: 'state'}); dispatch('thingtime:extension-state', {version: 1, enabled: value.enabled}); } catch { dispatch('thingtime:extension-state', {version: 1, enabled: false}); }
  };
  document.addEventListener('thingtime:password-extension-query', async event => {
    const value = parse(event); if (value?.version !== 1) return;
    try {
      const status = await chrome.runtime.sendMessage({action: 'extension-query'});
      if (status.available === true) dispatch('thingtime:password-extension-status', {...status, version: 1});
    } catch { /* Absent status leaves the page's install/setup guidance visible. */ }
  });
  document.addEventListener('thingtime:password-extension-configure', event => {
    const value = parse(event); if (value?.version === 1) void chrome.runtime.sendMessage({action: 'extension-configure'}).catch(() => {});
  });
  document.addEventListener('thingtime:extension-state-request', state);
  chrome.storage.onChanged.addListener(state);
  void state();
  document.addEventListener('thingtime:extension-request', event => {
    const message = parse(event);
    if (message?.version !== 1 || !['create', 'get'].includes(message.type) || typeof message.id !== 'string') return;
    if (active) { dispatch('thingtime:extension-response', {version: 1, id: message.id, error: {name: 'InvalidStateError', message: 'A passkey request is already active in this tab.'}}); return; }
    active = message.id;
    chrome.runtime.sendMessage({...message, action: 'request'}).then(result => {
      if (active !== message.id) return;
      active = null; dispatch('thingtime:extension-response', {...result, version: 1, id: message.id});
    }).catch(() => {
      if (active !== message.id) return;
      active = null; dispatch('thingtime:extension-response', {version: 1, id: message.id, error: {name: 'NotAllowedError', message: 'The extension connection ended. Try again.'}});
    });
  });
  document.addEventListener('thingtime:extension-cancel', event => {
    const value = parse(event); if (value?.id !== active || value.version !== 1) return;
    active = null; void chrome.runtime.sendMessage({action: 'cancel', id: value.id}).catch(() => {});
  });
  document.addEventListener('thingtime:password-provider-ready', event => {
    const value = parse(event); if (value?.version === 1) void chrome.runtime.sendMessage({action: 'provider-ready'}).catch(() => {});
  });
  document.addEventListener('thingtime:password-provider-response', event => {
    const value = parse(event); if (value?.version !== 1 || value.id !== providerActive) return;
    providerActive = null; void chrome.runtime.sendMessage({action: 'provider-response', ...value}).catch(() => {});
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.action === 'provider-init') dispatch('thingtime:password-provider-init', {version: 1});
    else if (message.action === 'provider-request') {
      providerActive = message.request.id;
      dispatch('thingtime:password-provider-request', message.request);
    } else if (message.action === 'provider-cancel' && message.id === providerActive) {
      providerActive = null; dispatch('thingtime:password-provider-cancel', {version: 1, id: message.id});
    }
    respond({ok: true});
  });
  window.addEventListener('pagehide', () => {
    if (active) void chrome.runtime.sendMessage({action: 'cancel', id: active}).catch(() => {});
    active = null; providerActive = null;
  }, {once: true});
})();
