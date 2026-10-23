import type { BrowserActionHost } from '../components/Actions/browserActionRuntime';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';
import { localThingProjection, LocalThings, type ThingWrite } from './things';
import { WorkspaceError, workspaceScopeKey, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope } from './storage';
import { searchLocalThings } from './structuredSearch';
import { localPostProjection, localTargetIndex } from './posts';

const refuse = (message: string): never => {
	throw new WorkspaceError('LOCAL_ACTION_REQUEST', message, 409);
};
const object = (value: unknown): Record<string, unknown> =>
	value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : refuse('This local request requires an object');
const fields = (value: Record<string, unknown>, allowed: string[]) => {
	for (const key of Object.keys(value)) if (!allowed.includes(key)) refuse(`The local adapter does not support the ${key} request field`);
};
const editableKinds = (kinds: unknown) => {
	if (!Array.isArray(kinds) || !kinds.length || kinds.some((kind) => !['data', 'schema', 'component', 'action', 'webpage', 'folder'].includes(kind)))
		refuse('This local request supports editable definitions, Data and folders; other kinds need their dedicated adapter');
};
// ID shape is not authority: every operation below resolves its target through
// LocalThings in the leased workspace partition, with no HTTP fallback.
const id = (value: unknown): string =>
	typeof value === 'string' && value.length > 0 && value.length <= 200
		? value
		: refuse('This request requires an ID from the local workspace');

/** This is also the account placement check, before any local effect. */
const onlyFields = (value: unknown, allowed: string[]) => value === undefined ||
	(!!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key)));
// Require an authored owner scope before placement. Never reinterpret a public,
// other-author or ranked text search as a device-only result.
const localSearchSupported = (step: Record<string, unknown>) => {
	const body = step.body as Record<string, unknown> | undefined;
	return step.path === '/api/v1/things/search' && step.method === 'POST' && step.feature === 'api.things-search'
		&& capabilitySatisfies('1.4.0', String(step.minimumVersion)) && onlyFields(step.query, [])
		&& onlyFields(body, ['scope', 'mode', 'conditions', 'thingtime', 'sort', 'cursor', 'limit']) && body?.scope === 'mine'
		&& (body.sort === undefined || body.sort === 'newest' || body.sort === 'oldest');
};
export const localActionRequestSupported = (step: Record<string, unknown>) => {
	if (localSearchSupported(step)) return true;
	if (step.path === '/api/v1/actions/run' && step.method === 'POST' && step.feature === 'api.actions-run' && capabilitySatisfies('1.10.0', String(step.minimumVersion)))
		return onlyFields(step.query, []) && onlyFields(step.body, ['action', 'inputs', 'source']);
	if (step.path !== '/api/v1/things' || step.feature !== 'api.things' || !capabilitySatisfies('1.33.0', String(step.minimumVersion))) return false;
	if (step.method === 'GET') return step.body === undefined && onlyFields(step.query, ['id', 'thingtime', 'folder', 'target', 'cursor', 'limit']);
	if (step.method === 'DELETE') return onlyFields(step.query, ['id']) && onlyFields(step.body, ['id']);
	if (step.method !== 'POST' && step.method !== 'PATCH') return false;
	if (!onlyFields(step.query, []) || !onlyFields(step.body, ['thingtime', 'crystal', 'extended', 'tags', 'folderId', 'targetId', 'acl', ...(step.method === 'PATCH' ? ['id', 'expectedUpdatedAt'] : [])])) return false;
	const body = step.body as Record<string, unknown> | undefined;
	return body?.acl === undefined || JSON.stringify(body.acl) === '["tt:user"]';
};

/** Closed endpoint adapter for the existing browser interpreter. These saved
 * http.request steps describe operations; this host never performs HTTP. */
