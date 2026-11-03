(() => {
  'use strict';
  if (window.top !== window) return;
  const dispatch = (name, detail) => document.dispatchEvent(new CustomEvent(name, {detail: JSON.stringify(detail)}));
  const parse = event => { try { return JSON.parse(event.detail); } catch { return null; } };
  // Closed, per-document diagnostics only. Never retain request options, origins,
  // credential IDs, responses or session data in this status.
  let enabled = false, stateSeen = false, fallbackReason = 0;
  const installed = {create: false, get: false}, wrappers = {};
  document.addEventListener('thingtime:extension-diagnostics-query', () => {
    dispatch('thingtime:extension-diagnostics', {version: 1, installed,
      current: {create: installed.create && navigator.credentials?.create === wrappers.create,
        get: installed.get && navigator.credentials?.get === wrappers.get},
      enabledSeen: stateSeen ? enabled : null, fallbackReason});
  });
  if (!navigator.credentials || !window.PublicKeyCredential) { fallbackReason = 11; return; }

  const encode = value => {
    const bytes = new Uint8Array(value.buffer || value, value.byteOffset || 0, value.byteLength);
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const decode = value => {
    if (typeof value !== 'string' || !/^[\w-]*$/.test(value)) throw new TypeError('Invalid passkey response encoding.');
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, c => c.charCodeAt(0)).buffer;
  };
  const jsonOptions = value => {
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return encode(value);
    if (Array.isArray(value)) return value.map(jsonOptions);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonOptions(v)]));
    return value;
  };
  const credential = (data, type) => {
    if (!data || data.type !== 'public-key' || typeof data.id !== 'string' || !data.response) throw new TypeError('Invalid passkey response.');
    const rawId = decode(data.rawId);
    const response = {};
    for (const field of type === 'create' ? ['clientDataJSON', 'attestationObject'] : ['clientDataJSON', 'authenticatorData', 'signature']) response[field] = decode(data.response[field]);
    if (type === 'get') response.userHandle = data.response.userHandle == null ? null : decode(data.response.userHandle);
    else {
      response.getTransports = () => [...(data.response.transports || [])];
      response.getPublicKey = () => data.response.publicKey ? decode(data.response.publicKey) : null;
      response.getPublicKeyAlgorithm = () => data.response.publicKeyAlgorithm ?? -7;
      response.getAuthenticatorData = () => data.response.authenticatorData ? decode(data.response.authenticatorData) : new ArrayBuffer(0);
    }
    const output = {id: data.id, rawId, type: 'public-key', response, authenticatorAttachment: data.authenticatorAttachment ?? null,
      getClientExtensionResults: () => structuredClone(data.clientExtensionResults || {}), toJSON: () => structuredClone(data)};
    // Native WebAuthn objects have internal slots; a plain compatible object avoids
    // claiming an actual browser-created PublicKeyCredential instance.
    return output;
  };
  const unsupportedReason = (options, type) => {
    const key = options.publicKey;
    if (options.mediation === 'conditional') return 3;
    if (!key || typeof key !== 'object' || Object.keys(options).some(name => !['publicKey', 'signal', 'mediation'].includes(name))) return 4;
    const fields = type === 'create'
      ? ['challenge', 'rp', 'user', 'pubKeyCredParams', 'timeout', 'excludeCredentials', 'authenticatorSelection', 'attestation', 'extensions', 'hints']
      : ['challenge', 'timeout', 'rpId', 'allowCredentials', 'userVerification', 'extensions', 'hints'];
    if (Object.keys(key).some(name => !fields.includes(name))) return 4;
    if (key.hints?.length) return 5;
    const extensions = key.extensions;
    if (extensions !== undefined && (!extensions || typeof extensions !== 'object' || Array.isArray(extensions)
      || Object.entries(extensions).some(([name, value]) => type !== 'create' || name !== 'credProps' || value !== true))) return 6;
    if (type === 'create') {
      if (!Array.isArray(key.pubKeyCredParams) || !key.pubKeyCredParams.every(item => item?.type === 'public-key' && Number.isInteger(item.alg))
        || !key.pubKeyCredParams.some(item => item.alg === -7)) return 7;
      if (key.attestation !== undefined && key.attestation !== 'none') return 8;
      const selection = key.authenticatorSelection;
      if (selection !== undefined && (!selection || typeof selection !== 'object' || Array.isArray(selection)
        || Object.keys(selection).some(name => !['authenticatorAttachment', 'residentKey', 'requireResidentKey', 'userVerification'].includes(name))
        || selection.authenticatorAttachment !== undefined && selection.authenticatorAttachment !== 'platform')) return 9;
    }
    return 0;
  };
  let ready;
  const initialized = new Promise(resolve => { ready = resolve; setTimeout(resolve, 500); });
  document.addEventListener('thingtime:extension-state', event => {
    const data = parse(event); if (data?.version !== 1) return;
    enabled = data.enabled === true; stateSeen = true; ready();
  });
  dispatch('thingtime:extension-state-request', {version: 1});
  for (const type of ['create', 'get']) {
    const original = navigator.credentials[type].bind(navigator.credentials);
    const wrapped = async function(options = {}) {
      await initialized;
      const reason = !enabled ? stateSeen ? 1 : 2 : unsupportedReason(options, type);
      if (reason) { fallbackReason = reason; return original(options); }
      fallbackReason = 0;
      if (options.signal?.aborted) throw new DOMException('The request was cancelled.', 'AbortError');
      const id = crypto.randomUUID();
      const result = await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error, value) => {
          if (settled) return; settled = true; clearTimeout(timer);
          document.removeEventListener('thingtime:extension-response', onResponse);
          options.signal?.removeEventListener('abort', onAbort);
          window.removeEventListener('pagehide', onAbort);
          error ? reject(error) : resolve(value);
        };
        const onAbort = () => { dispatch('thingtime:extension-cancel', {version: 1, id}); finish(new DOMException('The request was cancelled.', 'AbortError')); };
        const onResponse = event => {
          const data = parse(event); if (data?.version !== 1 || data.id !== id) return;
          if (data.fallback === true) finish(null, {fallback: true});
          else if (data.error) finish(new DOMException(data.error.message || 'The request failed.', data.error.name || 'NotAllowedError'));
          else { try { finish(null, {credential: credential(data.response, type)}); } catch (error) { finish(error); } }
        };
        const timer = setTimeout(() => { dispatch('thingtime:extension-cancel', {version: 1, id}); finish(new DOMException('The passkey request timed out.', 'NotAllowedError')); }, 125000);
        document.addEventListener('thingtime:extension-response', onResponse);
        options.signal?.addEventListener('abort', onAbort, {once: true});
        window.addEventListener('pagehide', onAbort, {once: true});
        try { dispatch('thingtime:extension-request', {version: 1, id, type, publicKey: jsonOptions(options.publicKey)}); } catch (error) { finish(error); }
      });
      if (result.fallback) { fallbackReason = 10; return original(options); }
      return result.credential;
    };
    wrappers[type] = wrapped;
    try { Object.defineProperty(navigator.credentials, type, {value: wrapped, configurable: true, writable: true}); installed[type] = navigator.credentials[type] === wrapped; } catch { fallbackReason = 12; /* Retain the page's existing method. */ }
  }
})();
