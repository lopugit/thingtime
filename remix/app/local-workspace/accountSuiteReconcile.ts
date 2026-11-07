import type { InstallSuiteResult } from '../schemas/suiteInstallation';
import { rewriteComposition } from '../api/utils/actions/forkCompositionCore';
import { compositionReferences } from '../api/utils/actions/sharedCompositionCore';
import { snapshotTransferValue } from '../utils/thingTransfer/value';
import { postThingReferences } from '../components/Feed/postThingReferences';
import { ACCOUNT_SUITE_PARTS, installedSuiteIds, type AccountSuiteIntent, type SuitePartHold } from './accountSuites';
import { ACCOUNT_SUITE_ALIASES, accountSuiteAliases } from './accountSuiteIdentity';
import { recordAccountSuiteAdoptions } from './accountTimeline';
import type { AccountThing, AccountSyncRecord } from './accountSync';
import type { LocalThing } from './things';
import { WorkspaceError, type WorkspaceScope, type WorkspaceTransaction } from './storage';

const stable = (input: unknown): string => JSON.stringify(input, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
	? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
const fail = (message: string): never => { throw new WorkspaceError('SUITE_RECONCILE_CONFLICT', message, 409); };
const waiting = (message: string): never => { throw new WorkspaceError('SUITE_RECONCILE_PENDING', message, 503); };
const fields = ['thingtime', 'crystal', 'extended', 'tags', 'folderId', 'targetId'] as const;
export const ACCOUNT_SUITE_CONFLICTS = 'account-suite-conflicts';
export type AccountSuiteConflict = {
	id:string;requestId:string;provisional:AccountThing;canonical:AccountThing|null;authoritative:AccountThing;
	reason:'audience-overlap'|'content-overlap';
};
const content = (row: LocalThing) => Object.fromEntries(fields.map(key => [key, row[key] ?? (key === 'tags' ? [] : null)]));
/** Apply only device changes since admission. An untouched bundled default
 * must never replace a customized definition discovered in the account. */
function delta(base: any, local: any, remote: any, conflict: { value: boolean }): any {
	if (stable(base) === stable(local)) return remote === undefined ? undefined : snapshotTransferValue(remote);
	if (base && local && remote && [base, local, remote].every(value => typeof value === 'object' && !Array.isArray(value))) {
		const next: any = snapshotTransferValue(remote);
		for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
			if (stable(base[key]) === stable(local[key])) continue;
			if (!(key in local)) { if (stable(remote[key]) !== stable(base[key])) conflict.value = true; delete next[key]; }
			else next[key] = delta(base[key], local[key], remote[key], conflict);
		}
		return next;
	}
	if (stable(remote) !== stable(base) && stable(remote) !== stable(local)) conflict.value = true;
	return snapshotTransferValue(local);
}
type SuiteReferenceThing = Pick<LocalThing,'id'|'thingtime'|'crystal'> & Partial<Pick<LocalThing,'folderId'|'targetId'>>;
export function remapSuiteThing<T extends SuiteReferenceThing>(row: T, ids: ReadonlyMap<string, string>): T {
	const resolve = (id: string) => ids.get(id) || id;
	const crystal = rewriteComposition(row.thingtime, row.crystal, (_kind, id) => resolve(id));
	// The explicit saved renderer and author-curated post Things use the same
	// identifiers as Builder compositions, without touching arbitrary strings.
	if (typeof crystal.renderComponent === 'string') crystal.renderComponent = resolve(crystal.renderComponent);
	else if (crystal.renderComponent && typeof crystal.renderComponent.id === 'string') crystal.renderComponent.id = resolve(crystal.renderComponent.id);
	if (postThingReferences(crystal.thing).length) crystal.thing.items = crystal.thing.items.map((item: any) => ({ ...item, id: resolve(item.id) }));
	return { ...row, id: resolve(row.id), crystal,
		...(row.folderId ? { folderId: resolve(row.folderId) } : {}), ...(row.targetId ? { targetId: resolve(row.targetId) } : {}) };
}
export const suiteThingReferences = (row: Pick<LocalThing, 'thingtime' | 'crystal' | 'folderId' | 'targetId'>): string[] => [
	row.folderId, row.targetId, ...compositionReferences(row.thingtime || [], row.crystal || {}).map(ref => ref.ref),
	...postThingReferences(row.crystal?.thing).map(ref => ref.id),
	typeof row.crystal?.renderComponent === 'string' ? row.crystal.renderComponent : (row.crystal?.renderComponent as any)?.id
].filter((id): id is string => typeof id === 'string');

