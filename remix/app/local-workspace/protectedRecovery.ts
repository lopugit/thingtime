import { themeContentSnapshot, themeContentValue, THEME_CONTENT_ADAPTER } from '../timeline/themeContent';
import { algorithmContentSnapshot, algorithmContentValue, ALGORITHM_CONTENT_ADAPTER } from '../timeline/algorithmContent';
import type { TimelineSnapshot } from '../timeline/contract';
import type { VersionContentAdapter } from '../timeline/versionPlan';
import { localTimelineEntry } from './timeline';
import { accountTimelineScope, readAccountTimelineRow } from './accountTimeline';
import type { LocalThing } from './things';
import { WorkspaceError, type WorkspaceScope, type WorkspaceTransaction } from './storage';

export type RecoverableProfile = 'theme' | 'feed-algorithm';
const fail = (message: string): never => { throw new WorkspaceError('PROTECTED_RECOVERY', message, 409); };
export const protectedRecoveryAdapter = (kind: RecoverableProfile) => kind === 'theme' ? THEME_CONTENT_ADAPTER : ALGORITHM_CONTENT_ADAPTER;

/** Rechecked inside the dedicated transaction. Never replace an uncertain delete,
 * adopt another family's intent, or escape the account's home plane. */
export async function assertProtectedRecoveryAllowed(tx: WorkspaceTransaction, scope: WorkspaceScope, id: string, kind: RecoverableProfile) {
 if (await tx.get('things', id)) fail('This item is already present. Refresh History before recovering it.');
 if (scope.kind !== 'account') return;
 if (scope.dataPlane !== 'home') fail('Recover account themes and algorithms from their home History.');
 const own = kind === 'theme' ? 'account-theme-sync' : 'account-algorithm-sync';
 const other = kind === 'theme' ? 'account-algorithm-sync' : 'account-theme-sync';
 if (await tx.get('thing-sync', id) || await tx.get(other, id)) fail('This identity belongs to another dedicated writer.');
 const state = await tx.get<{ deleted: boolean; state: string; baseVersion: string | null; base: unknown; pending?: unknown; claim?: unknown }>(own, id);
 if (!state || !state.deleted || state.state !== 'synced' || state.baseVersion !== null || state.base !== null || state.pending || state.claim)
  fail('Wait for the account deletion to be acknowledged before recovering this item. Device History is preserved.');
}

/** Exact approved projections. Sharing, lineage, observations and active pointers
 * never enter recovered content. Ordinary edits retain their separate policy. */
export function protectedRecoveryContent(snapshot: TimelineSnapshot, kind: RecoverableProfile): VersionContentAdapter {
 const parse = (value: TimelineSnapshot) => kind === 'theme' ? themeContentValue(value) : algorithmContentValue(value);
 const original = parse(snapshot);
 const make = (value: any) => kind === 'theme'
  ? themeContentSnapshot({ crystal: value.crystal, tags: [], visibility: 'private', folderId: value.folderId ?? null })
  : algorithmContentSnapshot({ crystal: value.crystal, folderId: value.folderId ?? null });
 const current = make(original);
 return { adapters: [protectedRecoveryAdapter(kind)], current,
  read(value) { if (!value) fail('This version has no recoverable design content.'); return parse(value!) as any; },
  snapshot: make
 };
}

export async function protectedRecoveryDocument(tx: WorkspaceTransaction, scope: WorkspaceScope, id: string, snapshot: TimelineSnapshot, kind: RecoverableProfile) {
 await assertProtectedRecoveryAllowed(tx, scope, id, kind);
 const content = protectedRecoveryContent(snapshot, kind), value = content.current.value as any;
 return { doc: { id, thingtime: [kind], crystal: structuredClone(value.crystal), ...(value.folderId ? { folderId: value.folderId } : {}),
  createdAt: '', updatedAt: '', revision: 0 } as LocalThing, content };
}

/** Even the internal dedicated writer requires the current recorded deletion. */
export async function recoveredProtectedRow(tx: WorkspaceTransaction, scope: WorkspaceScope, id: string, input: any, kind: RecoverableProfile, now: string): Promise<LocalThing> {
 await assertProtectedRecoveryAllowed(tx, scope, id, kind);
 const headId = await tx.get<string>('timeline-meta', `head:${id}`);
 const entry = headId ? scope.kind === 'anonymous' ? await localTimelineEntry(tx, headId) : await readAccountTimelineRow(tx, accountTimelineScope(scope), headId) : null;
 if (!entry || entry.event.thingId !== id || entry.event.operation !== 'delete' || entry.event.after !== null || entry.event.before?.adapter !== protectedRecoveryAdapter(kind))
  fail('The current recorded deletion is required for dedicated recovery.');
 protectedRecoveryContent(entry.event.before!, kind);
 const snapshot = kind === 'theme' ? themeContentSnapshot({ crystal: input.crystal, tags: [], visibility: 'private', folderId: input.folderId ?? null })
  : algorithmContentSnapshot({ crystal: input.crystal, folderId: input.folderId ?? null });
 const { doc } = await protectedRecoveryDocument(tx, scope, id, snapshot, kind);
 if (doc.folderId) {
  const folder = await tx.get<LocalThing>('things', doc.folderId);
  if (!folder || folder.thingtime.length !== 1 || folder.thingtime[0] !== 'folder') fail('The recovery folder changed. Refresh History and review again.');
 }
 return { ...doc, createdAt: now, updatedAt: now, revision: 1 };
}
