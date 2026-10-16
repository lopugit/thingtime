import { AccountFileSync } from './accountFiles';
import { localThingProjection } from './things';
import { clearLocalCache } from '../hooks/localCache';
import { AccountPostCache, overlayAccountPost } from './accountPosts';
import { AccountInteractionSync } from './accountInteractions';
import { withExportDeadline } from '../utils/thingTransfer/exportDeadline';
import { exportAccountThings, snapshotAccountExportInput } from './accountExport';
import { browseLocalDefinitions } from './definitionCatalog';
import { searchLocalThings } from './structuredSearch';
import { readWorkspaceSearchCursor, workspaceSearchCursor } from './searchCursor';
import { searchLocalLibrary } from './librarySearch';
import { validateThingtimeCrystal } from '../schemas/registry';
import { snapshotTransferValue } from '../utils/thingTransfer/value';
import { parseTransfer, serializeTransfer, validateTransfer } from '../utils/thingTransfer/format';
import { resolveWorkspacePage, type LocalWebpageTarget } from './webpageResolution';
import { accountWriteSupported, accountThingCanCache, AccountThingSync, type AccountThingWrite } from './accountSync';
import { accountThingTransport } from './accountTransport.client';
import { assertAccountSyncAllowed, canSyncAccountWorkspace, subscribeWorkspaceBinding, accountWorkspaceLease, accountRemoteWorkspaceLease, announceLocalWorkspaceChange, workspaceDatabase } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
import { WorkspaceError, workspaceScopeKey, type WorkspaceScope } from './storage';

export { accountThingCanCache } from './accountSync';

type AccountScope = Extract<WorkspaceScope, { kind: 'account' }>;
type Owner = { id: string; username?: string; displayName?: string; avatarUrl?: string | null };
const workers = new Map<string, ReturnType<typeof createWorker>>();
/** Matches the sync claim window: the longest a blocked pass must wait before
 * a crashed tab's lease expires and this tab can replay the frozen write. */
const BLOCKED_RETRY_MS = 60_000;
function createWorker(scope: AccountScope, dispose: () => void) {
	const lease = accountWorkspaceLease(scope), db = workspaceDatabase();
	const sync = new AccountThingSync(db, scope, lease), transport = accountThingTransport(scope, lease), interactions = new AccountInteractionSync(db, scope, lease), posts = new AccountPostCache(db, scope, lease), files = new AccountFileSync(db, scope, lease);
	const controller = new AbortController();
	let running = false, wakeRequested = false, timer: ReturnType<typeof setTimeout> | null = null, stopped = false;
	const wake = () => {
		if (stopped || navigator.onLine === false || !canSyncAccountWorkspace(scope)) return;
		if (running) { wakeRequested = true; return; }
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => { timer = null; void drain(); }, 0);
	};
	const drain = async () => {
		if (stopped || running || navigator.onLine === false || !canSyncAccountWorkspace(scope)) return;
		running = true;
		try {
			lease.assertCurrent();
			const before = JSON.stringify([await sync.status(), await interactions.status(), await files.status()]);
			const targets = new Map((await sync.exportSnapshot()).records.map(row => [row.id, row]));
			const outcomes = await Promise.all([sync.sync(transport, controller.signal), interactions.sync(transport.interactions, controller.signal, async id => {
				const record = targets.get(id);
				if (record?.deleted) { await interactions.discard([id]); return false; }
				return !record || record.remote;
			}), files.sync(transport.files, controller.signal, 3, async id => { const record = (await sync.exportSnapshot()).records.find(row => row.id === id); return !!record?.remote && !record.deleted; })]);
			const completed = outcomes.reduce((sum, result) => sum + result.completed, 0);
			const contentStatus = await sync.status(), interactionStatus = await interactions.status(), fileStatus = await files.status(), status = [...contentStatus, ...interactionStatus, ...fileStatus];
			if (JSON.stringify([contentStatus, interactionStatus, fileStatus]) !== before) announceLocalWorkspaceChange();
			const pending = status.filter(row => row.state === 'pending' || row.state === 'syncing');
			if (pending.length && !stopped) {
				// A row whose retryAt has already passed is not schedulable work: the
				// pass that just ran either claimed it or skipped it because another
				// tab holds the lease, or because its parent has no server version
				// yet. Re-polling those every second cannot unblock them, so only
				// keep the fast cadence while writes are actually completing and
				// otherwise wait out the claim window or an online/focus/bind event.
				const waits = pending.map(row => row.retryAt - Date.now()).filter(wait => wait > 0);
				const soonest = completed ? 0 : waits.length ? Math.min(...waits) : BLOCKED_RETRY_MS;
				timer = setTimeout(wake, Math.max(1000, Math.min(60_000, soonest)));
			}
		} catch { /* Identity changes retire this worker; durable writes stay scoped. */ }
		finally {
			running = false;
			// A local write or reconnect can arrive after the final status read.
			// Preserve that wake instead of leaving its new work indefinitely idle.
			if (wakeRequested) { wakeRequested = false; wake(); }
		}
	};
	const unsubscribe = lease.onInvalidate(() => stop());
	const unbind = subscribeWorkspaceBinding(wake);
	const stop = () => {
		if (stopped) return;
		stopped = true; controller.abort(); if (timer) clearTimeout(timer);
		window.removeEventListener('online', wake); window.removeEventListener('focus', wake); unsubscribe(); unbind(); dispose();
	};
	window.addEventListener('online', wake); window.addEventListener('focus', wake);
	return { sync, interactions, posts, files, transport, db, lease, wake, stop };
}
export const accountWorkspaceWorker = (scope: AccountScope) => {
	const key = `${workspaceScopeKey(scope)}:${rootIdentity.read().generation}`;
	let worker = workers.get(key);
	if (!worker) { worker = createWorker(scope, () => workers.delete(key)); workers.set(key, worker); }
	return worker;
};
/** Root-bound bootstrap, invoked in an effect, never during React rendering. */
export const startAccountWorkspaceSync = (scope: AccountScope) => { accountWorkspaceWorker(scope).wake(); };

