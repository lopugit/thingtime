// Opt-in loopback test data for the REAL installed mobile UI. This only seeds
// cloud files via canonical APIs; it does not fabricate grants or sync replies.
import assert from 'node:assert/strict';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createCloudFileTransport } from '../app/fileSync/cloudTransport';
import { cloudFileSyncEntry } from '../app/fileSync/cloudFile';
import { fingerprintSource } from '../app/fileSync/contentFingerprint';
import { capabilitySatisfies } from '../app/api/utils/capabilities/capabilityContract';
const [fixturePath, statePath, action] = process.argv.slice(2);
assert.ok(fixturePath && statePath && ['prepare', 'replace', 'conflict', 'inspect', 'cleanup'].includes(action));
assert.equal((await stat(fixturePath)).mode & 0o077, 0);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8')), base = new URL(fixture.base);
assert.equal(base.protocol, 'http:'); assert.ok(['localhost', '127.0.0.1'].includes(base.hostname)); assert.equal(base.origin, fixture.base);
const cookies = new Map<string, string>();
const sessionFetch: typeof fetch = async (url, init = {}) => {
    const target = new URL(String(url), base), headers = new Headers(init.headers);
    if (target.origin === base.origin && init.credentials !== 'omit') {
        headers.set('Origin', base.origin); headers.set('Cookie', [...cookies].map(([k,v]) => k + '=' + v).join('; '));
    }
    const response = await fetch(target, { ...init, headers, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(30_000) });
    if (target.origin === base.origin && init.credentials !== 'omit') for (const value of response.headers.getSetCookie()) {
        const pair = value.split(';')[0], at = pair.indexOf('='); cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return response;
};
async function api(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', allowMissing = false) {
    const response = await sessionFetch(new URL(path, base), { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (allowMissing && response.status === 404) return null;
    assert.equal(response.status, 200, path.split('?')[0] + ': ' + (response.ok ? '' : (await response.text()).slice(0, 180)));
    return response.json();
}
await api('/api/v1/login', { username: fixture.username, password: fixture.password });
assert.equal((await api('/api/v1/auth/me')).user.id, fixture.userId);
let state: any;
const save = () => writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
if (await stat(statePath).then(() => true, () => false)) {
    assert.equal((await stat(statePath)).mode & 0o077, 0); state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(state.ownerId, fixture.userId); assert.equal(state.origin, base.origin); assert.ok(!state.cleaned);
} else {
    assert.equal(action, 'prepare');
    state = { version: 1, origin: base.origin, ownerId: fixture.userId, rootId: randomUUID(), nestedId: randomUUID(), name: 'Mobile download acceptance', files: [] };
    await save();
}
if (action === 'prepare') {
    let root = await api('/api/v1/things?id=' + state.rootId, undefined, 'GET', true);
    if (!root) root = await api('/api/v1/things', { shareId: state.rootId, thingtime: ['folder'], crystal: { name: state.name }, acl: ['tt:user'] });
    assert.equal(root.thing.id, state.rootId); assert.equal(root.thing.author.id, fixture.userId); assert.equal(root.thing.crystal.name, state.name);
    await api('/api/v1/files', { kind: 'folder', id: state.nestedId, operationId: state.nestedId, folderId: state.rootId, name: 'nested' });
}
const scope = { origin: base.origin, ownerId: fixture.userId, dataPlane: 'home', rootId: state.rootId, deviceId: 'installed-acceptance-seed' };
const runtime = { currentScope: () => scope, origin: () => base.origin, fetch: sessionFetch, requireCapability: async (feature: string, version: string) => {
    const manifest = await api('/.well-known/thingtime-capabilities.json'); assert.ok(capabilitySatisfies(manifest.features[feature]?.version, version));
} };
if (action === 'prepare' || action === 'replace' || action === 'conflict') {
    if (action === 'conflict') state.conflictGeneration = (state.conflictGeneration ?? 0) + 1;
    const paths = action === 'prepare' ? ['hello.txt', 'nested/sample.bin'] : action === 'conflict' ? ['hello.txt'] : ['nested/sample.bin'];
    for (const path of paths) {
        const bytes = action === 'conflict' ? new Uint8Array(32 + state.conflictGeneration).fill(83 + state.conflictGeneration) : path === 'hello.txt' ? new TextEncoder().encode('Hello from cloud\n') : new Uint8Array(8 * 1024 * 1024 + (action === 'replace' ? 31 : 17)).fill(action === 'replace' ? 59 : 37);
        const source = { size: bytes.length, check: () => {}, read: async (offset: number, length: number) => bytes.slice(offset, offset + length) };
        const old = state.files.find((f: any) => f.path === path), before = old ? (await api('/api/v1/files?id=' + old.id, undefined, 'GET', true))?.file ?? null : null;
        const operation = { id: before ? randomUUID() : old?.id ?? randomUUID(), confirmed: false, mutation: { kind: 'copy' as const, from: 'local' as const, path,
            source: { path, id: 'fixture-' + path, version: action, kind: 'file' as const, size: bytes.length, sha256: null, fingerprint: await fingerprintSource(source) },
            expectedTarget: before ? cloudFileSyncEntry(before, path) : null } };
        // Record the preallocated file ID before a request can be accepted.
        const file = { path, id: before?.id ?? operation.id, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
        state.files = [...state.files.filter((f: any) => f.path !== path), file]; await save();
        const receipt = await createCloudFileTransport(runtime, { operation, scope, folderId: path.includes('/') ? state.nestedId : state.rootId, before }).apply(source);
        assert.equal(receipt.entry?.id, file.id); console.log('Cloud fixture ready:', path, file.size, 'bytes', file.sha256);
    }
    console.log('Select cloud folder:', state.name, state.rootId);
} else if (action === 'inspect') {
    const inventory = (await api('/api/v1/files?rootId=' + state.rootId)).inventory;
    console.log(JSON.stringify({ ...state, inventory }, null, 2));
} else {
    for (const file of state.files) {
        const current = (await api('/api/v1/files?id=' + file.id)).file;
        if (!current.trashed) await api('/api/v1/files', { id: current.id, operationId: randomUUID(), expectedRevision: current.revision, name: current.name,
            folderId: current.folderId, attachmentId: current.content.attachmentId, contentVersion: current.content.version, trashed: true });
    }
    // An installed WebView can fail before its own cleanup. Recover only this
    // fixture's named connections, checking ownership and the exact remote root.
    const connections = new Set<string>();
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
        const page = await api('/api/v1/things?thingtime=file-sync&limit=50' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
        for (const thing of page.things) if (thing.crystal?.remoteFolderId === state.rootId && thing.crystal?.name === 'Android cloud download acceptance') {
            assert.equal(thing.author.id, fixture.userId); connections.add(thing.id);
        }
        cursor = page.nextCursor ?? undefined;
        if (cursor) { assert.ok(!seen.has(cursor)); seen.add(cursor); }
    } while (cursor);
    if (state.configurationId) connections.add(state.configurationId);
    for (const id of connections) await api('/api/v1/things?id=' + id, undefined, 'DELETE', true);
    await api('/api/v1/things?id=' + state.nestedId, undefined, 'DELETE', true);
    await api('/api/v1/things?id=' + state.rootId, undefined, 'DELETE', true);
    state.cleaned = true; await save();
    console.log('Fixture folders/configuration removed; accounted file versions retained in private Trash.');
}
await api('/api/v1/auth/accounts/remove', { userId: fixture.userId });