/** Admission happens before holds so an older uncertain request can finish
 * normally. Holding first and waiting for that same request would deadlock. */
export async function assertAccountSuiteAdmission(tx: WorkspaceTransaction, ids: ReadonlySet<string>): Promise<void> {
	for (const { value } of await tx.list<AccountSyncRecord>('thing-sync')) {
		if (!value.pending && !value.claim) continue;
		const row = await tx.get<LocalThing>(value.deleted ? 'thing-deletions' : 'things',value.id);
		if (ids.has(value.id) || [value.pending?.body,row].some(row=>row && suiteThingReferences(row as any).some(id=>ids.has(id))))
			throw new WorkspaceError('SUITE_WRITE_IN_FLIGHT','A suite part or consumer is completing its original account operation. Retry installation after it finishes.',409);
	}
	for (const { id, value } of await tx.list<any>('account-interactions')) if (ids.has(id) && (value.pending || value.claim))
		throw new WorkspaceError('SUITE_WRITE_IN_FLIGHT','An interaction on this suite is completing its original account operation.',409);
	for (const { id, value } of await tx.list<any>('account-files')) {
		const target=value.retainedTargetId||value.deletingLocal?.targetId||(await tx.get<LocalThing>('things',id))?.targetId;
		if (target && ids.has(target) && (value.claim || value.deleteRequested)) throw new WorkspaceError('SUITE_WRITE_IN_FLIGHT','A suite file binding is completing its original account operation.',409);
	}
	for (const { id, value } of await tx.list<any>('account-drafts')) if (value.pending || value.claim) {
		const draft=(await tx.get<any>('drafts',id))?.draft, frozen=value.pending?.command?.content||draft;
		if(frozen&&[...ids].some(id=>frozen.context?.split(':').includes(id)||frozen.snapshot?.includes(JSON.stringify(id))))
			throw new WorkspaceError('SUITE_WRITE_IN_FLIGHT','A suite editor draft is completing its original account operation.',409);
	}
}

type Context = { scope: Extract<WorkspaceScope, { kind: 'account' }>; checked(row: AccountThing): AccountThing; now(): number };
/** All validation and adoption happens in the suite intent's claim/lease-fenced
 * transaction. A refusal rolls back everything and leaves all parts held. */
