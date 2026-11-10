import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { stringifyThingtimeForStorage } from '../Providers/thingtimeSerialization';
import { LocalDrafts } from '../local-workspace/drafts';
import { WorkspaceDatabase, type WorkspaceScope } from '../local-workspace/storage';
import type { AccountDraft } from './draftCore';
import type { LocalDraft } from './draftSession';
import { createThingDraftWorkspace, restoreThingDraft } from './thingDraftWorkspace';
import { workspaceDraftRecoveryKey } from './workspaceDraft';

const origin = 'https://thingtime.example', actor = 'owner';
const home = { kind: 'account', origin, ownerId: actor, dataPlane: 'home' } as const;
const content = (text = 'My device draft') => ({ name: 'Notes', surface: 'thing' as const, context: 'thing:Notes',
 snapshot: JSON.stringify({ path: ['Notes'], serialized: stringifyThingtimeForStorage({ text }) }), attachmentIds: [] });
const saved = (text?: string): AccountDraft => ({ ...content(text), id: 'draft', revision: 1, mode: 'draft', createdAt: '', updatedAt: '' });
function fixture(scope: WorkspaceScope = home, storage = new Map<string, LocalDraft>()) {
 let active = true;
 const effects: unknown[] = [], restores: unknown[] = [], calls: unknown[] = [];
 const lease = { assertCurrent() { if (!active) throw new Error('Retired workspace'); }, onInvalidate: () => () => {} };
 const options = { actor, origin, scope, lease, uuid: randomUUID,
  read: (key: string) => storage.get(key) || null,
  persist: (key: string, value: LocalDraft | null) => { effects.push(['persist', key]); if (value) storage.set(key, structuredClone(value)); else storage.delete(key); },
  restore: (path: [string], value: unknown) => { restores.push([path, value]); },
  changed: (status: string, error?: string) => { effects.push([status, error]); },
  request: (async (_actor: string, input: any) => { calls.push(input); return { draft: { ...saved(), ...input.content, id: input.id, revision: input.revision + 1 } }; }) as any };
 return { options, effects, restores, calls, storage, retire: () => { active = false; } };
}

test('generic Thing draft recovery isolates account, origin and data plane while preserving codec values', async () => {
 const storage = new Map<string, LocalDraft>(), db = new WorkspaceDatabase(new IDBFactory());
 const first = fixture({ kind: 'anonymous' }, storage), local = new LocalDrafts(db, first.options.scope, first.options.lease);
 first.options.request = async (_actor: string, input: any, query: any) => local.request(input, query);
 const workspace = createThingDraftWorkspace(first.options);
 const value: any = { text: '2026-10-17', when: new Date('2026-10-17T00:00:00Z') }; value.self = value;
 try {
  workspace.capture(['Notes'], value);
  assert.equal(storage.size, 1, 'first keystroke is retained synchronously');
  await workspace.flush();
  const rows = (await local.request()).drafts; assert.equal(rows.length, 1);
  const draft = (await local.request(undefined, { id: rows[0].id })).draft;
  await workspace.load(draft);
  const restored = first.restores[0] as any;
  assert.equal(restored[1].text, value.text); assert.deepEqual(restored[1].when, value.when); assert.equal(restored[1].self, restored[1]);
  workspace.dispose();
  const reloaded = createThingDraftWorkspace(first.options);
  reloaded.capture(['Notes'], { text: 'Later edit after reload' }); await reloaded.flush();
  assert.equal((await local.request()).drafts[0].id, draft.id); reloaded.dispose();
  const scopes: WorkspaceScope[] = [home, { ...home, ownerId: 'other' }, { ...home, origin: 'https://other.example' }, { ...home, dataPlane: 'selected' }, { kind: 'anonymous' }];
  assert.equal(new Set(scopes.map(scope => workspaceDraftRecoveryKey(origin, actor, 'thing:Notes', scope))).size, scopes.length);
  const other = fixture(home, storage), otherWorkspace = createThingDraftWorkspace(other.options);
  otherWorkspace.capture(['Notes'], { text: 'Independent account draft' }); await otherWorkspace.flush();
  assert.equal(storage.size, 2); assert.notEqual((other.calls[0] as any).id, draft.id); otherWorkspace.dispose();
 } finally { workspace.dispose(); await db.close(); }
});

test('late saves and queued loads cannot restore, persist or retry through a retired workspace', async () => {
  const f = fixture(); let release!: (value: unknown) => void, started!: () => void;
  const startedPromise = new Promise<void>(resolve => { started = resolve; });
  f.options.request = async (_actor: string, input: unknown) => { f.calls.push(input); started(); return new Promise(resolve => { release = resolve; }); };
  const workspace = createThingDraftWorkspace(f.options);
  workspace.capture(['Notes'], { text: 'An edit before the identity change' });
  const loading = workspace.load(saved('Must not replace the next editor'));
  await startedPromise;
  const before = structuredClone([...f.storage]), effectCount = f.effects.length;
  f.retire(); release({ draft: saved() });
  await assert.rejects(loading, /Retired workspace/);
  assert.deepEqual([...f.storage], before); assert.equal(f.effects.length, effectCount); assert.deepEqual(f.restores, []);
  await assert.rejects(workspace.retry(), /Retired workspace/);
  assert.throws(() => workspace.capture(['Notes'], {}), /Retired workspace/); assert.equal(f.calls.length, 1);
  workspace.dispose();
});

