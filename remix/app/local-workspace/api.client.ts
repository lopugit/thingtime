import { browseLocalDefinitions } from './definitionCatalog';
import { searchLocalThings } from './structuredSearch';
import { workspaceScopeKey } from './storage';
import { LocalTimelineVersions } from './timelineVersions';
import { LOCAL_TIMELINE_FOLDER, LocalTimeline } from './timeline';
import { searchLocalLibrary } from './librarySearch';
import { LocalInteractions, localSavedPage } from './interactions';
import { localPostInput, localPostProjection, localTargetIndex, localThingReadProjection } from './posts';
import { resolveWorkspacePage, type LocalWebpageTarget } from './webpageResolution';
import { publicWorkspaceRead } from './publicRead.client';
import { draftRequest } from '../drafts/draftClient';
import { localThingProjection, type ThingWrite } from './things';
import { anonymousThings, anonymousWorkspaceDatabase, anonymousWorkspaceLease, announceLocalWorkspaceChange, LOCAL_WORKSPACE_OWNER } from './runtime.client';
import { LocalAlgorithms } from './algorithms';
import { LocalThemes } from './themes';
import { isLocalAttachment } from './attachments';
import { WorkspaceError } from './storage';
import { crystalSchemas } from '../schemas/registry';

const unavailable = async () => { throw new WorkspaceError('REMOTE_ACCOUNT_REQUIRED', 'This operation needs a signed-in account. Your local workspace has not been uploaded.', 401); };
const blocked = (value: any): any => typeof value === 'function' ? unavailable : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, blocked(entry)])) : value;

/** Explicit local implementations replace cloud methods before capability
 * negotiation. Unsupported cloud operations cannot fall through to fetch. */