export function localActionRequests(
	db: WorkspaceDatabase,
	scope: WorkspaceScope,
	lease: WorkspaceLease,
	runData: (body: { action: string; inputs?: unknown }, lease: WorkspaceLease) => Promise<unknown>,
	store?: (lease: WorkspaceLease) => Pick<LocalThings, 'get' | 'list' | 'snapshot' | 'create' | 'update'> & { remove(ids: string[]): Promise<unknown> }
): BrowserActionHost['request'] {
	return async (step, actor, signal) => {
		const active: WorkspaceLease = {
			assertCurrent() {
				lease.assertCurrent();
				signal.throwIfAborted();
				if (actor !== (scope.kind === 'account' ? scope.ownerId : 'local-workspace')) refuse('Workspace changed');
				if (scope.kind === 'account' && !store) refuse('Account Actions require their dedicated sync adapter');
			},
			onInvalidate(callback) {
				const unsubscribe = lease.onInvalidate(callback);
				signal.addEventListener('abort', callback, { once: true });
				return () => {
					unsubscribe();
					signal.removeEventListener('abort', callback);
				};
			}
		};
		active.assertCurrent();
		const things = store ? store(active) : new LocalThings(db, scope, active);
		const query = object(step.query || {});
		let result: unknown;
		if (localSearchSupported(step)) {
			const { scope: _scope, ...search } = object(step.body);
			const all = await things.snapshot();
			active.assertCurrent();
			const page = await searchLocalThings(all, search, workspaceScopeKey(scope));
			const index = localTargetIndex(all);
			result = { ...page, things: page.things.map(row => localThingProjection(row, actor)),
				posts: Object.fromEntries(page.things.filter(row => row.thingtime.includes('post')).map(row => [row.id, localPostProjection(row, all, actor, false, index)])),
				incomplete: scope.kind === 'account' };
		} else if (
			step.path === '/api/v1/actions/run' &&
			step.method === 'POST' &&
			step.feature === 'api.actions-run' &&
			capabilitySatisfies('1.10.0', step.minimumVersion)
		) {
			fields(query, []);
			const body = object(step.body);
			fields(body, ['action', 'inputs', 'source']);
			if (typeof body.action !== 'string') refuse('Choose a saved local Action');
			result = await runData({ action: body.action as string, inputs: body.inputs }, active);
		} else if (step.path === '/api/v1/things' && step.feature === 'api.things' && capabilitySatisfies('1.33.0', step.minimumVersion)) {
			if (step.method === 'GET') {
				if (step.body !== undefined) refuse('GET requests cannot contain a body');
				if ('id' in query) {
					fields(query, ['id']);
					result = { ok: true, thing: localThingProjection(await things.get(id(query.id)), actor) };
				} else {
					fields(query, ['thingtime', 'folder', 'target', 'cursor', 'limit']);
					for (const key of ['thingtime', 'folder', 'target', 'cursor'])
						if (query[key] !== undefined && typeof query[key] !== 'string') refuse(`Invalid ${key} query`);
					if (query.limit !== undefined && (!/^\d+$/.test(String(query.limit)) || Number(query.limit) < 1 || Number(query.limit) > 200))
						refuse('List limit must be between 1 and 200');
					const page = await things.list(query);
					result = { ok: true, ...page, things: page.things.map((row) => localThingProjection(row, actor)) };
				}
			} else if (step.method === 'POST' || step.method === 'PATCH') {
				fields(query, []);
				const body = object(step.body);
				fields(body, [
					'thingtime',
					'crystal',
					'extended',
					'tags',
					'folderId',
					'targetId',
					'acl',
					...(step.method === 'PATCH' ? ['id', 'expectedUpdatedAt'] : [])
				]);
				if (body.acl !== undefined && JSON.stringify(body.acl) !== '["tt:user"]') refuse('A local Action cannot grant account or public access');
				const { acl: _acl, ...input } = body;
				const previous = step.method === 'PATCH' ? await things.get(id(body.id)) : null;
				const kinds = previous?.thingtime || body.thingtime;
				editableKinds(kinds);
				if (previous && body.thingtime !== undefined && JSON.stringify(body.thingtime) !== JSON.stringify(previous.thingtime))
					refuse('An update cannot change a Thing kind');
				const row = previous ? await things.update({ ...input, id: previous.id } as ThingWrite & { id: string }) : await things.create(input);
				result = { ok: true, id: row.id, thing: localThingProjection(row, actor) };
			} else if (step.method === 'DELETE') {
				const body = step.body === undefined ? {} : object(step.body);
				fields(body, ['id']);
				fields(query, ['id']);
				if (body.id && query.id && body.id !== query.id) refuse('Conflicting delete IDs');
				const target = await things.get(id(body.id ?? query.id));
				editableKinds(target.thingtime);
				result = await things.remove([target.id]);
			} else refuse('This method has no local adapter; no network request was made');
		} else refuse('This browser Action requests a service or version without a local adapter; no network request was made');
		active.assertCurrent();
		if (new TextEncoder().encode(JSON.stringify(result)).byteLength > step.maxResultBytes)
			refuse('The local request response exceeds this Action’s byte budget');
		return result;
	};
}
