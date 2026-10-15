import { readWorkspaceSearchCursor, workspaceSearchCursor } from './searchCursor';
import { searchLocalLibrary } from './librarySearch';
import { validateThingtimeCrystal } from '../schemas/registry';
import { snapshotTransferValue } from '../utils/thingTransfer/value';
import { resolveWorkspacePage, type LocalWebpageTarget } from './webpageResolution';
import { accountWriteSupported, AccountThingSync, type AccountThing, type AccountThingWrite } from './accountSync';
import { accountThingTransport } from './accountTransport.client';
import { assertAccountSyncAllowed, canSyncAccountWorkspace, subscribeWorkspaceBinding, accountWorkspaceLease, accountRemoteWorkspaceLease, announceLocalWorkspaceChange, workspaceDatabase } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
import { WorkspaceError, workspaceScopeKey, type WorkspaceScope } from './storage';

type AccountScope = Extract<WorkspaceScope, { kind: 'account' }>;
type Owner = { id: string; username?: string; displayName?: string; avatarUrl?: string | null };
const LOCAL_KINDS = new Set(['data', 'folder', 'webpage', 'component', 'schema', 'action']);
export const accountThingCanCache = (row: any): row is AccountThing => Array.isArray(row?.thingtime) && row.thingtime.length > 0 && row.thingtime.every((kind: string) => LOCAL_KINDS.has(kind));
const workers = new Map<string, ReturnType<typeof createWorker>>();
/** Matches the sync claim window: the longest a blocked pass must wait before
 * a crashed tab's lease expires and this tab can replay the frozen write. */
