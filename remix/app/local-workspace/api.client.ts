import { resolveWorkspacePage, type LocalWebpageTarget } from './webpageResolution';
import { publicWorkspaceRead } from './publicRead.client';
import { draftRequest } from '../drafts/draftClient';
import { localThingProjection, type ThingWrite } from './things';
import { anonymousThings, anonymousWorkspaceLease, announceLocalWorkspaceChange, LOCAL_WORKSPACE_OWNER } from './runtime.client';
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
		const things = service(); const row = update ? await things.update(input as ThingWrite & { id: string }) : await things.create(input);
		return changed({ ok: true, id: row.id, thing: project(row) });
	};
	const local = blocked(remote);
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
		local[group] = { ...local[group], ...Object.fromEntries(methods.filter(name => remote[group][name]).map(name => [name, remote[group][name]])) };
	};
	publicOnline('waitlist', ['join']);
	publicOnline('profile', ['get', 'activity', 'search']);
	publicOnline('themes', ['getShared', 'listShared']);
	local.drafts = (input?: Record<string, unknown>, query?: Record<string, string>) => { lease.assertCurrent(); return draftRequest(LOCAL_WORKSPACE_OWNER, input, query); };
	local.things = { ...local.things,
		feed: async (args: Record<string, unknown> = {}) => {
			lease.assertCurrent(); const query = new URLSearchParams(Object.entries({ ...args, anon: 1 }).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
			return publicWorkspaceRead(`/api/v1/things/feed?${query}`, 'api.things-feed', '1.8.0');
		},
		trending: async () => { lease.assertCurrent(); return publicWorkspaceRead('/api/v1/things/trending?anon=1', 'api.things-trending', '1.0.0'); },
		get: async ({ id, key, sharedRoot }: { id: string; key?: string; sharedRoot?: string }, options?: { signal?: AbortSignal }) => {
			lease.assertCurrent();
			if (id.startsWith('local-')) return { ok: true, thing: project(await service().get(id)) };
			const query = new URLSearchParams({ id, ...(key ? { key } : {}), ...(sharedRoot ? { sharedRoot } : {}) });
			return publicWorkspaceRead(`/api/v1/things?${query}`, 'api.things', '1.31.0', options?.signal);
		},
		list: async (query: Parameters<ReturnType<typeof anonymousThings>['list']>[0], options?: { signal?: AbortSignal }) => {
			options?.signal?.throwIfAborted(); const result = await service().list(query); options?.signal?.throwIfAborted();
			return { ok: true, ...result, things: result.things.map(project) };
		},
		create: (input: ThingWrite) => write(input), update: (input: ThingWrite) => write(input, true),
		renameLibrary: ({ id, displayTitle, expectedUpdatedAt }: { id: string; displayTitle: string; expectedUpdatedAt?: string }) => write({ id, crystal: { title: displayTitle }, expectedUpdatedAt }, true),
		export: async ({ ids, ...options }: { ids: string[] }, request?: { signal?: AbortSignal }) => {
			const { manifest } = await service().export(ids, { ...options, signal: request?.signal });
			return { ok: true, plan: { roots: manifest.roots, things: manifest.things, files: [] } };
		},
		import: async ({ manifest, folderId }: { manifest: unknown; folderId?: string | null }) => changed(await service().import(manifest, folderId)),
		bulk: async ({ op, ids, recursive, folderId = null }: { op: string; ids: string[]; recursive?: boolean; folderId?: string | null }) => {
			if (op === 'move') return changed(await service().move(ids, folderId));
			if (op === 'copy') { const bundle = await service().export(ids); return changed(await service().import(bundle.manifest, folderId)); }
			if (op !== 'delete') throw new WorkspaceError('LOCAL_OPERATION_UNAVAILABLE', `Local bulk ${op} is not available yet`);
			return changed(await service().remove(ids, recursive));
		}
	};
	const browse = (kind: 'component' | 'schema') => async (args: Record<string, unknown> = {}) => {
		lease.assertCurrent();
		if (args.mine || args.library) {
			const result = await service().list({ thingtime: kind, cursor: args.cursor as string | undefined, limit: Number(args.limit) || 50 });
			const entries = result.things.map(project).filter(row => !args.q || JSON.stringify(row.crystal).toLowerCase().includes(String(args.q).toLowerCase()));
			return { ok: true, [kind === 'component' ? 'components' : 'schemas']: entries, nextCursor: result.nextCursor };
		}
		const query = new URLSearchParams(Object.entries(args).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
		return publicWorkspaceRead(`/api/v1/${kind}s/browse?${query}`, `api.${kind}s-browse`, '1.0.0');
	};
	local.schemas = { ...local.schemas, list: async () => ({ ok: true, schemas: crystalSchemas() }), browse: browse('schema') };
	local.components = { ...local.components, browse: browse('component') };
	return local as T;
}

export async function resolveLocalWebpage(target: LocalWebpageTarget) {
	const things = anonymousThings();
	const resolved = resolveWorkspacePage(await things.snapshot(), target, LOCAL_WORKSPACE_OWNER);
	if (!resolved.page && target.kind === 'id' && !target.id.startsWith('local-')) {
		return publicWorkspaceRead(`/api/v1/webpages/resolve?id=${encodeURIComponent(target.id)}${target.key ? `&key=${encodeURIComponent(target.key)}` : ''}`, 'api.webpages-resolve', '1.3.0');
	}
	return { ok: true, page: resolved.page ? localThingProjection(resolved.page, LOCAL_WORKSPACE_OWNER) : null,
		source: resolved.page ? 'user' as const : null, components: resolved.components.map(row => localThingProjection(row, LOCAL_WORKSPACE_OWNER)), refs: resolved.refs };
}