export async function reconcileAccountSuite(tx: WorkspaceTransaction, intent: Readonly<AccountSuiteIntent>, remote: InstallSuiteResult, context: Context): Promise<void> {
	const { scope } = context, receipt = remote.receipt;
	if (!receipt || receipt.ownerId !== scope.ownerId || receipt.origin !== scope.origin || receipt.dataPlane !== scope.dataPlane || receipt.requestId !== intent.request.requestId || receipt.bundleVersion !== intent.request.bundleVersion)
		fail('The suite receipt belongs to a different workspace or operation.');
	const ids = new Map<string, string>(), kinds = new Map<string, string>();
	for (const [group, kind] of [['schemaIds', 'schema'], ['componentIds', 'component'], ['actionIds', 'action'], ['pageIds', 'webpage']] as const)
		for (const [key, id] of Object.entries(intent.local[group])) { ids.set(id, remote[group][key]); kinds.set(id, kind); }
	intent.local.dataIds.forEach((id, index) => { ids.set(id, remote.dataIds[index]); kinds.set(id, 'data'); });
	if (ids.size !== installedSuiteIds(intent.local).length || [...ids.values()].some(id => typeof id !== 'string' || !id) || new Set(ids.values()).size !== ids.size)
		fail('The canonical suite mapping is incomplete or ambiguous.');
	const remotes = new Map(receipt.snapshots.map(row => { const checked = context.checked(row as unknown as AccountThing); return [checked.id, checked]; }));
	if (remotes.size !== ids.size || [...ids.values()].some(id => !remotes.has(id))) fail('The suite snapshots do not match its canonical identities.');
	const baseline = new Map(intent.baseline.map(row => [row.id, row])), rows = new Map((await tx.list<LocalThing>('things')).map(({ value }) => [value.id, value]));
	const states = new Map((await tx.list<AccountSyncRecord>('thing-sync')).map(({ value }) => [value.id, value]));
	for(const id of ids.keys())if(states.get(id)?.deleted){const deleted=await tx.get<LocalThing>('thing-deletions',id);if(deleted)rows.set(id,deleted);}
	const aliases = await accountSuiteAliases(tx);
	for (const [id, canonicalId] of ids) {
		const held = await tx.get<SuitePartHold>(ACCOUNT_SUITE_PARTS, id), state = states.get(id), local = rows.get(id), base = baseline.get(id), authoritative = remotes.get(canonicalId)!;
		if (!held || held.key !== intent.key || held.requestId !== intent.request.requestId || !state || !base || !local)
			fail('A held suite definition was removed or its identity changed.');
		if (state.pending || state.claim) waiting('A suite definition has an unresolved immutable account operation.');
		if (!authoritative.thingtime.includes(kinds.get(id)!)) fail('A suite snapshot has a different semantic kind.');
		if (aliases.has(id) && aliases.get(id) !== canonicalId) fail('A suite definition already has another canonical identity.');
		if (canonicalId !== id && aliases.has(canonicalId)) fail('A canonical suite ID is already a provisional alias.');
		const canonicalState = states.get(canonicalId), canonicalRow = rows.get(canonicalId);
		if (canonicalId !== id && (canonicalRow || canonicalState)) {
			if (!canonicalRow || !canonicalState?.base || canonicalState.deleted) fail('The canonical definition has independent device state requiring conflict review.');
			if (canonicalState.pending || canonicalState.claim) waiting('A canonical account definition is completing its original immutable operation.');
			if (!canonicalRow.thingtime.includes(kinds.get(id)!)) fail('The cached canonical definition has another semantic kind.');
		}
		if (state.base && state.base.id !== canonicalId) fail('A previously synchronized definition cannot change account identity.');
		// The receipt identifies the installation commit, not today's latest
		// revision. A newer verified read is a valid CAS baseline and survives
		// lost-reply replay without mutating the frozen receipt itself.
		const known = canonicalState?.base || state.base;
		if (known && Date.parse(known.updatedAt) > Date.parse(authoritative.updatedAt)) remotes.set(canonicalId, context.checked(known));
	}
	const changedIds = new Map([...ids].filter(([id, canonical]) => id !== canonical));
	// Frozen requests are never rewritten. This includes consumers outside the
	// suite; an uncertain old request must resolve before identity adoption.
	for (const state of states.values()) if (state.pending || state.claim) {
		const body = state.pending?.body;
		if (changedIds.has(state.id) || (body && suiteThingReferences(body as any).some(id => changedIds.has(id))) || (rows.get(state.id) && suiteThingReferences(rows.get(state.id)!).some(id => changedIds.has(id))))
			waiting('An affected account write must finish before suite identities can be adopted.');
	}
	const nextRows = new Map<string, LocalThing>(), conflicts = new Set<string>(), audiences = new Map<string,AccountSyncRecord['audience']>();
	for (const row of rows.values()) {
		if (!ids.has(row.id) && [...ids.values()].includes(row.id)) continue;
		if (ids.has(row.id)) {
			const state = states.get(row.id)!, authoritative = remotes.get(ids.get(row.id)!)!;
			const before = remapSuiteThing(state.base || baseline.get(row.id)!, ids), local = remapSuiteThing(row, ids);
			const canonicalState = states.get(authoritative.id), canonicalRow = rows.get(authoritative.id);
			const conflict = { value: false };
			const canonicalContent = authoritative.id !== row.id && canonicalState?.base && canonicalRow ? delta(content(canonicalState.base),content(canonicalRow),content(authoritative),conflict) : content(authoritative);
			const independent = !state.base && !intent.createdIds.includes(row.id);
			const merged = independent ? content(local) : delta(content(before), content(local), canonicalContent, conflict);
			if(independent && stable(content(local))!==stable(canonicalContent))conflict.value=true;
			if(state.deleted && stable(content(before))!==stable(canonicalContent))conflict.value=true;
			const remoteAudience = {acl:authoritative.acl,visibility:authoritative.visibility};
			const canonicalAudience = authoritative.id !== row.id && canonicalState?.base ? delta({acl:canonicalState.base.acl,visibility:canonicalState.base.visibility},canonicalState.audience,remoteAudience,conflict) : remoteAudience;
			const audienceConflict={value:false};
			const mergedAudience=delta({acl:state.base?.acl||['tt:user'],visibility:state.base?.visibility||'private'},state.audience,canonicalAudience,audienceConflict);
			if(audienceConflict.value)conflict.value=true;
			audiences.set(row.id,audienceConflict.value?canonicalAudience:mergedAudience);
			if(conflict.value)await tx.put(ACCOUNT_SUITE_CONFLICTS,authoritative.id,{
				id:authoritative.id,requestId:intent.request.requestId,
				provisional:{...local,...state.audience,author:{id:scope.ownerId}},canonical:canonicalRow?{...remapSuiteThing(canonicalRow,ids),...canonicalState?.audience,author:{id:scope.ownerId}}:null,
				authoritative,reason:audienceConflict.value?'audience-overlap':'content-overlap'
			} satisfies AccountSuiteConflict);
			if (conflict.value) conflicts.add(row.id);
			const next = context.checked({ ...authoritative, ...merged } as AccountThing);
			nextRows.set(row.id, { ...next, revision: Math.max(row.revision,canonicalRow?.revision||0) + 1, updatedAt: new Date(Math.max(context.now(), Date.parse(row.updatedAt) + 1, Date.parse(canonicalRow?.updatedAt||'')||0, Date.parse(authoritative.updatedAt))).toISOString() });
		} else {
			const next = remapSuiteThing(row, changedIds);
			if (stable(next) !== stable(row)) nextRows.set(row.id, { ...next, revision: row.revision + 1, updatedAt: new Date(Math.max(context.now(), Date.parse(row.updatedAt) + 1)).toISOString() });
		}
	}
	await reconcileAuxiliary(tx, changedIds, context.now());
	for (const [id, next] of nextRows) {
		const state = states.get(id);
		if (state) {
			const base = ids.has(id) ? remotes.get(ids.get(id)!)! : state.base;
			const canonicalState = next.id !== id ? states.get(next.id) : undefined;
			const audience = audiences.get(id) || state.audience;
			const syncState = conflicts.has(id) || state.state === 'conflict' || canonicalState?.state === 'conflict' ? 'conflict' : state.state === 'error' || canonicalState?.state === 'error' ? 'error' : base && stable(content(next)) === stable(content(base)) && stable(audience) === stable({ acl: base.acl, visibility: base.visibility }) ? 'synced' : 'pending';
			await tx.put('thing-sync', next.id, { ...state, id: next.id, base, audience, ...(state.deleted?{deleted:{id:next.id,revision:next.revision,updatedAt:next.updatedAt}}:{}), state: state.deleted&&syncState==='synced'?'pending':syncState, claim: undefined, attempts: 0, retryAt: 0, error: syncState === 'conflict' ? 'Device edits overlap the existing account suite definition. Compare both versions before syncing.' : syncState === 'error' ? state.error : undefined });
			if (id !== next.id) await tx.delete('thing-sync', id);
		}
		await tx.put(state?.deleted?'thing-deletions':'things', next.id, next);
		if(state?.deleted)await tx.delete('things',next.id);
		if (id !== next.id) await tx.delete('things', id);
		if (id !== next.id && state?.deleted) await tx.delete('thing-deletions',id);
	}
	for (const [id, canonicalId] of changedIds) await tx.put(ACCOUNT_SUITE_ALIASES, id, { id, canonicalId, requestId: intent.request.requestId });
	const adoptions=new Map<string,{before:LocalThing;after:LocalThing|null}>();
	for(const [id,after] of nextRows)if(ids.has(id)){
		// The canonical row may have been edited independently while the suite
		// request was in flight. Its actual pre-transaction revision/audience is
		// the undo boundary, not the older immutable installation receipt.
		const existing=rows.get(after.id), priorState=states.get(after.id), current=await tx.get<AccountSyncRecord>('thing-sync',after.id);
		const before=existing?{...existing,...priorState?.audience}:remotes.get(after.id)!;
		adoptions.set(after.id,{before,after:states.get(id)?.deleted?null:{...after,...current?.audience}});
	}
	await recordAccountSuiteAdoptions(tx, scope, adoptions, () => new Date(context.now()).toISOString(), () => crypto.randomUUID());
}