export function accountApi<T extends Record<string, any>>(remote: T, owner: Owner, dataPlane: string): T {
	const scope: AccountScope = { kind: 'account', origin: window.location.origin, ownerId: owner.id, dataPlane };
	// Capture this facade's generation so a retained callback cannot adopt a
	// later account, even when a worker for that new session already exists.
	const facadeLease = accountWorkspaceLease(scope);
	const worker = () => { facadeLease.assertCurrent(); return accountWorkspaceWorker(scope); };
	const guard = (value: any): any => {
		// API methods are promise-based. Refusals must reject that promise so an
		// optional remote probe's .catch() can handle offline/unconfirmed identity
		// without throwing out of a React effect and unmounting the local screen.
		if (typeof value === 'function') return async (...args: any[]) => { facadeLease.assertCurrent(); assertAccountSyncAllowed(scope); return value(...args); };
		if (!value || typeof value !== 'object') return value;
		const wrapped = new Map<PropertyKey, unknown>();
		return new Proxy(value, { get(target, key) { if (!wrapped.has(key)) wrapped.set(key, guard(Reflect.get(target, key))); return wrapped.get(key); } });
	};
	const online = guard(remote) as T;

	const project = (thing: any) => thing ? { ...thing, author: owner } : thing;
	const projectFile = (thing: any) => project(localThingProjection(thing, owner.id));
	const localViews = async (ids: string[]) => {
		const { sync, files } = worker();
		const library = new Map((await files.views(ids)).map(row => [row.id, row]));
		const content = new Map((await sync.views(ids)).map(row => [row.id, row]));
		return ids.flatMap(id => library.has(id) ? [projectFile(library.get(id))] : content.has(id) ? [project(content.get(id))] : []);
	};
	const retainInteractionProjection = async (row: any, startedAt: number) => {
		if (!row || typeof row.id !== 'string' || !Array.isArray(row.viewerReactions) || !row.reactionCounts) return;
		const service = worker();
		await service.interactions.remember([{ id: row.id, revision: null, saved: !!(row.saved ?? row.viewerSaved), reactions: row.viewerReactions, reactionCounts: row.reactionCounts }], false, startedAt);
		const state = (await service.interactions.states()).find(state => state.id === row.id);
		if (state) Object.assign(row, { saved: state.saved, viewerSaved: state.saved, viewerReactions: state.reactions, reactionCounts: state.reactionCounts || {} });
	};
	const retainPosts = async (result: any, startedAt: number) => {
		const rows = [result.post, result.parent, result.root, ...(Array.isArray(result.posts) ? result.posts : [])].filter(Boolean);
		if (!rows.length) return result;
		try { await worker().posts.remember(rows, startedAt); }
		catch (error) { facadeLease.assertCurrent(); result.localCacheError = 'These posts could not be retained on this device. Retry online before going offline.'; }
		const pending = [...rows], seen = new Set<string>(), observed = [];
		while (pending.length && seen.size < 250) {
			const row = pending.shift(); if (!row || seen.has(row.id)) continue; seen.add(row.id);
			if (typeof row.id === 'string' && Array.isArray(row.viewerReactions) && row.reactionCounts) observed.push({id:row.id,revision:null,saved:!!row.viewerSaved,reactions:row.viewerReactions,reactionCounts:row.reactionCounts});
			pending.push(...(Array.isArray(row.comments) ? row.comments : []), ...(row.shareOf ? [row.shareOf] : []));
		}
		try { for (let offset=0;offset<observed.length;offset+=50) await worker().interactions.remember(observed.slice(offset,offset+50),false,startedAt); }
		catch { facadeLease.assertCurrent(); result.localCacheError = 'Post interactions could not be retained on this device. Retry online before going offline.'; }
		const states = new Map((await worker().interactions.states()).map(state => [state.id, state]));
		for (const key of ['post', 'parent', 'root']) if (result[key]) result[key] = overlayAccountPost(result[key], states);
		if (Array.isArray(result.posts)) result.posts = result.posts.map((post: any) => overlayAccountPost(post, states));
		return result;
	};
	const refresh = async (args: Record<string, unknown>, signal?: AbortSignal, retainPage?: (page: { ids: string[]; nextCursor: string | null }) => Promise<void>) => {
		const { sync, transport, lease } = worker();
		const startedAt = Date.now();
		const result = await transport.read(args, signal);
		lease.assertCurrent();
		// Page membership belongs to the authorized server snapshot. Keep deleted
		// IDs here; views hide tombstones and explicit conflict restoration can
		// reveal them again without losing membership in the cached page.
		const membership = Array.isArray(result.things) && result.things.every((thing: any) => accountThingCanCache(thing) && thing.author?.id === owner.id)
			? { ids: result.things.map((thing: any) => thing.id), nextCursor: result.nextCursor || null } : null;
		const retain = async (thing: any) => {
			if (!accountThingCanCache(thing) || thing.author?.id !== owner.id) return thing;
			await sync.remember(thing);
			return project(await sync.view(thing.id));
		};
		if (result.thing) result.thing = await retain(result.thing);
		if (result.things) result.things = (await Promise.all(result.things.map(retain))).filter(Boolean);
		await retainInteractionProjection(result.discussion, startedAt);
		if (membership && retainPage) await retainPage(membership);
		return retainPosts(result, startedAt);
	};
	const changed = () => { announceLocalWorkspaceChange(); worker().wake(); };
	const remove = async (ids: string[], expectedUpdatedAt: string | undefined, fallback: () => Promise<any>) => {
		facadeLease.assertCurrent();
		if (!Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length)
			throw new WorkspaceError('INVALID_IDS', 'Choose between 1 and 200 distinct Things.');
		const { sync } = worker();
		let dedicated = false; const cached: string[] = [];
		for (const id of ids) {
			if (await sync.isDeleted(id)) continue;
			if (!await sync.view(id)) {
				if (navigator.onLine === false || !canSyncAccountWorkspace(scope)) throw new WorkspaceError('LOCAL_CONTENT_MISSING', 'Open these Things online once before deleting them offline.', 409);
				const result = await refresh({ id });
				if (!result.thing || !accountThingCanCache(result.thing) || result.thing.author?.id !== owner.id) { dedicated = true; continue; }
			}
			cached.push(id);
		}
		if (dedicated) {
			// A mixed batch must never delete a cached device copy through the remote
			// adapter. Unlike a move, nothing later re-reads a Thing the server no
			// longer returns, so that copy would stay readable and editable here.
			if (cached.length) throw new WorkspaceError('UNSUPPORTED_LOCAL_DELETE', 'Delete saved device Things separately from items that require their dedicated online adapter.', 409);
			return fallback();
		}
		const remaining = [];
		for (const id of ids) if (!await sync.isDeleted(id)) remaining.push(id);
		const removed = remaining.length ? (await sync.remove(remaining, expectedUpdatedAt)).deleted : ids;
		await worker().interactions.discard(removed);
		announceLocalWorkspaceChange(removed); worker().wake();
		return { ok: true, savedLocally: true, succeeded: ids.length, failed: 0, results: ids.map(id => ({ id, ok: true })) };
	};
	// Explicit login/logout establish or revoke identity; other remote features require confirmation.
	const browse = (kind: 'schema' | 'component') => async (args: Record<string, unknown> = {}) => {
		facadeLease.assertCurrent();
		const { sync, transport } = worker();
		if (args.device !== true) {
			const result = await transport.browse(kind, args);
			const key = kind === 'schema' ? 'schemas' : 'components';
			if (!Array.isArray(result[key]) || result[key].length > 50) throw new WorkspaceError('INVALID_CATALOG', 'Invalid catalogue response.', 502);
			// Only authenticated owned content enters the editable device store.
			// Shared/system entries remain read-only response projections. Pending
			// edits and deletion tombstones retain priority over catalogue snapshots.
			const owned = result[key].filter((row: any) => accountThingCanCache(row) && row.thingtime.includes(kind) && row.author?.id === owner.id);
			const before = new Map((await sync.views(owned.map((row: any) => row.id))).map(row => [row.id, row.revision]));
			let changed = false;
			try {
				const retained = await sync.rememberMany(owned);
				changed = retained.some(row => row && row.revision !== before.get(row.id));
			} catch (error) {
				facadeLease.assertCurrent();
				result.localCacheError = `These account definitions could not be saved on this device: ${error instanceof Error ? error.message : 'Device storage failed'}. Retry the catalogue before going offline.`;
			}
			if (owned.length) {
				try { const retained = await worker().interactions.remember(await transport.interactions.read(owned.map((row: any) => row.id))); changed ||= retained; }
				catch {
					result.localCacheError = result.localCacheError || 'Account bookmarks and reactions could not be refreshed. Device choices are preserved; retry online to reconcile.';
					await worker().interactions.remember(owned.map((row: any) => ({ id: row.id, revision: null, saved: !!row.saved, reactions: row.viewerReactions || [], reactionCounts: row.reactionCounts || {} })), false).catch(() => {});
				}
			}
			const snapshot = await sync.viewSnapshot(owned.map((row: any) => row.id));
			const views = new Map(snapshot.rows.map(row => [row.id, project(row)])), deleted = snapshot.deleted;
			result[key] = result[key].filter((row: any) => !deleted.has(row.id)).map((row: any) => views.has(row.id) ? { ...row, ...views.get(row.id) } : row);
			const membership = new Map((await worker().interactions.states()).map(row => [row.id, row]));
			result[key] = result[key].map((row: any) => { const state = membership.get(row.id); return state ? { ...row, saved: state.saved, viewerReactions: state.reactions, reactionCounts: state.reactionCounts || {} } : row; });
			facadeLease.assertCurrent(); if (changed) announceLocalWorkspaceChange();
			return result;
		}
		const bundled = kind === 'component' ? (await import('../components/ComponentsLibrary/bundledComponentCatalog')).bundledComponentEntries() : [];
		facadeLease.assertCurrent();
		const result = await browseLocalDefinitions([...await sync.things.snapshot(), ...await worker().interactions.rows()], kind, args, workspaceScopeKey(scope), row => ({ id: row.id }), bundled);
		const key = kind === 'schema' ? 'schemas' : 'components', entries = result[key];
		const views = new Map((await sync.views(entries.map(row => row.id))).map(row => [row.id, project(row)]));
		const bundledIds = new Set(bundled.map(row => row.id));
		result[key] = entries.filter(row => views.has(row.id) || bundledIds.has(row.id)).map(row => views.has(row.id) ? { ...row, ...views.get(row.id) } : row);
		const membership = new Map((await worker().interactions.states()).map(row => [row.id, row]));
		result[key] = result[key].map((row: any) => { const state = membership.get(row.id); return state ? { ...row, saved: state.saved, viewerReactions: state.reactions, reactionCounts: state.reactionCounts || {} } : row; });
		facadeLease.assertCurrent(); return { ...result, incomplete: true };
	};
	const interact = async (kind: 'save' | 'reaction', args: { id: string; emoji?: unknown }) => {
		facadeLease.assertCurrent();
		const service = worker();
		const state = await service.interactions.toggle(kind, args.id, args.emoji); changed();
		return { ok: true, saved: state.saved, viewerReactions: state.reactions, reactionCounts: state.reactionCounts || {}, savedLocally: true };
	};
	const exportThings = async (input: Parameters<typeof exportAccountThings>[0], options?: { signal?: AbortSignal }) => {
			input = snapshotAccountExportInput(input);
			return withExportDeadline(async signal => {
				options = { ...options, signal };
				facadeLease.assertCurrent(); options?.signal?.throwIfAborted();
				const current = worker(), canRefresh = () => navigator.onLine !== false && canSyncAccountWorkspace(scope);
				if (!input.key) {
					for (const id of input.ids) if (!await current.sync.view(id) && !await current.sync.isDeleted(id)) {
						if (!canRefresh()) throw new WorkspaceError('LOCAL_CONTENT_MISSING', 'This Thing is not saved on this device. Open it online before downloading offline.', 409);
						await refresh({ id }, options?.signal);
						if (!await current.sync.view(id)) {
							if ((await current.sync.status()).some(row => row.state !== 'synced')) throw new WorkspaceError('DEDICATED_EXPORT_REQUIRED', 'Download device edits separately from content requiring its dedicated online adapter.', 409);
							return current.transport.export(input, options?.signal);
						}
					}
				}
				return exportAccountThings(input, { ...current, canRefresh, remote: (args, request) => current.transport.export(args, request?.signal) }, options?.signal);
			}, options?.signal);
		};
	const importThings = async (input: { manifest: unknown; folderId?: string | null; files?: Record<string, string>; localFiles?: Map<string, Uint8Array> }, options?: { signal?: AbortSignal }) => {
			facadeLease.assertCurrent(); options?.signal?.throwIfAborted();
			if (Object.keys(input || {}).some(key => !['manifest', 'folderId', 'files', 'localFiles'].includes(key))) throw new WorkspaceError('INVALID_IMPORT', 'Unsupported import options.');
			const manifest = parseTransfer(serializeTransfer(validateTransfer(input.manifest))), folderId = input.folderId;
			if (manifest.files.length || manifest.links?.length || !manifest.things.every(accountThingCanCache)) return online.things.import(input, options);
			if ((input.files !== undefined && (!input.files || typeof input.files !== 'object' || Array.isArray(input.files) || Object.keys(input.files).length)) ||
				(input.localFiles !== undefined && (!(input.localFiles instanceof Map) || input.localFiles.size))) throw new WorkspaceError('INVALID_IMPORT', 'This transfer contains no files.');
			if (folderId != null && (typeof folderId !== 'string' || !folderId.trim())) throw new WorkspaceError('INVALID_FOLDER', 'Choose an import destination.');
			const { sync } = worker();
			if (folderId && !await sync.view(folderId)) {
				if (navigator.onLine === false || !canSyncAccountWorkspace(scope)) throw new WorkspaceError('LOCAL_CONTENT_MISSING', 'Open the destination folder online once before importing offline.', 409);
				await refresh({ id: folderId }, options?.signal);
			}
			const result = await sync.things.import(manifest, folderId, undefined, options?.signal);
			changed();
			return { ok: true, roots: result.roots, ids: result.idMap, imported: result.things.length, filesImported: 0, linksImported: 0, savedLocally: true };
		};
	return { ...online, auth: remote.auth, login: remote.login,
		attachments: { ...online.attachments,
			annotate: async (input: { id: string; title?: string | null; description?: string | null; filenamePreview?: string | null }) => {
				if (!input.id?.startsWith('local-file-')) return online.attachments.annotate(input);
				const row = await worker().files.things.annotateFile(input); changed();
				return { ok: true, attachment: { id: row.id, ...row.crystal }, savedLocally: true };
			},
			deleteLocalFile: async ({ id }: { id: string }) => { await worker().files.remove(id); changed(); return { ok: true, savedLocally: true }; },
			cancelLocalFileUpload: async ({ id }: { id: string }) => { await worker().files.cancel(id); changed(); return { ok: true, savedLocally: true }; },
			moveLocalFile: async ({ id, folderId }: { id: string; folderId: string | null }) => {
				const current = worker();
				if (!await current.files.remoteId(id) && !(await current.files.status()).some(row => row.id === id)) throw new WorkspaceError('MISSING_LOCAL_FILE', 'File is not stored in this workspace', 404);
				const result = await current.files.things.move([id], folderId); changed(); return { ...result, savedLocally: true };
			},
			saveLocalFile: async (input: Parameters<AccountFileSync['things']['saveFile']>[0], options?: { signal?: AbortSignal }) => {
				const row = await worker().files.things.saveFile(input, options?.signal); changed();
				return { ok: true, attachment: { id: row.id, ...row.crystal }, savedLocally: true };
			},
			readLocalFile: async ({ id }: { id: string }, options?: { signal?: AbortSignal }) => {
				const { row, bytes } = await worker().files.readFile(id, options?.signal);
				return { ok: true, attachment: { id: row.id, ...row.crystal }, bytes };
			}
		},
		schemas: { ...online.schemas, browse: browse('schema') }, components: { ...online.components, browse: browse('component') }, things: { ...online.things,
		save: (args: any) => interact('save', args), react: (args: any) => interact('reaction', args),
		feed: async (...args: any[]) => { const startedAt = Date.now(); return retainPosts(await online.things.feed(...args), startedAt); },
		trending: async (...args: any[]) => { const startedAt = Date.now(); return retainPosts(await online.things.trending(...args), startedAt); },
		saved: async (args: {cursor?:string;limit?:number} = {}) => {
			const service = worker();
			if (navigator.onLine === false || !canSyncAccountWorkspace(scope) || args.cursor?.startsWith('device:')) {
				if (args.cursor && !args.cursor.startsWith('device:')) throw new WorkspaceError('LOCAL_CURSOR_REQUIRED','Reload Saved to browse device snapshots offline.');
				const result = await service.posts.saved(await service.interactions.states(), {...args,cursor:args.cursor?.slice(7)});
				return {...result,nextCursor:result.nextCursor?`device:${result.nextCursor}`:null};
			}
			const startedAt = Date.now(), result = await retainPosts(await online.things.saved(args), startedAt);
			const ids = [...new Set<string>((result.posts || []).map((post: any) => post.id))].slice(0,50);
			if (ids.length) {
				const readAt = Date.now();
				try { await service.interactions.remember(await service.transport.interactions.read(ids), true, readAt); }
				catch { facadeLease.assertCurrent(); result.localCacheError = 'Saved post details could not be refreshed. Your device choices are preserved.'; }
			}
			const states = new Map((await service.interactions.states()).map(state => [state.id,state]));
			result.posts = (result.posts||[]).filter((post:any)=>states.get(post.id)?.saved!==false).map((post:any)=>overlayAccountPost(post,states));
			if (!args.cursor) {
				const local = await service.posts.saved([...states.values()],{limit:50});
				const pending = new Set((await service.interactions.status()).filter(row=>row.state!=='synced').map(row=>row.id));
				result.posts = [...local.posts.filter(post=>pending.has(post.id)&&!result.posts.some((row:any)=>row.id===post.id)),...result.posts];
			}
			return result;
		},
		fork: async (input: { id: string; key?: string }) => {
			facadeLease.assertCurrent();
			if (!input || Object.keys(input).some(key => !['id', 'key'].includes(key))) throw new WorkspaceError('INVALID_COPY', 'Unsupported copy options.');
			const request = { id: input.id, key: input.key }, { plan } = await exportThings({ ids: [request.id], key: request.key });
			if (plan.files?.length || plan.links?.length || !plan.things.every(accountThingCanCache)) {
				if ((await worker().sync.status()).some(row => row.state !== 'synced')) throw new WorkspaceError('DEDICATED_COPY_REQUIRED', 'Copy device edits separately from items requiring their dedicated online adapter.', 409);
				return worker().transport.fork(request);
			}
			const result = await importThings({ manifest: { format: 'thingtime.transfer', version: 1, roots: plan.roots, things: plan.things, files: [] } });
			return { ...result, id: result.ids[request.id] };
		},
		export: exportThings, import: importThings,
		remove: async (input: { id: string; expectedUpdatedAt?: string }) => {
			if (Object.keys(input || {}).some(key => !['id', 'expectedUpdatedAt'].includes(key))) throw new WorkspaceError('UNSUPPORTED_LOCAL_DELETE', 'Unsupported deletion options.');
			if (input?.id?.startsWith('local-file-')) {
				if (input.expectedUpdatedAt !== undefined) throw new WorkspaceError('UNSUPPORTED_LOCAL_DELETE', 'Review account file deletion through File sync.', 409);
				const { files } = worker();
				if (await files.remoteId(input.id)) await files.remove(input.id); else await files.cancel(input.id);
				announceLocalWorkspaceChange([input.id]); worker().wake();
				return { ok: true, savedLocally: true };
			}
			return remove([input?.id], input?.expectedUpdatedAt, () => online.things.remove(input));
		},
		bulk: async (input: { op: string; ids: string[]; folderId?: string | null }) => {
			facadeLease.assertCurrent();
			if (input?.op === 'copy') {
				if (Object.keys(input).some(key => !['op', 'ids', 'folderId'].includes(key)) || !Array.isArray(input.ids) || !input.ids.length || input.ids.length > 200 ||
					input.ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(input.ids).size !== input.ids.length ||
					(input.folderId != null && (typeof input.folderId !== 'string' || !input.folderId.trim()))) throw new WorkspaceError('INVALID_COPY', 'Choose between 1 and 200 distinct Things and a copy destination.');
				const request = { ids: [...input.ids], folderId: input.folderId };
				const { plan } = await exportThings({ ids: request.ids });
				if (plan.files?.length || plan.links?.length || !plan.things.every(accountThingCanCache)) {
					if ((await worker().sync.status()).some(row => row.state !== 'synced')) throw new WorkspaceError('DEDICATED_COPY_REQUIRED', 'Copy device edits separately from items requiring their dedicated online adapter.', 409);
					return online.things.bulk({ op: 'copy', ...request });
				}
				const result = await importThings({ manifest: { format: 'thingtime.transfer', version: 1, roots: plan.roots, things: plan.things, files: [] }, folderId: request.folderId });
				return { ...result, succeeded: request.ids.length, failed: 0, results: request.ids.map(id => ({ id, ok: true, newId: result.ids[id] })) };
			}
			if (input?.op === 'delete') {
				if (Object.keys(input).some(key => !['op', 'ids', 'folderId'].includes(key))) throw new WorkspaceError('UNSUPPORTED_LOCAL_DELETE', 'Unsupported deletion options.');
				return remove(input.ids, undefined, () => online.things.bulk(input));
			}
			if (input?.op !== 'move') return online.things.bulk(input);
			if (Object.keys(input).some(key => !['op', 'ids', 'folderId'].includes(key)) ||
				!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 200 ||
				input.ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(input.ids).size !== input.ids.length ||
				(input.folderId != null && (typeof input.folderId !== 'string' || !input.folderId.trim())))
				throw new WorkspaceError('INVALID_MOVE', 'Choose between 1 and 200 distinct Things and a destination folder.');
			const { sync } = worker();
			const requireLocal = async (id: string) => {
				let row = await sync.view(id);
				if (!row) {
					if (navigator.onLine === false || !canSyncAccountWorkspace(scope))
						throw new WorkspaceError('LOCAL_CONTENT_MISSING', 'Open these Things and their destination folder online once before moving them offline.', 409);
					await refresh({ id }); row = await sync.view(id);
				}
				return row;
			};
			const rows = [];
			for (const id of input.ids) rows.push(await requireLocal(id));
			if (rows.some(row => !row)) {
				// A mixed batch must never remotely move an unsynced local Thing.
				if (rows.some(row => row && row.syncState !== 'synced'))
					throw new WorkspaceError('UNSUPPORTED_LOCAL_MOVE', 'Move saved device Things separately from items that require their dedicated online adapter.', 409);
				return online.things.bulk(input);
			}
			let parent = input.folderId || null; const seen = new Set<string>();
			while (parent) {
				if (seen.has(parent) || seen.size >= 200) throw new WorkspaceError('INVALID_FOLDER', 'The destination folder chain is cyclic or too deep.');
				seen.add(parent); const folder = await requireLocal(parent);
				if (!folder?.thingtime.includes('folder')) throw new WorkspaceError('INVALID_FOLDER', 'Destination folder is not owned by this workspace.');
				parent = folder.folderId || null;
			}
			await sync.things.move(input.ids, input.folderId || null); changed();
			return { ok: true, savedLocally: true, succeeded: input.ids.length, failed: 0, results: input.ids.map(id => ({ id, ok: true })) };
		},
		search: async (args: Record<string, any> = {}, options?: { signal?: AbortSignal; onRefresh?: (result: any) => void; onError?: (error: unknown) => void }) => {
			facadeLease.assertCurrent(); options?.signal?.throwIfAborted();
			if (args.workspace !== true) return online.things.search(args, options);
			if (args.device === true) {
				const { sync } = worker(), page = await searchLocalThings(await sync.things.snapshot(), args, workspaceScopeKey(scope));
				const things = (await sync.views(page.things.map(row => row.id))).map(project);
				facadeLease.assertCurrent(); options?.signal?.throwIfAborted();
				return { ...page, things, posts: {}, incomplete: true };
			}
			// `author` is accepted but never trusted: the remote read below pins it
			// to this workspace's own owner, so a caller cannot widen or redirect it.
			if (Object.entries(args).some(([key, value]) => value !== undefined && !['q', 'thingtime', 'cursor', 'limit', 'workspace', 'author'].includes(key))) throw new WorkspaceError('UNSUPPORTED_LOCAL_SEARCH', 'These filters require the structured search adapter.');
			const { sync } = worker();
			const localCursor = typeof args.cursor === 'string' && args.cursor.startsWith('local-search:');
			const canReadRemote = navigator.onLine !== false && canSyncAccountWorkspace(scope) && !!owner.username && !localCursor;
			if (!canReadRemote && args.cursor && !localCursor) throw new WorkspaceError('LOCAL_CURSOR_REQUIRED', 'Reload this search to browse saved device content while offline.');
			const continuation = readWorkspaceSearchCursor(args.cursor, workspaceScopeKey(scope), args);
			const page = searchLocalLibrary(await sync.things.snapshot(), { ...args, cursor: canReadRemote ? undefined : args.cursor });
			const local = { ...page, things: continuation ? [] : (await sync.views(page.things.map(row => row.id))).map(project), incomplete: true };
			facadeLease.assertCurrent(); options?.signal?.throwIfAborted();
			if (!canReadRemote) return local;
			const readRemote = async () => {
				const remoteLease = accountRemoteWorkspaceLease(scope); remoteLease.assertCurrent();
				const { workspace: _workspace, ...query } = args;
				const result = continuation && continuation.remote === null ? { ok: true, things: [], nextCursor: null, total: null } : await online.things.search({ ...query, cursor: continuation?.remote || undefined, author: owner.username }, { signal: options?.signal });
				remoteLease.assertCurrent(); options?.signal?.throwIfAborted();
				if (result?.ok === false) throw new WorkspaceError('SEARCH_FAILED', result.error || 'Could not refresh search results.', result.status || 503);
				const pending = new Set((await sync.status()).filter(row => row.state !== 'synced').map(row => row.id));
				const fresh = [];
				for (const row of result.things || []) {
					if (accountThingCanCache(row) && row.author?.id === owner.id) {
						await sync.remember(row);
						const current = await sync.view(row.id);
						if (current && (!pending.has(row.id) || searchLocalLibrary([current], { ...args, cursor: undefined }).things.length)) fresh.push(project(current));
					} else fresh.push(row);
				}
				let pendingCursor: string | null = null;
				if (!continuation || continuation.pending !== null) {
					const latest = searchLocalLibrary((await sync.things.snapshot()).filter(row => pending.has(row.id)), { ...args, cursor: continuation?.pending || undefined });
					pendingCursor = latest.nextCursor;
					for (const row of await sync.views(latest.things.map(item => item.id))) if (!fresh.some(item => item.id === row.id)) fresh.unshift(project(row));
				}
				facadeLease.assertCurrent(); options?.signal?.throwIfAborted();
				remoteLease.assertCurrent();
				return { ...result, things: fresh, nextCursor: workspaceSearchCursor(workspaceScopeKey(scope), args, result.nextCursor || null, pendingCursor), total: pending.size ? null : result.total, localWorkspace: true, incomplete: false };
			};
			if (!options?.onRefresh) return readRemote();
			void readRemote().then(result => options.onRefresh?.(result)).catch(error => {
				try { facadeLease.assertCurrent(); options.signal?.throwIfAborted(); options.onError?.(error); } catch { /* retired view */ }
			});
			return { ...local, refreshing: true };
		},
		create: async (input: AccountThingWrite) => {
			facadeLease.assertCurrent();
			if (!accountThingCanCache(input) || !accountWriteSupported(input)) return online.things.create(input);
			const { sync } = worker();
			const row = await sync.things.create(input); changed();
			return { ok: true, id: row.id, thing: project(await sync.view(row.id)), savedLocally: true };
		},
		update: async (input: AccountThingWrite & { id: string }) => {
			const { sync } = worker();
			if (await sync.isDeleted(input.id)) throw new WorkspaceError('LOCAL_THING_DELETED', 'This Thing was deleted. Restore it before editing.', 409);
			let cached = await sync.view(input.id);
			if (!accountWriteSupported(input, true)) {
				if (cached && cached.syncState !== 'synced') throw new WorkspaceError('UNSUPPORTED_LOCAL_WRITE', 'Sync this Thing before changing fields that require its online adapter.', 409);
				return online.things.update(input);
			}
			if (!cached) {
				const result = await refresh({ id: input.id });
				if (!accountThingCanCache(result.thing) || result.thing.author?.id !== owner.id) return online.things.update(input);
				cached = await sync.view(input.id);
			}
			if (!cached) throw new WorkspaceError('LOCAL_CONTENT_MISSING', 'Load this Thing before editing offline', 409);
			await sync.things.update(input); changed();
			return { ok: true, thing: project(await sync.view(input.id)), savedLocally: true };
		},
		get: async (args: any, options?: { signal?: AbortSignal }) => {
			facadeLease.assertCurrent();
			if (Object.entries(args || {}).some(([key, value]) => value !== undefined && key !== 'id')) {
				const startedAt = Date.now();
				const result = await online.things.get(args, options); await retainInteractionProjection(result.discussion || result.post, startedAt); return result;
			}
			const service = worker(), { sync } = service;
			if (typeof args?.id === 'string' && args.id.startsWith('local-file-')) {
				const [row] = await service.files.views([args.id]);
				facadeLease.assertCurrent(); options?.signal?.throwIfAborted();
				if (!row) throw new WorkspaceError('NOT_FOUND', 'File is not in this workspace.', 404);
				return { ok: true, thing: projectFile(row), savedLocally: true };
			}
			const evictRefusedPost = async (error: unknown) => {
				if ([403,404,410].includes(Number((error as any)?.status)) && await service.posts.forget(args.id)) {
					clearLocalCache(`tt-saved-${workspaceScopeKey(scope)}`); announceLocalWorkspaceChange([args.id]);
				}
			};
			const cachedPost = await service.posts.get(args.id);
			const offline = navigator.onLine === false || !canSyncAccountWorkspace(scope);
			if (cachedPost && (offline || !cachedPost.thingtime.includes('comment'))) {
				if (!offline) void refresh(args, options?.signal).then(async () => {
					if (JSON.stringify(await service.posts.get(args.id)) !== JSON.stringify(cachedPost)) announceLocalWorkspaceChange([args.id]);
				}).catch(async error => { await evictRefusedPost(error); }).catch(() => {});
				return {ok:true,thing:null,post:overlayAccountPost(cachedPost,new Map((await service.interactions.states()).map(state=>[state.id,state]))),parent:null,root:null,localWorkspace:true,incomplete:offline};
			}
			if (await sync.isDeleted(args.id)) throw new WorkspaceError('NOT_FOUND', 'This Thing was deleted in this workspace.', 404);
			const cached = await sync.view(args.id);
			if (cached) {
				if (navigator.onLine !== false && canSyncAccountWorkspace(scope)) void refresh(args, options?.signal).then(() => {}).catch(() => {});
				return { ok: true, thing: project(cached), savedLocally: cached.syncState !== 'synced' };
			}
			try { return await refresh(args, options?.signal); }
			catch (error) { await evictRefusedPost(error); throw error; }
		},
		list: async (args: any = {}, options?: { signal?: AbortSignal }) => {
			facadeLease.assertCurrent();
			if (Object.keys(args).some(key => !['thingtime', 'folder', 'cursor', 'limit', 'device'].includes(key))) return online.things.list(args, options);
			const { db, lease, sync } = worker();
			// A cold offline route may never have fetched this exact server page.
			// List the known local library with its own cursor and explicit partial
			// coverage instead of making cached content inaccessible.
			const localCursor = typeof args.cursor === 'string' && args.cursor.startsWith('device:');
			if (args.device === true || navigator.onLine === false || !canSyncAccountWorkspace(scope) || localCursor) {
				if (args.cursor && !localCursor) throw new WorkspaceError('LOCAL_CURSOR_REQUIRED', 'Reload this list to browse saved device content while offline.');
				const page = await sync.things.list({ ...args, cursor: localCursor ? args.cursor.slice(7) : undefined });
				return { ok: true, things: await localViews(page.things.map(row => row.id)), nextCursor: page.nextCursor ? `device:${page.nextCursor}` : null, localWorkspace: true, incomplete: true };
			}
			const query = Object.fromEntries(Object.entries(args).sort(([a], [b]) => a.localeCompare(b)));
			const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(query)));
			const key = Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
			const kinds = typeof args.thingtime === 'string' ? args.thingtime.split(',') : args.thingtime || [];
			const matches = (row: any) => row && kinds.every((kind: string) => row.thingtime?.includes(kind)) &&
				(!args.folder || (args.folder === 'root' ? !row.folderId : row.folderId === args.folder));
			const overlay = async (rows: any[]) => {
				const library = await worker().files.library(), localFiles = new Map(library.things.map(row => [row.id, row]));
				const things = rows.flatMap(row => {
					if (row.author?.id !== owner.id || !library.aliases.has(row.id)) return [row];
					const id = library.aliases.get(row.id), local = id && localFiles.get(id);
					return local ? [projectFile(local)] : [];
				}).filter(matches);
				if (!args.cursor) {
					const pending = new Set([...(await sync.status()).filter(row => row.state !== 'synced').map(row => row.id), ...localFiles.keys()]);
					for (const row of (await sync.things.list(args)).things) if (pending.has(row.id) && !things.some(thing => thing.id === row.id)) {
						const current = localFiles.has(row.id) ? projectFile(localFiles.get(row.id)) : project(await sync.view(row.id)); if (matches(current)) things.unshift(current);
					}
				}
				facadeLease.assertCurrent(); options?.signal?.throwIfAborted(); return things;
			};
			const readPage = async () => {
				const result = await refresh(args, options?.signal, page => db.transaction(scope, 'readwrite', lease, tx => tx.put('thing-pages', key, page)));
				return { ...result, things: await overlay(result.things || []) };
			};
			const page = await db.transaction(scope, 'readonly', lease, tx => tx.get<{ ids: string[]; nextCursor: string | null }>('thing-pages', key));
			if (!page) return readPage();
			if (navigator.onLine) void readPage().catch(() => {});
			const things = await overlay((await sync.views(page.ids)).map(project));
			return { ok: true, things, nextCursor: page.nextCursor, localWorkspace: true };
		}
	} } as T;
}

