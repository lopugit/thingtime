// Synthetic in-memory vault only. Run in the task-owned network-none browser.
import React from 'react';
import qrFixtureUrl from './password-totp.fixture.png';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ThingtimeContext } from '../app/Providers/ThingtimeProvider';
import { PasswordManager } from '../app/components/Passwords/PasswordManager';
import { newPasswordFile } from '../app/passwords/fileCrypto';
import type { PasswordEntry } from '../app/passwords/model';
import { importOnePasswordItem } from '../app/passwords/onePassword';
Object.defineProperty(window, 'SharedWorker', { value: undefined });
Object.defineProperty(navigator, 'onLine', { get: () => true });
const fixtureQuery = new URL(location.href).searchParams;
history.replaceState(null, '', '/passwords' + location.search);
let signedIn = true, vaultConfigured = fixtureQuery.get('vaultConfigured') !== '0';
const owner = 'synthetic-password-owner', entryId = '11111111-1111-4111-8111-111111111111', archiveId = '22222222-2222-4222-8222-222222222222';
const structuredSource = { uuid: 'fixture-file', categoryUuid: '001', overview: { title: 'Synthetic login' }, details: {
  passwordHistory: [{ value: 'fixture-old-password', time: 1700000000 }], notesPlain: 'fixture-source-secret',
  sections: [{ title: 'Synthetic properties', fields: [
    { title: 'Address', value: { address: { city: 'fixture-city-private', unknown: { 'fixture-private-property-name': ['fixture-nested-value', true, 7, null], empty: {}, sameType: ['fixture-array-first', 'fixture-array-second'] } } } },
    { title: 'SSH key', value: { sshKey: { privateKey: 'fixture-ssh-private-key', metadata: { publicKey: 'fixture-ssh-public-key' } } } }
  ] }]
} };
const initial: PasswordEntry = {
  title: 'Synthetic login', passwordType: 'login', tags: ['fixture-private-tag'], importArchiveId: archiveId,
  fields: [{ id: 'username', label: 'Username', type: 'text', value: 'fixture-user@example.test' },
    { id: 'password', label: 'Password', type: 'password', value: 'fixture-password-value' },
    { id: 'totp', label: 'Verification code', type: 'totp', value: 'JBSWY3DPEHPK3PXP' },
    { id: 'notes', label: 'Notes', type: 'notes', value: 'fixture-private-note' }, ...importOnePasswordItem(structuredSource).fields.filter(field => field.structured)],
  onePassword: JSON.stringify(structuredSource),
  onePasswordContext: JSON.stringify({ account: { accountName: 'fixture-account-private' }, vault: { name: 'fixture-vault-secret' } })
};
const entries = new Map([[entryId, { entry: initial, revision: 1 }]]);
const files = new Map([[entryId, [{ id: '33333333-3333-4333-8333-333333333333', metadata: newPasswordFile('Synthetic attachment.txt', 17) }]], [archiveId, [{ id: '44444444-4444-4444-8444-444444444444', metadata: { ...newPasswordFile('Synthetic source.txt', 9), archivePath: 'files/fixture-file___source.txt' } }]]]);
const operations: string[] = [], nativeOperations: string[] = [];
// Clipboard is a synthetic device boundary; never reaches the host clipboard.
let copiedValue = '', clipboardReject = false, clipboardPause = false, clipboardRelease: (() => void) | null = null;
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => {
  if (clipboardReject) throw new Error('fixture-secret-error-must-not-render');
  if (clipboardPause) { clipboardPause = false; await new Promise<void>(resolve => { clipboardRelease = resolve; }); clipboardRelease = null; }
  copiedValue = value;
} } });
const layoutKey = 'synthetic-password-layouts', originalFetch = window.fetch.bind(window);
let layoutRevision = 0;
let pausedOperation: string | null = null, pendingRelease: (() => void) | null = null;
let pauseCapability = new URL(location.href).searchParams.has('pauseCapability');
let capabilityPending: Promise<void> | null = null;
const metadata = ([id, saved]: [string, { entry: PasswordEntry; revision: number }]) => ({ id, title: saved.entry.title, passwordType: saved.entry.passwordType, revision: saved.revision, updatedAt: '2026-10-23T00:00:00.000Z' });
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
  init?.signal?.throwIfAborted();
  const response = (value: unknown, status = 200) => Response.json(value, { status });
  if (url.pathname.includes('thingtime-capabilities')) {
    if (pauseCapability) { capabilityPending ??= new Promise<void>(resolve => { pendingRelease = () => { pauseCapability = false; pendingRelease = null; resolve(); }; }); await capabilityPending; init?.signal?.throwIfAborted(); }
    return response({ schemaVersion: 1, origin: location.origin, features: Object.fromEntries(Object.entries({ 'api.passwords': '1.2.1', 'api.things': '1.36.0', 'api.webpages-resolve': '1.6.0', 'api.actions-run': '1.7.0', 'api.mongodb-endpoint': '1.1.0' }).map(([key, version]) => [key, { version }])) });
  }
  if (['/api/v1/webpages/resolve', '/api/v1/things'].includes(url.pathname)) {
    const headers = new Headers(init?.headers);
    if (headers.get('x-thingtime-expected-actor') !== owner || headers.get('x-thingtime-expected-data-plane') !== 'home') return response({ ok: false }, 409);
  }
  if (url.pathname === '/api/v1/webpages/resolve') {
    const pages = JSON.parse(localStorage.getItem(layoutKey) || '{}'), page = pages[url.searchParams.get('id') || ''];
    return page ? response({ ok: true, page, source: 'user' }) : response({ ok: false }, 404);
  }
  if (url.pathname === '/api/v1/things' && ['POST', 'PATCH'].includes(init?.method || '')) {
    const body = JSON.parse(String(init?.body)), pages = JSON.parse(localStorage.getItem(layoutKey) || '{}'), previous = pages[body.crystal.pageKey];
    if ((init?.method === 'POST' && previous) || (init?.method === 'PATCH' && (!previous || body.id !== previous.id || body.expectedUpdatedAt !== previous.updatedAt))) return response({ ok: false }, 409);
    const page = { id: previous?.id || body.shareId, crystal: body.crystal, acl: body.acl || previous?.acl, author: { id: owner }, updatedAt: new Date(1800000000000 + ++layoutRevision).toISOString() };
    localStorage.setItem(layoutKey, JSON.stringify({ ...pages, [page.crystal.pageKey]: page }));
    return response({ ok: true, thing: page });
  }
  if (url.pathname === '/api/v1/passwords') {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (body && body.expectedOwnerId !== owner) return response({ ok: false, error: 'Account changed' }, 409);
    const result = (rest: object) => response({ ok: true, ownerId: owner, ...rest });
    if (!body) return result({ configured: vaultConfigured, entries: Array.from(entries).map(metadata).filter(item => item.title.toLowerCase().includes((url.searchParams.get('q') || '').toLowerCase())), nextCursor: null });
    operations.push(body.operation);
    if (body.operation === pausedOperation) { pausedOperation = null; await new Promise<void>(resolve => { pendingRelease = resolve; }); pendingRelease = null; init?.signal?.throwIfAborted(); }
    if (body.operation === 'read') { const saved = entries.get(body.id); return result({ id: body.id, ...saved }); }
    if (body.operation === 'save') { const previous = entries.get(body.id); if (body.revision !== (previous?.revision || 0)) return response({ ok: false, error: 'Entry changed' }, 409); const saved = { entry: body.entry, revision: body.revision + 1 }; entries.set(body.id, saved); return result({ record: metadata([body.id, saved]) }); }
    if (body.operation === 'delete') { entries.delete(body.id); return result({}); }
    if (body.operation === 'file-list') return result({ files: body.entryIds.flatMap((id: string) => files.get(id) || []), nextCursor: null });
    if (body.operation === 'file-delete') { files.set(body.entryId, (files.get(body.entryId) || []).filter(file => file.id !== body.fileId)); return result({}); }
    if (body.operation === 'export') return result({ entries: Array.from(entries).map(([id, saved]) => ({ id, ...saved })), nextCursor: null });
    return response({ ok: false, error: 'Synthetic fixture does not implement this operation.' }, 400);
  }
  if (url.pathname.startsWith('/api/')) return response({ ok: true, things: [], items: [], components: [] });
  return originalFetch(input, init);
};
Object.assign(window, { thingtimeDesktop: { passwordsVersion: '1.0.0', passwordProvider: async ({ action, ownerId }: { action: string; ownerId: string }) => {
  if (ownerId !== owner) throw Error('Synthetic native owner mismatch'); nativeOperations.push(action); return { ok: true, message: `Synthetic AutoFill ${action} completed.` };
} } });
// Native transport simulation only. Real owner/URL/nonce verification is
// separately tested in the native adapter and the actual injected JS model.
let setupPending: { id: string; value: string } | null = null;
let setupScope: Record<string, string> | null = null;
const setupMessage = (detail: Record<string, unknown>) => window.dispatchEvent(new CustomEvent('thingtime:authenticator-setup', { detail: { nonce: setupScope?.nonce, ownerId: owner, ...detail } }));
const announceSetup = () => { if (setupScope && signedIn) {
  if (!vaultConfigured) setupMessage({ kind: 'unavailable' });
  else if (setupPending) setupMessage({ kind: 'available', requestId: setupPending.id });
} };
Object.assign(window, { thingtimeAuthenticatorSetup: { version: '1.0.0', postMessage: (message: Record<string, string>) => {
  if (message.operation === 'ready') { setupScope = message; queueMicrotask(announceSetup); }
  if (message.operation === 'cancel') { setupPending = null; setupScope = null; }
  if (message.operation === 'consume' && signedIn && vaultConfigured && message.ownerId === owner && message.dataPlane === 'home' && setupPending?.id === message.requestId) {
    const pending = setupPending; setupPending = null; setupMessage({ kind: 'setup', requestId: pending.id, setup: pending.value });
  }
} } });
Object.defineProperty(navigator, 'mediaDevices', { value: { getDisplayMedia: async () => { throw new DOMException('Synthetic screen chooser cancelled', 'NotAllowedError'); } } });
function Fixture() {
  const [thingtime, setThingtime] = React.useState({ settings: {} });
  return <ThingtimeContext.Provider value={{ Everything: { thingtime, setThingtime, loading: false } } as any}><PasswordManager /></ThingtimeContext.Provider>;
}
const router = createMemoryRouter([{ id: 'root', path: '*', loader: () => ({ user: signedIn ? { id: owner, username: 'synthetic', temporary: false, privateUploadsEnabled: true } : null, dataPlane: 'home' }), Component: Fixture }]);
createRoot(document.getElementById('root')!).render(<ChakraProvider><RouterProvider router={router} /></ChakraProvider>);
Object.assign(window, { passwordFixture: {
  qrFixtureUrl,
  offerSetup: () => { if (setupPending) return false; setupPending = { id: crypto.randomUUID(), value: `otpauth://totp/Synthetic:setup?secret=${'A'.repeat(32)}` }; if (setupScope) announceSetup(); else window.dispatchEvent(new Event('thingtime:authenticator-setup-ready')); return true; },
  setupPending: () => Boolean(setupPending),
  expireSetup: () => { const id = setupPending?.id; setupPending = null; if (id) setupMessage({ kind: 'expired', requestId: id }); return id; },
  emitExpired: (id: string) => setupMessage({ kind: 'expired', requestId: id }),
  setSignedIn: (value: boolean) => { signedIn = value; router.revalidate(); },
  setVaultConfigured: (value: boolean) => { vaultConfigured = value; router.revalidate(); window.dispatchEvent(new Event('thingtime:authenticator-setup-ready')); },
  clipboardValue: () => copiedValue,
  rejectClipboard: (value: boolean) => { clipboardReject = value; },
  pauseClipboard: () => { clipboardPause = true; },
  clipboardPending: () => clipboardRelease !== null,
  releaseClipboard: () => clipboardRelease?.(),
  pauseNext: (operation: string) => { if (!['read', 'save'].includes(operation)) throw Error('Unsupported fixture pause'); pausedOperation = operation; },
  pending: () => pendingRelease !== null, releasePending: () => pendingRelease?.(),
  operations: () => [...operations], nativeOperations: () => [...nativeOperations],
  savedEntry: () => entries.get(entryId)?.entry,
  hasSavedTitle: (title: string) => Array.from(entries.values()).some(saved => saved.entry.title === title),
  layouts: () => JSON.parse(localStorage.getItem(layoutKey) || '{}'),
  hasPrivateLayoutValues: () => {
    const stored = JSON.stringify(JSON.parse(localStorage.getItem(layoutKey) || '{}'));
    const privateValues = ['A'.repeat(32), 'fixture-user@example.test', 'fixture-password-value', 'fixture-old-password', 'fixture-private-note', 'fixture-source-secret', 'fixture-vault-secret', 'fixture-account-private', 'fixture-private-tag', 'JBSWY3DPEHPK3PXP', ...Array.from(files.values()).flat().flatMap(file => [file.metadata.key, file.metadata.nonce])];
    privateValues.push('fixture-city-private', 'fixture-private-property-name', 'fixture-nested-value', 'fixture-ssh-private-key', 'fixture-ssh-public-key', 'fixture-array-first', 'fixture-array-second');
    return privateValues.some(value => stored.includes(value));
  }
} });