async function reconcileAuxiliary(tx: WorkspaceTransaction, ids: ReadonlyMap<string, string>, now: number) {
	const map = (id: string) => ids.get(id) || id;
	// Deletion recovery snapshots are mutable device intent, unlike immutable
	// History events. Keep their placement and reference graph canonical too.
	for (const { id, value } of await tx.list<LocalThing>('thing-deletions')) {
		const next = remapSuiteThing(value, ids);
		if (stable(next) === stable(value)) continue;
		const state = await tx.get<AccountSyncRecord>('thing-sync', id);
		if (state?.pending || state?.claim) waiting('A deleted consumer is completing its immutable account operation.');
		const updated = { ...next, revision: value.revision + 1, updatedAt: new Date(Math.max(now, Date.parse(value.updatedAt) + 1)).toISOString() };
		await tx.put('thing-deletions', updated.id, updated);
		if (id !== updated.id) await tx.delete('thing-deletions', id);
		if (state) await tx.put('thing-sync', updated.id, { ...state, id: updated.id, deleted: { id: updated.id, revision: updated.revision, updatedAt: updated.updatedAt } });
	}
	for (const { id, value } of await tx.list<any>('account-interactions')) if (ids.has(id)) {
		if (value.pending || value.claim || await tx.get('account-interactions', map(id))) fail('An affected interaction has unresolved account state.');
		await tx.put('account-interactions', map(id), { ...value, id: map(id), base: null, observed: undefined, version: value.version + 1, state: 'pending', retryAt: 0, attempts: 0 });
		await tx.delete('account-interactions', id);
	}
	for (const { id, value } of await tx.list<any>('account-files')) {
		const target = value.retainedTargetId || value.deletingLocal?.targetId || (await tx.get<LocalThing>('things', id))?.targetId;
		if (!target || !ids.has(target)) continue;
		if (value.claim || value.parentDeletion || value.deleteRequested || value.source === 'account') fail('A retained or active file binding requires its original account parent.');
		await tx.put('account-files', id, { ...value, ...(value.retainedTargetId ? { retainedTargetId: map(value.retainedTargetId) } : {}), ...(value.deletingLocal ? { deletingLocal: remapSuiteThing(value.deletingLocal, ids) } : {}) });
	}
	for (const { id, value } of await tx.list<any>('drafts')) {
		const draft = value.draft; let parsed: any;
		try { parsed = JSON.parse(draft.snapshot); } catch { continue; }
		const original = stable(parsed), context = draft.context.split(':').map(map).join(':');
		if (Array.isArray(parsed?.thingtime) && parsed.crystal) parsed = remapSuiteThing(parsed, ids);
		else if (draft.surface === 'definition' && Array.isArray(parsed?.blocks)) {
			parsed = { ...parsed, blocks: remapSuiteThing({id:'page-draft',thingtime:['webpage'],crystal:{blocks:parsed.blocks}},ids).crystal.blocks };
		} else if (draft.surface === 'definition' && typeof parsed?.source === 'string' && draft.context.startsWith('definition:')) {
			const target = draft.context.slice('definition:'.length), thing = await tx.get<LocalThing>('things',target);
			if (thing) {
				// DefinitionEditor intentionally retains partially written JSON.
				// Keep that source intact when it cannot yet be parsed; its stale
				// baseUpdatedAt will require review before the normal writer saves.
				let crystal: any; try { crystal = JSON.parse(parsed.source); } catch { crystal = null; }
				if (crystal && typeof crystal === 'object' && !Array.isArray(crystal)) {
					const mapped = remapSuiteThing({...thing,crystal},ids).crystal;
					if (stable(crystal) !== stable(mapped)) parsed = {...parsed,source:JSON.stringify(mapped)};
				}
			}
		} else if (['post','comment'].includes(draft.surface) && Array.isArray(parsed?.pickedThings)) {
			parsed = {...parsed,pickedThings:parsed.pickedThings.map((item:any)=>({...item,id:map(item.id)}))};
		}
		const source = value.source?.id && ids.has(value.source.id) ? { ...value.source, id: map(value.source.id) } : value.source;
		if (context === draft.context && stable(parsed) === original && source === value.source) continue;
		const state = await tx.get<any>('account-drafts', id);
		if (state?.pending || state?.claim) waiting('An affected editor draft is completing its original immutable account request.');
		const revision = draft.revision + 1;
		await tx.put('drafts', id, { ...value, source, draft: { ...draft, context, snapshot: JSON.stringify(parsed), revision, updatedAt: new Date(now).toISOString() } });
		if (state) await tx.put('account-drafts', id, { ...state, version: revision, state: 'pending', retryAt: 0, mutationAt: now });
	}
}
