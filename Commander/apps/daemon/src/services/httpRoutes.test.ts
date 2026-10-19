import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { COMMANDER_HTTP_ROUTES, commanderCapabilityManifest, resolveCommanderRoute } from './httpRoutes.js';

describe('Commander active HTTP capability registry', () => {
  it('covers every registered runtime operation with an explicit contract and authenticates private routes', () => {
    const manifest = commanderCapabilityManifest('http://127.0.0.1:47820');
    expect(manifest.origin).toBe('http://127.0.0.1:47820');
    expect(new Set(COMMANDER_HTTP_ROUTES.map((route) => route.id)).size).toBe(COMMANDER_HTTP_ROUTES.length);
    for (const route of COMMANDER_HTTP_ROUTES) {
      const operation = manifest.features[`commander.${route.id}`]!;
      expect(operation.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(operation.operations[0]).toMatchObject({ method: route.method, path: route.path });
      const pathname = route.path.replace('*', 'test-id');
      expect(resolveCommanderRoute(route.method === '*' ? 'GET' : route.method, pathname)?.id).toBe(route.id);
      expect(operation.operations[0]!.authentication).toBe(
        route.path.startsWith('/api/native/')
          ? 'native-session'
          : route.path.startsWith('/api/')
            ? 'ui-session'
            : 'none',
      );
    }
    expect(manifest.features['commander.accounts-login']?.version).toBe('1.1.0');
    expect(manifest.features['commander.native-oauth-callback']?.version).toBe('1.0.1');
    expect(manifest.features['commander.oauth-callback']?.version).toBe('1.0.1');
    expect(resolveCommanderRoute('POST', '/api/unregistered')).toBeUndefined();
    expect(resolveCommanderRoute('GET', '/api/accounts/login')).toBeUndefined();
  });

  it('uses the registry for every real handler instead of maintaining a second route list', async () => {
    const source = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
    const dispatched = [...source.matchAll(/routeId === '([^']+)'/g)].map((match) => match[1]);
    expect(dispatched.sort()).toEqual(COMMANDER_HTTP_ROUTES.map((route) => route.id).sort());
    expect(source).not.toMatch(/request\.method ===/);
    expect(source).toContain("resolveCommanderRoute(request.method ?? '', url.pathname)?.id");
    expect(source).toContain('if (!routeId) return json(response, 404');
    const manifest = JSON.stringify(commanderCapabilityManifest('http://127.0.0.1:47820'));
    expect(manifest).not.toMatch(/sessionToken|nativeToken|dataDirectory|cacheDirectory|pid|accounts\":/);
  });
});
