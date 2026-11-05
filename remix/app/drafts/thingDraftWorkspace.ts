import { decodeThingtime, stringifyThingtimeForStorage } from '../Providers/thingtimeSerialization';
import type { WorkspaceLease, WorkspaceScope } from '../local-workspace/storage';
import { validateDraftContent, type AccountDraft } from './draftCore';
import type { draftRequest } from './draftClient';
import { inspectDraftRecovery } from './draftRecovery';
import { createDraftSession, type DraftSaveState, type LocalDraft } from './draftSession';
import { workspaceDraftRecoveryKey, workspaceDraftRequest } from './workspaceDraft';

export class ThingDraftRecoveryError extends Error {}

const RESERVED = new Set(['tmp', 'settings', 'timemachine', 'set', 'get', '__proto__', 'prototype', 'constructor', 'tt', 'thingtime']);
export function validThingDraftPath(path: unknown): path is [string] {
 return Array.isArray(path) && path.length === 1 && typeof path[0] === 'string' && !!path[0] && !RESERVED.has(path[0]);
}
export function restoreThingDraft(snapshot: string) {
 const value = JSON.parse(snapshot);
 if (!value || !validThingDraftPath(value.path) || typeof value.serialized !== 'string') throw new Error('Invalid Thing draft');
 try { return { path: value.path as [string], value: decodeThingtime(value.serialized).value }; }
 catch { throw new Error('Invalid Thing draft serialization'); }
}

/** The generic Thing event adapter uses the same local draft protocol as the
 * other editors. Every session belongs to one captured workspace generation. */
export function createThingDraftWorkspace(options: {
 actor: string; origin: string; scope: WorkspaceScope; lease: WorkspaceLease;
 read: (key: string) => LocalDraft | null;
 persist: (key: string, draft: LocalDraft | null) => void;
 restore: (path: [string], value: unknown, recovery?: boolean) => void;
 changed: (status: DraftSaveState, error?: string) => void;
 uuid: () => string;
 request?: typeof draftRequest;
}) {
 const request = workspaceDraftRequest(options.lease, options.request);
 const sessions = new Map<string, ReturnType<typeof createDraftSession>>();
 const statuses = new Map<string, DraftSaveState>();
 let disposed = false;
 const assertCurrent = () => {
  options.lease.assertCurrent();
  if (disposed) throw new Error('This Thing editor has closed. Reopen it to continue.');
 };
 const leaseCurrent = () => { try { options.lease.assertCurrent(); return true; } catch { return false; } };
 const isCurrent = () => !disposed && leaseCurrent();
 const sessionFor = (path: [string]) => {
  assertCurrent();
  const context = `thing:${path[0]}`;
  const previous = sessions.get(context);
  if (previous) return previous;
  const key = workspaceDraftRecoveryKey(options.origin, options.actor, context, options.scope);
  let saved: LocalDraft | null;
  try { saved = options.read(key); }
  catch { throw new ThingDraftRecoveryError('The saved draft could not be read and has been kept. Draft saving is paused in this editor.'); }
  const recovery = inspectDraftRecovery(saved, snapshot => {
   if (restoreThingDraft(snapshot).path[0] !== path[0]) throw new Error('Draft target changed');
  });
  const recoveredContents = recovery.seed ? [recovery.seed.content, recovery.seed.pending?.content, recovery.seed.pendingCopy?.content].filter(Boolean) : [];
  if (recovery.error || recoveredContents.some(content => content!.surface !== 'thing' || content!.context !== context)) {
   throw new ThingDraftRecoveryError(recovery.error || 'The saved Thing draft belongs to another editor and has been kept.');
  }
  const session = createDraftSession({
   seed: recovery.seed, uuid: options.uuid,
   save: async input => (await request(options.actor, { operation: 'save', ...input })).draft,
   copy: async input => (await request(options.actor, { operation: 'recover', ...input })).draft,
   persist: value => { if (leaseCurrent()) options.persist(key, value); },
   changed: (status, error) => {
    if (!isCurrent()) return;
    statuses.set(context, status); options.changed(status, error);
   }
  });
  sessions.set(context, session);
  return session;
 };
 return {
  resume(path: unknown) {
   assertCurrent();
   if (!validThingDraftPath(path) || sessions.has(`thing:${path[0]}`)) return;
   const session = sessionFor(path), local = session.current();
   if (!local) return;
   // The immediate, scope-bound recovery copy can be newer than the whole
   // tree's debounced IndexedDB snapshot. Resume it once, after tree hydration,
   // before a later edit can replace it. Older unscoped keys are never adopted.
   const restored = restoreThingDraft(local.content.snapshot);
   options.restore(restored.path, restored.value, true);
   if (local.dirty !== false || local.pending || local.pendingCopy) void session.retry().catch(() => {});
   else options.changed('saved');
  },
  capture(path: unknown, value: unknown) {
   assertCurrent();
   if (!validThingDraftPath(path)) return;
   const content = validateDraftContent({ name: path[0].slice(0, 160), surface: 'thing', context: `thing:${path[0]}`,
    snapshot: JSON.stringify({ path, serialized: stringifyThingtimeForStorage(value) }), attachmentIds: [] });
   restoreThingDraft(content.snapshot);
   sessionFor(path).capture(content);
  },
  async load(draft: AccountDraft) {
   assertCurrent();
   if (draft.surface !== 'thing') throw new Error('Open this draft in its original editor');
   validateDraftContent(draft);
   const target = restoreThingDraft(draft.snapshot);
   if (draft.context !== `thing:${target.path[0]}`) throw new Error('Invalid Thing draft target');
   const session = sessionFor(target.path);
   await session.load(draft);
   assertCurrent();
   const latest = restoreThingDraft(session.current()?.content.snapshot || draft.snapshot);
   options.restore(latest.path, latest.value);
  },
  async flush() {
   assertCurrent(); await Promise.all([...sessions.values()].map(session => session.flush())); assertCurrent();
  },
  async retry() {
   assertCurrent();
   await Promise.all([...sessions.entries()].map(([key, session]) => statuses.get(key) === 'conflict' ? session.saveCopy() : session.retry()));
   assertCurrent();
  },
  async forget(id: string) {
   assertCurrent();
   for (const session of sessions.values()) if (session.current()?.id === id) {
    await session.clear(async () => {}); assertCurrent();
   }
  },
  dispose() {
   if (disposed) return;
   // Drain the last edit only through the captured lease. Same-workspace
   // navigation may finish saving its recovery copy; a retired workspace
   // cannot write or acknowledge into the next one. UI callbacks stop now.
   disposed = true;
   for (const session of sessions.values()) session.dispose();
  }
 };
}
