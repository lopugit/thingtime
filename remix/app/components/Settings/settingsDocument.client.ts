import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from '~/api/utils/capabilities/capabilityContract';
import { settingsDocumentBlocks, settingsDocumentKey, type SettingsDocument, type SettingsDocumentAdapter, type SettingsDocumentScope } from './settingsDocument';

/** Uses the existing private webpage/Thing contract and its ordinary Builder
 * revision fence. No settings-specific HTTP endpoint or credential store. */
export function accountSettingsDocumentAdapter(scope: SettingsDocumentScope, dependencies: { fetch: typeof fetch; currentOrigin?: () => string } = { fetch: globalThis.fetch.bind(globalThis) }): SettingsDocumentAdapter {
  settingsDocumentKey(scope);
  const assertOrigin = () => {
    const current = dependencies.currentOrigin?.() ?? (typeof window === 'undefined' ? scope.origin : window.location.origin);
    if (current !== scope.origin) throw new Error('The settings origin changed. Reopen Settings before saving.');
  };
  assertOrigin();
  const requireCapabilities = async (signal: AbortSignal, features: Record<string, string>) => {
    assertOrigin();
    const response = await dependencies.fetch(`${scope.origin}${THINGTIME_CAPABILITY_MANIFEST_PATH}`, { headers: { Accept: 'application/json' }, signal, credentials: 'omit', cache: 'no-store', redirect: 'error' });
    const manifest = await response.json();
    assertOrigin();
    if (!response.ok || manifest.schemaVersion !== 1 || manifest.origin !== scope.origin ||
      Object.entries(features).some(([feature, minimum]) => !capabilitySatisfies(manifest.features?.[feature]?.version || '', minimum)))
      throw new Error('This API does not support safe editable settings documents yet.');
  };
  const pageKey = `settings-${scope.documentKey}`;
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json',
    'X-Thingtime-Expected-Actor': scope.ownerId, 'X-Thingtime-Expected-Data-Plane': scope.dataPlane };
  const request = async (path: string, signal: AbortSignal, init: RequestInit = {}) => {
    assertOrigin();
    signal.throwIfAborted();
    const response = await dependencies.fetch(`${scope.origin}${path}`, { ...init, headers, signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
    const data = await response.json();
    if (!response.ok || !data?.ok) throw new Error(response.status === 409 ? 'The account, data plane or layout changed. Reload before saving.' : 'The settings document could not be loaded or saved.');
    return data;
  };
  const project = (page: any): SettingsDocument => {
    if (!page || page.author?.id !== scope.ownerId || page.crystal?.pageKey !== pageKey || typeof page.id !== 'string' || typeof page.updatedAt !== 'string' || typeof page.crystal.name !== 'string')
      throw new Error('The settings document does not belong to this account.');
    return { id: page.id, revision: page.updatedAt, name: page.crystal.name, blocks: settingsDocumentBlocks(page.crystal.blocks) };
  };
  return {
    async load(signal) {
      await requireCapabilities(signal, { 'api.webpages-resolve': '1.6.0', 'api.actions-run': '1.7.0', 'api.mongodb-endpoint': '1.1.0' });
      assertOrigin();
    signal.throwIfAborted();
      const response = await dependencies.fetch(`${scope.origin}/api/v1/webpages/resolve?id=${encodeURIComponent(pageKey)}`, {
        headers, signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error'
      });
      if (response.status === 404) return null;
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error('The settings document could not be loaded.');
      return data.page && data.source === 'user' ? project(data.page) : null;
    },
    async save(document, signal) {
      await requireCapabilities(signal, { 'api.things': '1.36.0', 'api.actions-run': '1.7.0', 'api.mongodb-endpoint': '1.1.0' });
      if (document.id && !document.revision) throw new Error('Reload the settings document before updating it.');
      // An uncertain POST retry, a reload and another tab all target the same
      // private document. A duplicate never silently overwrites the winner.
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(settingsDocumentKey(scope)));
      const shareId = `settings-layout-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
      const crystal = { name: document.name, pageKey, blocks: settingsDocumentBlocks(document.blocks) };
      try {
      const result = await request('/api/v1/things', signal, {
        method: document.id ? 'PATCH' : 'POST',
        body: JSON.stringify(document.id ? { id: document.id, crystal, expectedUpdatedAt: document.revision } :
          { shareId, thingtime: ['webpage'], crystal, acl: ['tt:user'] })
      });
      return project(result.thing);
      } catch (error) {
        assertOrigin();
    signal.throwIfAborted();
        // Recover only an exact committed result after a duplicate or lost
        // response. A competing edit remains a conflict, never an overwrite.
        const existing = await accountSettingsDocumentAdapter(scope, dependencies).load(signal).catch(() => null);
        assertOrigin();
    signal.throwIfAborted();
        if (existing?.id === (document.id || shareId) && existing.name === document.name &&
          JSON.stringify(existing.blocks) === JSON.stringify(crystal.blocks)) return existing;
        throw error;
      }
    }
  };
}
