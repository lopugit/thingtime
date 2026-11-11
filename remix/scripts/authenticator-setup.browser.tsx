import { CurrentPageBuilderFixture } from './lib/CurrentPageBuilderFixture';
/** Synthetic UI transport only. No production endpoint, account, vault or passkey ceremony. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Box, Button, ChakraProvider, Text } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { rootIdentity } from '../app/utils/rootIdentity';
import { bindLocalWorkspace } from '../app/local-workspace/runtime.client';
import { PasswordManager, PasswordManagerScope } from '../app/components/Passwords/PasswordManager';
import type { PasswordEntry } from '../app/passwords/model';
const ownerId = 'synthetic-password-tools-owner';
const local = new URL(location.href).searchParams.get('local') === '1';
{ const { generation } = rootIdentity.read(); bindLocalWorkspace(local, generation, local ? undefined : { kind: 'account', origin: location.origin, ownerId, dataPlane: 'home' }, false); rootIdentity.confirm(generation); }
const entryId = '11111111-1111-4111-8111-111111111111';
const title = 'Synthetic QA login';
const iconUrl = 'https://password-tools.invalid/icon.png';
const badIconUrl = 'https://password-tools.invalid/missing.png';
const iconBytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6m0AAAAASUVORK5CYII='), character => character.charCodeAt(0));
const entries = new Map<string, { revision: number; entry: PasswordEntry }>([[entryId, { revision: 1, entry: { title, passwordType: 'login', fields: [
  { id: 'username', label: 'Username', type: 'text', value: 'synthetic@example.invalid' },
  { id: 'password', label: 'Password', type: 'password', value: '' },
  { id: 'backup', label: 'Backup password', type: 'password', value: '' },
  { id: 'website', label: 'Website', type: 'url', value: 'https://password-tools.invalid/' }
] } }]]);
const layouts = new Map<string, any>();
let saves = 0; let reads = 0; let iconFetches = 0; let rejectedRequests = 0; let duplicateKeyWarnings = 0; let verificationRequests = 0;
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && /same key|unique ["']?key/i.test(args[0])) duplicateKeyWarnings++;
  originalConsoleError(...args);
};
const metadata = (id: string, value: { revision: number; entry: PasswordEntry }) => ({ id, title: value.entry.title, passwordType: value.entry.passwordType, revision: value.revision, updatedAt: new Date(1700000000000 + value.revision).toISOString(), ...(value.entry.icon ? { icon: value.entry.icon } : {}) });
// Deliberately no reference to original fetch: every unrecognised request fails closed.
window.fetch = async (input, init) => {
  init?.signal?.throwIfAborted();
  const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
  if (url.href === iconUrl) { iconFetches++; return new Response(iconBytes, { headers: { 'Content-Type': 'image/png' } }); }
  if (url.href === badIconUrl) return new Response(null, { status: 404 });
  if (url.origin !== location.origin) { rejectedRequests++; return Response.json({ ok: false, error: 'Synthetic fixture blocks external requests.' }, { status: 403 }); }
  if (url.pathname === '/.well-known/thingtime-capabilities.json') return Response.json({ schemaVersion: 1, origin: location.origin, features: Object.fromEntries(['api.passwords', 'api.things', 'api.webpages-resolve', 'api.actions-run', 'api.mongodb-endpoint'].map(feature => [feature, { version: feature === 'api.passwords' ? '1.10.0' : '1.99.0' }])) });
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (url.pathname === '/api/v1/passwords') {
    if (String(body.operation).startsWith('verification-')) verificationRequests++;
    const response = (data: Record<string, unknown>) => Response.json({ ok: true, ownerId, ...data });
    if (!init?.body) return response({ configured: true, entries: Array.from(entries, ([id, record]) => metadata(id, record)), nextCursor: null });
    if (body.expectedOwnerId !== ownerId) return Response.json({ ok: false, error: 'Wrong synthetic owner.' }, { status: 403 });
    if (body.operation === 'verification-settings') return response({ settings: { window: '5m', revision: 'synthetic', reuseRecentDeviceVerification: true } });
    if (body.operation === 'file-list') return response({ files: [], nextCursor: null });
    if (body.operation === 'read') { const record = entries.get(body.id); if (!record) return Response.json({ ok: false }, { status: 404 }); reads++; return response({ id: body.id, revision: record.revision, entry: structuredClone(record.entry) }); }
    if (body.operation === 'save') {
      const record = { revision: (entries.get(body.id)?.revision || 0) + 1, entry: structuredClone(body.entry) };
      entries.set(body.id, record); saves++; return response({ record: metadata(body.id, record) });
    }
  }
  if (url.pathname === '/api/v1/webpages/resolve') {
    const page = layouts.get(url.searchParams.get('id') || '');
    return page ? Response.json({ ok: true, source: 'user', page, components: [], refs: {} }) : Response.json({ ok: false }, { status: 404 });
  }
  if (url.pathname === '/api/v1/things' && ['POST', 'PATCH'].includes(init?.method || '')) {
    const page = { id: body.id || body.shareId, author: { id: ownerId }, crystal: structuredClone(body.crystal), updatedAt: new Date().toISOString() };
    layouts.set(body.crystal.pageKey, page); return Response.json({ ok: true, thing: page });
  }
  // Notification history is metadata-only and remains synthetic too.
  if (url.pathname.includes('notification')) return Response.json({ ok: true, entries: [], notifications: [] });
  rejectedRequests++; return Response.json({ ok: false, error: 'Unsupported synthetic fixture operation.' }, { status: 404 });
};

let scope: Record<string, string> | undefined;
const bridgeAcceptedOwners: string[] = [], bridgeIgnoredOwners: string[] = [];
let requestId = crypto.randomUUID();
const emitSetup = (kind: string, extra = {}) => { if (scope) window.dispatchEvent(new CustomEvent('thingtime:authenticator-setup', { detail: { kind, nonce: scope.nonce, ownerId: scope.ownerId, requestId, ...extra } })); };
window.thingtimeAuthenticatorSetup = { version: '1.0.0', postMessage(message) {
  if (message.ownerId !== ownerId) { bridgeIgnoredOwners.push(message.ownerId); return; }
  bridgeAcceptedOwners.push(message.ownerId);
  if (message.operation === 'ready') { scope = message; queueMicrotask(() => emitSetup('available')); }
  if (message.operation === 'consume') queueMicrotask(() => emitSetup('setup', { setup: 'otpauth://totp/Synthetic?secret=' + ['GEZD','GNBV','GY3T','QOJQ','GEZD','GNBV','GY3T','QOJQ'].join('') }));
}};
(window as any).nativeSetupFixture = {
  verificationRequests: () => verificationRequests,
  bridgeSnapshot: () => ({ acceptedOwners: [...bridgeAcceptedOwners], ignoredOwners: [...bridgeIgnoredOwners] }),
  offer: () => { requestId = crypto.randomUUID(); emitSetup('available'); },
  snapshot: () => ({ saves, totpEntries: (local ? [] : [...entries.values()]).filter(record => record.entry.fields.some(field => field.type === 'totp')).length }),
};
// Match the existing password editor fixture's account transport component;
// the anonymous variant exercises the actual outer device-vault gate.
function Fixture() { return local ? <PasswordManager /> : <PasswordManagerScope ownerId={ownerId} />; }
const router = createMemoryRouter([{ id: 'root', path: '*', element: <CurrentPageBuilderFixture><Fixture /></CurrentPageBuilderFixture>, loader: () => ({ user: local ? null : { id: ownerId, username: 'synthetic-password-tools', ttid: 'synthetic', temporary: false, accountKind: 'user' }, dataPlane: 'home' }) }], { hydrationData: { loaderData: { root: { user: local ? null : { id: ownerId, username: 'synthetic-password-tools', ttid: 'synthetic', temporary: false, accountKind: 'user' }, dataPlane: 'home' } } } });
createRoot(document.getElementById('root')!).render(<ChakraProvider><RouterProvider router={router} /></ChakraProvider>);