const BLOCKED_RETRY_MS = 60_000;
function createWorker(scope: AccountScope, dispose: () => void) {
	const lease = accountWorkspaceLease(scope), db = workspaceDatabase();
	const sync = new AccountThingSync(db, scope, lease), transport = accountThingTransport(scope, lease);
	const controller = new AbortController();
	let running = false, timer: ReturnType<typeof setTimeout> | null = null, stopped = false;
	const wake = () => {
		if (stopped || running || navigator.onLine === false || !canSyncAccountWorkspace(scope)) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => { timer = null; void drain(); }, 0);
	};
	const drain = async () => {
		if (stopped || running || navigator.onLine === false || !canSyncAccountWorkspace(scope)) return;
		running = true;
		try {
			lease.assertCurrent();
			const before = JSON.stringify(await sync.status());
			const { completed } = await sync.sync(transport, controller.signal);
			const status = await sync.status();
			if (JSON.stringify(status) !== before) announceLocalWorkspaceChange();
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
		finally { running = false; }
	};
	const unsubscribe = lease.onInvalidate(() => stop());
	const unbind = subscribeWorkspaceBinding(wake);
	const stop = () => {
		if (stopped) return;
		stopped = true; controller.abort(); if (timer) clearTimeout(timer);
		window.removeEventListener('online', wake); window.removeEventListener('focus', wake); unsubscribe(); unbind(); dispose();
	};
	window.addEventListener('online', wake); window.addEventListener('focus', wake);
	return { sync, transport, db, lease, wake, stop };
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
		if (typeof value === 'function') return (...args: any[]) => { facadeLease.assertCurrent(); assertAccountSyncAllowed(scope); return value(...args); };
		if (!value || typeof value !== 'object') return value;
		const wrapped = new Map<PropertyKey, unknown>();
		return new Proxy(value, { get(target, key) { if (!wrapped.has(key)) wrapped.set(key, guard(Reflect.get(target, key))); return wrapped.get(key); } });
	};
	const online = guard(remote) as T;

	const project = (thing: any) => thing ? { ...thing, author: owner } : thing;
	const refresh = async (args: Record<string, unknown>, signal?: AbortSignal) => {
		const { sync, transport, lease } = worker();
		const result = await transport.read(args, signal);
		lease.assertCurrent();
		const retain = async (thing: any) => {
			if (!accountThingCanCache(thing) || thing.author?.id !== owner.id) return thing;
			await sync.remember(thing);
			return project(await sync.view(thing.id));
		};
		if (result.thing) result.thing = await retain(result.thing);
		if (result.things) result.things = await Promise.all(result.things.map(retain));
		return result;
	};
	const changed = () => { announceLocalWorkspaceChange(); worker().wake(); };
	// Explicit login/logout establish or revoke identity; other remote features require confirmation.
	return { ...online, auth: remote.auth, login: remote.login, things: { ...online.things,
		search: async (args: Record<string, any> = {}, options?: { signal?: AbortSignal; onRefresh?: (result: any) => void; onError?: (error: unknown) => void }) => {
			facadeLease.assertCurrent(); options?.signal?.throwIfAborted();
			if (args.workspace !== true) return online.things.search(args, options);
			if (Object.entries(args).some(([key, value]) => value !== undefined && !['q', 'thingtime', 'cursor', 'limit', 'workspace'].includes(key))) throw new WorkspaceError('UNSUPPORTED_LOCAL_SEARCH', 'These filters require the structured search adapter.');
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
			if (Object.keys(args || {}).some(key => key !== 'id')) return online.things.get(args, options);
			const { sync } = worker(); const cached = await sync.view(args.id);
			if (cached) {
				if (navigator.onLine !== false) void refresh(args, options?.signal).then(() => {}).catch(() => {});
				return { ok: true, thing: project(cached), savedLocally: cached.syncState !== 'synced' };
			}
			return refresh(args, options?.signal);
		},
		list: async (args: any = {}, options?: { signal?: AbortSignal }) => {
			facadeLease.assertCurrent();
			if (Object.keys(args).some(key => !['thingtime', 'folder', 'cursor', 'limit'].includes(key))) return online.things.list(args, options);
			const { db, lease, sync } = worker();
			// A cold offline route may never have fetched this exact server page.
			// List the known local library with its own cursor and explicit partial
			// coverage instead of making cached content inaccessible.
			const localCursor = typeof args.cursor === 'string' && args.cursor.startsWith('device:');
			if (navigator.onLine === false || !canSyncAccountWorkspace(scope) || localCursor) {
				if (args.cursor && !localCursor) throw new WorkspaceError('LOCAL_CURSOR_REQUIRED', 'Reload this list to browse saved device content while offline.');
				const page = await sync.things.list({ ...args, cursor: localCursor ? args.cursor.slice(7) : undefined });
				return { ok: true, things: await sync.views(page.things.map(row => row.id)), nextCursor: page.nextCursor ? `device:${page.nextCursor}` : null, localWorkspace: true, incomplete: true };
			}
			const query = Object.fromEntries(Object.entries(args).sort(([a], [b]) => a.localeCompare(b)));
			const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(query)));
			const key = Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
			const readPage = async () => {
				const result = await refresh(args, options?.signal);
				// Cache only complete pages of the locally supported owned kinds.
				// Other managed libraries continue using their dedicated adapters.
				if (result.things?.every((thing: any) => accountThingCanCache(thing) && thing.author?.id === owner.id))
					await db.transaction(scope, 'readwrite', lease, tx => tx.put('thing-pages', key, { ids: result.things.map((thing: any) => thing.id), nextCursor: result.nextCursor || null }));
				return result;
			};
			const page = await db.transaction(scope, 'readonly', lease, tx => tx.get<{ ids: string[]; nextCursor: string | null }>('thing-pages', key));
			if (!page) return readPage();
			if (navigator.onLine) void readPage().catch(() => {});
			const things = (await sync.views(page.ids)).map(project).filter((row: any) => !args.folder || (args.folder === 'root' ? !row.folderId : row.folderId === args.folder));
			if (!args.cursor) {
				const pending = new Set((await sync.status()).filter(row => row.state !== 'synced').map(row => row.id));
				for (const row of (await sync.things.list(args)).things) if (pending.has(row.id) && !things.some((thing: any) => thing.id === row.id)) things.unshift(project(await sync.view(row.id)));
			}
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
 if (!local.page) return refresh();
 if (navigator.onLine !== false) void refresh().catch(() => {});
 const dependencies = await db.transaction(scope, 'readonly', lease, tx => tx.get<{ components: any[]; refs: Record<string, string | null> }>('page-components', local.page!.id));
 const components = new Map(local.components.map(row => [row.id, row]));
 for (const [ref, id] of Object.entries(local.refs)) if (!id) {
  const savedId = dependencies?.refs[ref], saved = dependencies?.components.find(row => row.id === savedId);
  if (saved) { components.set(saved.id, saved); local.refs[ref] = saved.id; }
 }
 const missing = Object.entries(local.refs).filter(([, id]) => !id).map(([ref]) => ref);
 if (missing.length) throw new WorkspaceError('MISSING_DEPENDENCY', `This page needs components that are not saved on this device: ${missing.join(', ')}`);
 return { ok: true, page: await sync.view(local.page.id), source: 'user' as const, components: [...components.values()], refs: local.refs };
}