export function anonymousApi<T extends Record<string, any>>(remote: T): T {
	const lease = anonymousWorkspaceLease();
	const service = () => { lease.assertCurrent(); return anonymousThings(); };
	const project = (row: Parameters<typeof localThingProjection>[0]) => localThingProjection(row, LOCAL_WORKSPACE_OWNER);
	const changed = <V>(result: V) => { lease.assertCurrent(); announceLocalWorkspaceChange(); return result; };
	const write = async (input: ThingWrite, update = false) => {
		const things = service(); const kinds = input.thingtime || (update && input.id ? (await things.get(input.id)).thingtime : undefined);
		const post = (!update && !Array.isArray(kinds)) || (Array.isArray(kinds) && kinds.includes('post'));
		const row = post ? await things.savePost(update ? input : localPostInput(input as Record<string, unknown>), update) : update ? await things.update(input as ThingWrite & { id: string }) : await things.create(input);
		const projection = post ? localPostProjection(row, await things.snapshot(), LOCAL_WORKSPACE_OWNER) : undefined;
		return changed({ ok: true, id: row.id, thing: { ...project(row), ...(projection ? { attachments: projection.attachments } : {}) }, ...(projection ? { post: projection } : {}) });
	};
	const local = blocked(remote);
	const history = new LocalTimeline(anonymousWorkspaceDatabase(), lease, window.location?.origin || 'http://localhost');
	const timelineUnavailable = async () => { lease.assertCurrent(); throw new WorkspaceError('LOCAL_TIMELINE_UNAVAILABLE', 'This local History operation is not available yet. Your saved history remains on this device.', 422); };
	local.timeline = { ...Object.fromEntries(Object.keys(remote.timeline || {}).map(key => [key, timelineUnavailable])),
		discover: (ownerId: string) => history.discover(ownerId),
		page: (scope: any, request: any, options?: { signal?: AbortSignal }) => { history.assertScope(scope); return history.page(request, options?.signal); },
		push: (scope: any, event: any, options?: { signal?: AbortSignal }) => { history.assertScope(scope); return history.push(event, options?.signal); },
		exportVersion: (scope: any, eventId: string, options?: { signal?: AbortSignal }) => { history.assertScope(scope); return history.exportVersion(eventId, options?.signal); },
		version: (scope: any, request: any, options?: { signal?: AbortSignal }) => { history.assertScope(scope); return new LocalTimelineVersions(anonymousWorkspaceDatabase(), lease, service()).request(request, options?.signal).then(result => request.command === 'apply-version' ? changed(result) : result); },
		branchMerge: (scope: any, request: any, options?: { signal?: AbortSignal }) => { history.assertScope(scope); return history.branchMerge(request, options?.signal); },
		branch: (scope: any, command: any, options?: { signal?: AbortSignal }) => { history.assertScope(scope); return history.branch(command, options?.signal).then(changed); },
		branches: (scope: any, thingId: string, before?: number, options?: { signal?: AbortSignal }) => { history.assertScope(scope); return history.branches(thingId, before ?? null, 40, options?.signal); },
		branchHead: (scope: any, branchId: string, thingId: string, options?: { signal?: AbortSignal }) => { history.assertScope(scope); return history.branchHead(branchId, thingId, options?.signal); },
		checkoutBranch: (scope: any, command: any, options?: { signal?: AbortSignal }) => { history.assertScope(scope); return history.checkoutBranch(command, options?.signal); },
		nameVersion: (scope: any, command: any, options?: { signal?: AbortSignal }) => { history.assertScope(scope); return history.nameVersion(command, options?.signal).then(changed); },
		note: (scope: any, command: any, options?: { signal?: AbortSignal }) => { history.assertScope(scope); return history.note(command, options?.signal).then(changed); },
		entry: (scope: any, id: string, options?: { signal?: AbortSignal }) => { history.assertScope(scope); return history.entry(id, options?.signal); },
		componentBindings: (scope: any, id: string, options?: { signal?: AbortSignal }) => { history.assertScope(scope); return history.componentBindings(id, options?.signal); }
	};
	const interact = (kind: Parameters<LocalInteractions['toggle']>[0], id: unknown, value?: unknown) => new LocalInteractions(anonymousWorkspaceDatabase(), { kind: 'anonymous' }, lease).toggle(kind, id, value).then(changed);
	const algorithms = () => { lease.assertCurrent(); return new LocalAlgorithms(anonymousWorkspaceDatabase(), lease); };
	// Public discovery and explicit authentication remain available online.
	local.auth = remote.auth;
	local.login = remote.login;
	// Endpoints the server already serves logged out must keep working for a
	// visitor who has no account at all. Deny-by-default above would otherwise
	// turn the public landing form and every public profile into an error.
	// Only unauthenticated reads and the public waitlist pass through; every
	// account, mutation and admin surface stays blocked.
	const publicOnline = (group: string, methods: string[]) => {
		if (!remote[group]) return;
		local[group] = { ...local[group], ...Object.fromEntries(methods.filter(name => remote[group][name]).map(name => [name, async (...args: unknown[]) => {
			lease.assertCurrent(); const result = await remote[group][name](...args); lease.assertCurrent(); return result;
		}])) };
	};
	publicOnline('waitlist', ['join']);
	// Public profile reads must not acquire a later session's viewer privileges.
	const profileRead = (path: string, version = '1.0.0') => (args: Record<string, unknown> = {}) => {
		lease.assertCurrent();
		const query = new URLSearchParams(Object.entries(args).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
		return publicWorkspaceRead(`/api/v1/users/${path}?${query}`, `api.users-${path}`, version);
	};
	local.profile = { ...local.profile, get: profileRead('profile', '1.1.0'), activity: profileRead('activity'), search: profileRead('search') };
	local.drafts = (input?: Record<string, unknown>, query?: Record<string, string>) => { lease.assertCurrent(); return draftRequest(LOCAL_WORKSPACE_OWNER, input, query); };
	local.things = { ...local.things,
		search: async (args: Record<string, unknown> = {}, options?: { signal?: AbortSignal }) => {
			lease.assertCurrent(); options?.signal?.throwIfAborted();
			if (args.workspace !== true) {
				const { workspace: _workspace, device: _device, anon: _anon, ...query } = args;
				return publicWorkspaceRead('/api/v1/things/search', 'api.things-search', '1.3.0', options?.signal, JSON.stringify(query));
			}
			if (args.device === true) {
				const all = await service().snapshot(), page = await searchLocalThings(all, args, workspaceScopeKey({ kind: 'anonymous' })), index = localTargetIndex(all);
				lease.assertCurrent(); options?.signal?.throwIfAborted();
				return { ...page, things: page.things.map(project), posts: Object.fromEntries(page.things.filter(row => row.thingtime.includes('post')).map(row => [row.id, localPostProjection(row, all, LOCAL_WORKSPACE_OWNER, false, index)])), incomplete: false };
			}
			if (Object.entries(args).some(([key, value]) => value !== undefined && !['q', 'thingtime', 'cursor', 'limit', 'workspace'].includes(key))) throw new WorkspaceError('UNSUPPORTED_LOCAL_SEARCH', 'These filters require the structured search adapter.');
			const page = searchLocalLibrary(await service().librarySnapshot(), args);
			lease.assertCurrent(); options?.signal?.throwIfAborted();
			return { ...page, things: page.things.map(project) };
		},
		react: ({ id, emoji }: { id: string; emoji?: unknown }) => interact('reaction', id, emoji ?? null),
		save: ({ id }: { id: string }) => interact('save', id),
		vote: ({ id, optionIndex }: { id: string; optionIndex: number }) => interact('vote', id, optionIndex),
		updown: ({ id, direction }: { id: string; direction: unknown }) => interact('updown', id, direction),
		saved: async ({ cursor, limit = 30 }: { cursor?: string; limit?: number } = {}) => {
			const all = await service().snapshot(), page = localSavedPage(all, cursor, limit), index = localTargetIndex(all);
			return { ok: true, posts: page.things.map(row => localPostProjection(row, all, LOCAL_WORKSPACE_OWNER, false, index)), nextCursor: page.nextCursor };
		},
		feed: async (args: Record<string, unknown> = {}) => {
			lease.assertCurrent(); const localAlgorithm = typeof args.algorithm === 'string' && args.algorithm.startsWith('local-') ? args.algorithm : null;
			const query = new URLSearchParams(Object.entries({ ...args, ...(localAlgorithm ? { algorithm: 'latest' } : {}), anon: 1 }).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
			const result = await publicWorkspaceRead(`/api/v1/things/feed?${query}`, 'api.things-feed', '1.8.0');
			// Training storage must not prevent reading an otherwise healthy public feed.
			try { await algorithms().observePublicPosts(result.posts || []); } catch (error) { lease.assertCurrent(); result.localTrainingError = error instanceof Error ? error.message : 'Local training storage is unavailable'; }
			return localAlgorithm ? { ...result, posts: await algorithms().rankPage(localAlgorithm, result.posts || []), ranked: true, localRanking: true } : result;
		},
		trending: async () => { lease.assertCurrent(); return publicWorkspaceRead('/api/v1/things/trending?anon=1', 'api.things-trending', '1.0.0'); },
		get: async ({ id, key, sharedRoot, commentProjection }: { id: string; key?: string; sharedRoot?: string; commentProjection?: boolean }, options?: { signal?: AbortSignal }) => {
			lease.assertCurrent(); options?.signal?.throwIfAborted();
			const storedHere = id === LOCAL_TIMELINE_FOLDER || id.startsWith('local-') || await service().hasReference(id);
			lease.assertCurrent(); options?.signal?.throwIfAborted();
			if (storedHere) {
				const things = service(), row = await things.get(id), all = await things.snapshot();
				options?.signal?.throwIfAborted();
				return localThingReadProjection(row, all, LOCAL_WORKSPACE_OWNER, commentProjection);
			}
			const query = new URLSearchParams({ id, ...(key ? { key } : {}), ...(sharedRoot ? { sharedRoot } : {}), ...(commentProjection ? { commentProjection: 'true' } : {}) });
			return publicWorkspaceRead(`/api/v1/things?${query}`, 'api.things', '1.31.0', options?.signal);
		},
		list: async (query: Parameters<ReturnType<typeof anonymousThings>['list']>[0] & { commentProjection?: boolean; key?: string }, options?: { signal?: AbortSignal }) => {
			lease.assertCurrent(); options?.signal?.throwIfAborted();
			const localDiscussion = query.commentProjection && query.target && (query.target.startsWith('local-') || await service().hasReference(query.target));
			lease.assertCurrent(); options?.signal?.throwIfAborted();
			if (localDiscussion) {
				const things = service(); await things.get(query.target);
				const page = await things.list({ ...query, thingtime: 'comment' }), all = await things.snapshot(), index = localTargetIndex(all);
				options?.signal?.throwIfAborted();
				return { ok: true, comments: page.things.map(row => localPostProjection(row, all, LOCAL_WORKSPACE_OWNER, false, index)), nextCursor: page.nextCursor };
			}
			if (query.commentProjection && query.target) {
				const params = new URLSearchParams({ target: query.target, thingtime: 'comment', commentProjection: 'true', limit: String(query.limit || 20),
					...(query.key ? { key: query.key } : {}), ...(query.cursor ? { cursor: query.cursor } : {}) });
				return publicWorkspaceRead(`/api/v1/things?${params}`, 'api.things', '1.31.0', options?.signal);
			}
			options?.signal?.throwIfAborted(); const result = await service().list(query); options?.signal?.throwIfAborted();
			return { ok: true, ...result, things: result.things.map(project) };
		},
		comment: async ({ id, ...input }: { id: string } & Record<string, unknown>) => { const things = service(); await things.get(id); const result = await write({ ...localPostInput({ type: 'text', ...input }), thingtime: ['post', 'comment'], targetId: id }); return { ...result, comment: result.post, commentCount: (await things.snapshot()).filter(row => row.thingtime.includes('comment') && row.targetId === id).length }; },
		remove: async ({ id }: { id: string }) => { const result = await service().remove([id]); announceLocalWorkspaceChange(result.deleted); return changed(result); },
		create: (input: ThingWrite) => write(input), update: (input: ThingWrite) => write(input, true),
		renameLibrary: ({ id, displayTitle, expectedUpdatedAt }: { id: string; displayTitle: string; expectedUpdatedAt?: string }) => write({ id, crystal: { title: displayTitle }, expectedUpdatedAt }, true),
		fork: async ({ id }: { id: string; key?: string }) => {
			const things = service(), bundle = await things.export([id]);
			const result = await things.import(bundle.manifest, null, bundle.files);
			return changed({ ...result, id: result.idMap[id] });
		},
		export: async ({ ids, ...options }: { ids: string[] }, request?: { signal?: AbortSignal }) => {
			const { manifest, files } = await service().export(ids, { ...options, signal: request?.signal });
			return { ok: true, plan: { roots: manifest.roots, things: manifest.things, files: manifest.files,
				readLocalFile: async (id: string, signal?: AbortSignal) => { lease.assertCurrent(); signal?.throwIfAborted(); const bytes = files.get(id); if (!bytes) throw new WorkspaceError('MISSING_LOCAL_FILE', 'File is not in this export'); return Uint8Array.from(bytes); } } };
		},
		import: async ({ manifest, folderId, localFiles }: { manifest: unknown; folderId?: string | null; localFiles?: Map<string, Uint8Array> }, request?: { signal?: AbortSignal }) => changed(await service().import(manifest, folderId, localFiles, request?.signal)),
		bulk: async ({ op, ids, recursive, folderId = null }: { op: string; ids: string[]; recursive?: boolean; folderId?: string | null }) => {
			if (op === 'move') { const result = await service().move(ids, folderId); return changed({ ...result, succeeded: ids.length, failed: 0, results: ids.map(id => ({ id, ok: true })) }); }
			if (op === 'copy') { const bundle = await service().export(ids); const result = await service().import(bundle.manifest, folderId, bundle.files); return changed({ ...result, succeeded: ids.length, failed: 0, results: ids.map(id => ({ id, ok: true, newId: result.idMap[id] })) }); }
			if (op !== 'delete') throw new WorkspaceError('LOCAL_OPERATION_UNAVAILABLE', `Local bulk ${op} is not available yet`);
			const result = await service().remove(ids, recursive); announceLocalWorkspaceChange(result.deleted); return changed({ ...result, succeeded: ids.length, failed: 0, results: ids.map(id => ({ id, ok: true })) });
		}
	};
	local.attachments = { ...local.attachments,
		saveLocalFile: async (input: Parameters<ReturnType<typeof anonymousThings>['saveFile']>[0], request?: { signal?: AbortSignal }) => {
			const row = await service().saveFile(input, request?.signal); return changed({ ok: true, attachment: { id: row.id, ...row.crystal } });
		},
		readLocalFile: async ({ id }: { id: string }, request?: { signal?: AbortSignal }) => {
			const { row, bytes } = await service().readFile(id, request?.signal); return { ok: true, attachment: { id: row.id, ...row.crystal }, bytes };
		},
		// Local files are renamed/annotated in place. Without this the shared media
		// and Thing menus offer rename for an owned local file and then fail closed
		// on the blocked cloud method.
		annotate: async ({ id, ...patch }: { id: string; title?: string | null; description?: string | null; filenamePreview?: string | null }) => {
			const row = await service().annotateFile({ id, ...patch }); return changed({ ok: true, attachment: { id: row.id, ...row.crystal } });
		},
		remove: async ({ id }: { id: string }) => { const row = await service().get(id); if (!isLocalAttachment(row)) throw new WorkspaceError('INVALID_ATTACHMENT', 'This Thing is not a local attachment'); if (row.localAttachment.draftId) return { ok: true, deferred: true }; const result = await service().remove([id]); announceLocalWorkspaceChange(result.deleted); return changed(result); }
	};
	const browse = (kind: 'component' | 'schema') => async (args: Record<string, unknown> = {}) => {
		lease.assertCurrent();
		if (args.device === true || args.mine || args.library) {
			const bundled = kind === 'component' ? (await import('../components/ComponentsLibrary/bundledComponentCatalog')).bundledComponentEntries() : [];
			lease.assertCurrent();
			const result = await browseLocalDefinitions(await service().snapshot(), kind, args, workspaceScopeKey({ kind: 'anonymous' }), project, bundled);
			lease.assertCurrent(); return result;
		}
		const query = new URLSearchParams(Object.entries(args).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
		return publicWorkspaceRead(`/api/v1/${kind}s/browse?${query}`, `api.${kind}s-browse`, '1.0.0');
	};
	local.schemas = { ...local.schemas, list: async () => ({ ok: true, schemas: crystalSchemas() }), browse: browse('schema') };
	local.components = { ...local.components, browse: browse('component') };
	const themes = () => { lease.assertCurrent(); return new LocalThemes(anonymousWorkspaceDatabase(), lease); };
	local.themes = {
		list: () => themes().list(),
		save: async (input: Parameters<LocalThemes['save']>[0]) => changed(await themes().save(input)),
		remove: async ({ id }: { id: string }) => changed(await themes().remove(id)),
		setActive: async ({ themeId }: { themeId: string | null }) => changed(await themes().setActive(themeId)),
		getShared: ({ id }: { id: string }) => { lease.assertCurrent(); return id.startsWith('local-') ? themes().get(id) : publicWorkspaceRead(`/api/v1/themes/shared?id=${encodeURIComponent(id)}`, 'api.themes-shared', '1.0.0'); },
		listShared: (args?: { limit?: number }) => { lease.assertCurrent(); return publicWorkspaceRead(`/api/v1/themes/shared${args?.limit ? `?limit=${encodeURIComponent(args.limit)}` : ''}`, 'api.themes-shared', '1.0.0'); }
	};
	const actions = async () => { lease.assertCurrent(); const { LocalActions } = await import('./actions'); lease.assertCurrent(); return new LocalActions(anonymousWorkspaceDatabase(), { kind: 'anonymous' }, lease); };
	local.actions = { ...local.actions, run: async (input: { action: string; inputs?: unknown; source?: string }) => changed(await (await actions()).run(input)), runs: async (query: { action?: string; limit?: number }) => (await actions()).runs(query) };
	local.algorithms = {
		list: () => algorithms().list(),
		create: async (input: Parameters<LocalAlgorithms['create']>[0]) => changed(await algorithms().create(input)),
		update: async (input: Parameters<LocalAlgorithms['update']>[0]) => changed(await algorithms().update(input)),
		remove: async ({ id }: { id: string }) => changed(await algorithms().remove(id)),
		setActive: async ({ algorithmId }: { algorithmId: string | null }) => changed(await algorithms().setActive(algorithmId)),
		track: (input: Parameters<LocalAlgorithms['track']>[0]) => algorithms().track(input),
		search: (args: Record<string, unknown> = {}) => { lease.assertCurrent(); const query = new URLSearchParams(Object.entries(args).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])); return publicWorkspaceRead(`/api/v1/algorithms/search?${query}`, 'api.algorithms-search', '1.0.0'); },
		getShared: ({ id }: { id: string }) => { lease.assertCurrent(); return publicWorkspaceRead(`/api/v1/algorithms/shared?id=${encodeURIComponent(id)}`, 'api.algorithms-shared', '1.0.0'); }
	};

	return local as T;
}

export async function resolveLocalWebpage(target: LocalWebpageTarget) {
	const lease = anonymousWorkspaceLease(), things = anonymousThings();
	const resolved = resolveWorkspacePage(await things.snapshot(), target, LOCAL_WORKSPACE_OWNER);
	const localReference = target.kind === 'id' && (target.id.startsWith('local-') || await things.hasReference(target.id));
	lease.assertCurrent();
	if (!resolved.page && target.kind === 'id' && !localReference) {
		return publicWorkspaceRead(`/api/v1/webpages/resolve?id=${encodeURIComponent(target.id)}${target.key ? `&key=${encodeURIComponent(target.key)}` : ''}`, 'api.webpages-resolve', '1.3.0');
	}
	return { ok: true, page: resolved.page ? localThingProjection(resolved.page, LOCAL_WORKSPACE_OWNER) : null,
		source: resolved.page ? 'user' as const : null, components: resolved.components.map(row => localThingProjection(row, LOCAL_WORKSPACE_OWNER)), refs: resolved.refs };
}
