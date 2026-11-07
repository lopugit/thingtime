import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { WorkspaceDatabase, type WorkspaceLease } from './storage';
import { LocalPasswordVault } from './passwordVault';

const base = process.env.TT_PASSWORD_CAPACITY_URL;
const fixturePath = process.env.TT_PASSWORD_CAPACITY_FIXTURE;
const evidencePath = process.env.TT_PASSWORD_CAPACITY_EVIDENCE;

test('large device values round-trip through the real private account API', { skip: !base || !fixturePath, timeout: 90_000 }, async () => {
  const origin = new URL(base!).origin;
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
  const fixture = JSON.parse(await readFile(fixturePath!, 'utf8'));
  assert.equal(fixture.fixtureKind, 'password-file-sync-qa');
  assert.match(fixture.username, /^passwordfiles-[a-f0-9]{8}$/);
  const endpoint = new URL('/api/v1/passwords', origin);
  const login = await fetch(new URL('/api/v1/login', origin), {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: fixture.username, password: fixture.password }), signal: AbortSignal.timeout(20_000)
  });
  assert.equal(login.status, 200);
  // This session belongs only to the disposable loopback fixture. Never print
  // or persist its cookie, credentials, or response bodies in test evidence.
  const cookie = login.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
  assert.ok(cookie);
  const api = async (input: object, allowMissing = false) => {
    const response = await fetch(endpoint, { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedOwnerId: fixture.ownerId, ...input }), signal: AbortSignal.timeout(20_000) });
    if (allowMissing && response.status === 404) return null;
    assert.equal(response.status, 200, `Password operation failed with HTTP ${response.status}`);
    assert.match(response.headers.get('Cache-Control') ?? '', /private.*no-store/);
    const result = await response.json(); assert.equal(result.ok, true); assert.equal(result.ownerId, fixture.ownerId); return result;
  };
  const db = new WorkspaceDatabase(new IDBFactory(), crypto.randomUUID(), 10_000, IDBKeyRange);
  const lease: WorkspaceLease = { assertCurrent() {}, onInvalidate() { return () => {}; } };
  const vault = new LocalPasswordVault(db, { kind: 'anonymous' }, lease, origin);
  const id = crypto.randomUUID(), writeId = crypto.randomUUID();
  const entry = { title: 'Disposable large-value parity fixture', passwordType: 'secure-note' as const,
    fields: [{ id: 'notes', label: 'Exact note', type: 'notes' as const, value: 'exact synthetic 🦄\n  '.repeat(100_000) }] };
  let attempted = false, revision = 0, cleaned = false, verified = false;
  try {
    await vault.unlock('Disposable local capacity fixture passphrase', true);
    await vault.save({ id, writeId, revision: 0, entry });
    const local = await vault.fileStorage().exportPage();
    assert.deepEqual(local.entries.map(row => row.entry), [entry]);
    attempted = true;
    const saved = await api({ operation: 'save', id, writeId, revision: 0, entry: local.entries[0].entry });
    revision = saved.record.revision;
    const replay = await api({ operation: 'save', id, writeId, revision: 0, entry });
    assert.equal(replay.record.revision, revision);
    const remote = await api({ operation: 'read', id }); assert.deepEqual(remote.entry, entry);
    await vault.save({ id, writeId: crypto.randomUUID(), revision: 1, entry: remote.entry });
    vault.lock(); await vault.unlock('Disposable local capacity fixture passphrase');
    assert.deepEqual((await vault.read(id)).entry, entry);
    const anonymous = await fetch(endpoint, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'read', id, expectedOwnerId: fixture.ownerId }), signal: AbortSignal.timeout(20_000) });
    assert.equal(anonymous.status, 401);
    verified = true;
  } finally {
    try {
      if (attempted) {
        // Only the UUID minted above is eligible for cleanup, including after
        // an uncertain save response. Never enumerate or delete other entries.
        if (!revision) revision = (await api({ operation: 'read', id }, true))?.revision ?? 0;
        if (revision) await api({ operation: 'delete', id, revision });
        cleaned = true;
      }
    } finally {
      vault.dispose(); await db.close();
      if (evidencePath) await writeFile(evidencePath, JSON.stringify({ localApi: true, nativeBrowser: false, verified, cleaned,
        plaintextBytes: new TextEncoder().encode(JSON.stringify(entry)).byteLength }, null, 2));
    }
  }
  assert.equal(cleaned, true);
});
