'use strict';
const { fail, exactOrigin } = require('./contract.cjs');
const minimum = version => typeof version === 'string' && /^1\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version) && Number(version.split('.')[1]) >= 7;

// Use Electron's current session as a transport, never read/export its cookies.
// The bundled renderer proxy remains the canonical selected-authority boundary.
function createVaultTransport({ context }) {
  return async function call(scope, body, assertCurrent = () => {}) {
    const current = context();
    if (!current?.session || exactOrigin(current.endpoint) !== scope.origin) fail('SESSION_CHANGED', 'The selected Thingtime endpoint changed.');
    const renderer = exactOrigin(current.origin);
    const check = () => {
      assertCurrent();
      const latest = context();
      if (latest?.session !== current.session || latest?.origin !== renderer || latest?.endpoint !== scope.origin) fail('SESSION_CHANGED', 'The active Thingtime session changed.');
    };
    const receive = async (route, options = {}, publicManifest = false) => {
      check();
      let response;
      try { response = await current.session.fetch(`${publicManifest ? scope.origin : renderer}${route}`, { cache: 'no-store', redirect: 'error', credentials: publicManifest ? 'omit' : 'include', bypassCustomProtocolHandlers: true, signal: AbortSignal.timeout(30000), ...options }); }
      catch { fail('VAULT_UNAVAILABLE', 'The selected vault could not be reached. No fallback origin was used.'); }
      check();
      // Electron's Response.url is unreliable. The fixed URL, redirect refusal
      // and proxy's authoritative origin proof establish this transport binding.
      if (!response.ok || response.redirected || !response.headers.get('content-type')?.includes('json') || !publicManifest && renderer !== scope.origin && response.headers.get('x-thingtime-api-fallback') !== scope.origin) fail(response.status === 401 ? 'SIGNED_OUT' : response.status === 404 ? 'NOT_FOUND' : 'VAULT_REFUSED', 'The selected vault refused this request. Check the signed-in account and vault access.');
      let result;
      try { result = await response.json(); } catch { fail('INVALID_RESPONSE', 'The selected vault returned an invalid response.'); }
      check(); return result;
    };
    const capabilities = await receive('/.well-known/thingtime-capabilities.json', {}, true);
    if (capabilities?.schemaVersion !== 1 || capabilities.origin !== scope.origin || !minimum(capabilities.features?.['api.passwords']?.version)) fail('INCOMPATIBLE_API', 'The selected origin must provide api.passwords 1.7.0 or a compatible 1.x version.');
    const result = await receive('/api/v1/passwords', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: renderer, 'X-Thingtime-Expected-Actor': scope.ownerId, 'X-Thingtime-Expected-Api-Origin': scope.origin, 'X-Thingtime-Expected-Data-Plane': 'home' }, body: JSON.stringify({ ...body, expectedOwnerId: scope.ownerId }) });
    if (result?.ok !== true || result.ownerId !== scope.ownerId) fail('SESSION_CHANGED', 'The signed-in vault account changed.');
    check(); return result;
  };
}
module.exports = { createVaultTransport, minimum };