/** Native renderer data path for account-owned local pages. Dependencies owned
 * by this account come from the same workspace snapshot. Existing remote
 * resolution remains responsible for shared/system dependencies. */
export async function resolveAccountWebpage(scope: AccountScope, target: LocalWebpageTarget) {
 const { sync, transport, db, lease } = accountWorkspaceWorker(scope);
 const args = target.kind === 'id' ? { id: target.id, ...(target.key ? { key: target.key } : {}) } : target.kind === 'path' ? { path: target.path } : { global: '1' };
 if (target.kind === 'id' && target.key) return transport.resolve(args);
 const refresh = async () => {
  const result = await transport.resolve(args);
  if (result.page?.id && await sync.isDeleted(result.page.id)) return { ok: true, page: null, source: null, components: [], refs: {} };
  if (result.page?.author?.id === scope.ownerId && accountThingCanCache(result.page)) {
   await sync.remember(result.page);
   for (const component of result.components || []) if (component.author?.id === scope.ownerId && accountThingCanCache(component)) await sync.remember(component);
   // Retain only validated component content from this authorized resolution,
   // scoped to this account and page. It confers no ownership or write access.
   const components = (result.components || []).map((component: any) => {
    const check = validateThingtimeCrystal(['component'], snapshotTransferValue(component.crystal));
    if (!check.ok || typeof component.id !== 'string') throw new WorkspaceError('INVALID_COMPONENT', 'Invalid resolved component');
    return { id: component.id, thingtime: ['component'], crystal: check.crystal };
   });
   await db.transaction(scope, 'readwrite', lease, tx => tx.put('page-components', result.page.id, { components, refs: result.refs || {} }));
  }
  return result;
 };
 const local = resolveWorkspacePage(await sync.things.snapshot(), target, scope.ownerId);
 const canRefresh = navigator.onLine !== false && canSyncAccountWorkspace(scope);
 if (!local.page && target.kind !== 'id' && !canRefresh) return { ok: true, page: null, source: null, components: [], refs: {} };
 if (!local.page) {
  if (target.kind === 'id' && await sync.isDeleted(target.id)) return { ok: true, page: null, source: null, components: [], refs: {} };
  return refresh();
 }
 if (canRefresh) void refresh().catch(() => {});
 const dependencies = await db.transaction(scope, 'readonly', lease, tx => tx.get<{ components: any[]; refs: Record<string, string | null> }>('page-components', local.page!.id));
 const components = new Map(local.components.map(row => [row.id, row]));
 for (const [ref, id] of Object.entries(local.refs)) if (!id) {
  const savedId = dependencies?.refs[ref], saved = dependencies?.components.find(row => row.id === savedId);
  if (saved && !await sync.isDeleted(saved.id)) { components.set(saved.id, saved); local.refs[ref] = saved.id; }
 }
 const missing = Object.entries(local.refs).filter(([, id]) => !id).map(([ref]) => ref);
 if (missing.length) throw new WorkspaceError('MISSING_DEPENDENCY', `This page needs components that are not saved on this device: ${missing.join(', ')}`);
 return { ok: true, page: await sync.view(local.page.id), source: 'user' as const, components: [...components.values()], refs: local.refs };
}