test('closing a generic editor drains its last edit and acknowledges only its original recovery key', async () => {
 const f = fixture(), workspace = createThingDraftWorkspace(f.options);
 workspace.capture(['Notes'], { text: 'Last keystroke' }); workspace.dispose();
 await new Promise(resolve => setTimeout(resolve, 300));
 assert.equal(f.calls.length, 1); assert.equal(f.storage.size, 1);
 const retained = [...f.storage.values()][0]; assert.equal(retained.revision, 1); assert.equal(retained.pending, undefined);
 assert.equal(f.effects.filter((effect: any) => effect[0] === 'saved').length, 0, 'closed editor receives no UI completion');
 await assert.rejects(workspace.load(saved()), /closed/);
});

test('cold editor recovery resumes its current scoped copy once and never replays an old workspace or legacy key', async () => {
 const f = fixture(), key = workspaceDraftRecoveryKey(origin, actor, 'thing:Notes', home);
 const draft: LocalDraft = { id: 'draft', revision: 1, dirty: false, content: content('Latest acknowledged device text') };
 f.storage.set(key, draft);
 f.storage.set(`tt-account-draft:${origin}:${actor}:thing:Legacy`, { ...draft, content: { ...content(), context: 'thing:Legacy' } });
 const workspace = createThingDraftWorkspace(f.options);
 workspace.resume(['Notes']); workspace.resume(['Notes']); workspace.resume(['Legacy']);
 assert.deepEqual(f.restores, [[['Notes'], { text: 'Latest acknowledged device text' }]]);
 assert.equal(f.calls.length, 0, 'acknowledged recovery does not send another write');
 workspace.capture(['Notes'], { text: 'Newer typing' }); workspace.resume(['Notes']);
 assert.equal(f.restores.length, 1, 'remounting a window cannot replace newer typing');
 await workspace.flush(); workspace.dispose();
 const other = fixture({ ...home, dataPlane: 'other' }, f.storage), otherWorkspace = createThingDraftWorkspace(other.options);
 otherWorkspace.resume(['Notes']); assert.deepEqual(other.restores, []);
 other.retire(); assert.throws(() => otherWorkspace.resume(['Another']), /Retired/); otherWorkspace.dispose();
});

test('invalid recovery and forbidden Thing roots are preserved without writes or blank restoration', async () => {
 for (const bad of [
  { ...content(), snapshot: JSON.stringify({ path: ['Notes'], serialized: 'broken JSON' }) },
  { ...content(), snapshot: JSON.stringify({ path: ['Other'], serialized: '[null]' }) },
  { ...content(), surface: 'post' },
  { ...content(), context: 'thing:Other' }
 ]) {
  const f = fixture(), key = workspaceDraftRecoveryKey(origin, actor, 'thing:Notes', home);
  f.storage.set(key, { id: 'draft', revision: 0, content: bad as any });
  const before = structuredClone([...f.storage]), workspace = createThingDraftWorkspace(f.options);
  assert.throws(() => workspace.capture(['Notes'], { text: 'New edit' }), /kept/);
  assert.deepEqual([...f.storage], before); assert.equal(f.calls.length, 0); assert.deepEqual(f.restores, []); workspace.dispose();
 }
 const f = fixture(), workspace = createThingDraftWorkspace(f.options);
 for (const path of [['settings'], ['tt'], ['thingtime'], ['__proto__'], ['Notes', 'nested'], [], ['']]) {
  workspace.capture(path, {});
  await assert.rejects(workspace.load({ ...saved(), snapshot: JSON.stringify({ path, serialized: '[null]' }) }), /Invalid Thing draft/);
 }
 assert.equal(f.storage.size, 0); assert.equal(f.calls.length, 0);
 assert.throws(() => restoreThingDraft(JSON.stringify({ path: ['Notes'], serialized: '{}' })), /serialization/);
 workspace.dispose();
});

test('unreadable recovery JSON pauses writes instead of treating the key as empty', () => {
 const f = fixture(); f.options.read = () => { throw new SyntaxError('Invalid outer recovery JSON'); };
 const workspace = createThingDraftWorkspace(f.options);
 assert.throws(() => workspace.resume(['Notes']), /could not be read and has been kept/);
 assert.throws(() => workspace.capture(['Notes'], { text: 'Keep the original recovery' }), /could not be read and has been kept/);
 assert.equal(f.calls.length, 0); assert.deepEqual(f.effects, []); assert.deepEqual(f.restores, []); workspace.dispose();
});
