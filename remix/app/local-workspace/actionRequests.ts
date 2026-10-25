import type { BrowserActionHost } from '../components/Actions/browserActionRuntime';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';
import { localThingProjection, LocalThings, type ThingWrite } from './things';
import { WorkspaceError, workspaceScopeKey, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';
import { searchLocalThings } from './structuredSearch';
import { localPostProjection, localTargetIndex } from './posts';
import { localProfileRequestSupported, localProfileRequest } from './actionProfileRequests';
import type { LocalThing } from './things';

type LocalFileActions = {
	library(): Promise<{ things: LocalThing[] }>;
	annotateFile(input: { id: string; title?: string | null; description?: string | null; filenamePreview?: string | null }): Promise<LocalThing>;
	remove(id: string): Promise<unknown>;
};

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
const localBulkSupported = (step: Record<string, unknown>) => {
	const body = step.body as Record<string, unknown> | undefined;
	return step.path === '/api/v1/things/bulk' && step.method === 'POST' && step.feature === 'api.things-bulk'
		&& capabilitySatisfies('1.6.0', String(step.minimumVersion)) && onlyFields(step.query, [])
		&& onlyFields(body, ['op', 'ids', 'folderId']) && ['move', 'copy', 'delete'].includes(String(body?.op));
};
export const localActionRequestSupported = (step: Record<string, unknown>, scope?: WorkspaceScope) => {
	if (localProfileRequestSupported(step, scope)) return true;
	if (step.path === '/api/v1/attachments/annotate' && step.method === 'POST' && step.feature === 'api.attachment-annotate' && capabilitySatisfies('1.2.0', String(step.minimumVersion)))
		return onlyFields(step.query, []) && onlyFields(step.body, ['id', 'title', 'description', 'filenamePreview']) && typeof (step.body as Record<string, unknown> | undefined)?.id === 'string';
	if (step.path === '/api/v1/attachments/delete' && step.method === 'POST' && step.feature === 'api.attachment-delete' && capabilitySatisfies('1.8.0', String(step.minimumVersion)))
		return onlyFields(step.query, []) && onlyFields(step.body, ['id']) && typeof (step.body as Record<string, unknown> | undefined)?.id === 'string';
	if (localSearchSupported(step) || localBulkSupported(step)) return true;
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
	store?: (lease: WorkspaceLease) => Pick<LocalThings, 'get' | 'list' | 'snapshot' | 'create' | 'update' | 'move' | 'import'> & {
		remove(ids: string[]): Promise<unknown>;
		export: (...args: Parameters<LocalThings['export']>) => Promise<Awaited<ReturnType<LocalThings['export']>> & { assertCurrentInTransaction?: (tx: WorkspaceTransaction) => Promise<void> }>;
	}, fileActions?: (lease: WorkspaceLease) => LocalFileActions
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
		const files = fileActions?.(active);
		const query = object(step.query || {});
		let result: unknown;
		if (localProfileRequestSupported(step, scope)) {
			// Match the endpoint's JSON projection. Dedicated account view models
			// include absent optional fields; retaining undefined would break the
			// browser interpreter's lossless run-history snapshot.
			result = JSON.parse(JSON.stringify(await localProfileRequest(db, scope, active, step)));
		} else if (step.path === '/api/v1/attachments/annotate' && step.method === 'POST' && step.feature === 'api.attachment-annotate' && capabilitySatisfies('1.2.0', String(step.minimumVersion))) {
			fields(query, []);
			if (!files) refuse('This local workspace has no dedicated attachment editor');
			const body = object(step.body); fields(body, ['id', 'title', 'description', 'filenamePreview']);
			const fileId = id(body.id);
			const library = await files.library();
			if (!library.things.some(row => row.id === fileId)) refuse('File is not in this workspace library');
			const { id: _id, ...patch } = body;
			const row = await files.annotateFile({ id: fileId, ...patch } as Parameters<LocalFileActions['annotateFile']>[0]);
			result = { ok: true, attachment: { id: row.id, ...row.crystal }, updatedAt: row.updatedAt };
		} else if (step.path === '/api/v1/attachments/delete' && step.method === 'POST' && step.feature === 'api.attachment-delete' && capabilitySatisfies('1.8.0', String(step.minimumVersion))) {
			fields(query, []);
			if (!files) refuse('This local workspace has no dedicated attachment remover');
			const body = object(step.body); fields(body, ['id']);
			const fileId = id(body.id);
			const library = await files.library();
			if (!library.things.some(row => row.id === fileId)) refuse('File is not in this workspace library');
			const outcome = await files.remove(fileId);
			result = scope.kind === 'account' ? { ok: true, local: true, queued: true } : { ok: true, local: true, deleted: true, outcome };
		} else if (localSearchSupported(step)) {
			const { scope: _scope, ...search } = object(step.body);
			const all = await things.snapshot();
			active.assertCurrent();
			const page = await searchLocalThings(all, search, workspaceScopeKey(scope));
			const index = localTargetIndex(all);
			result = { ...page, things: page.things.map(row => localThingProjection(row, actor)),
				posts: Object.fromEntries(page.things.filter(row => row.thingtime.includes('post')).map(row => [row.id, localPostProjection(row, all, actor, false, index)])),
				incomplete: scope.kind === 'account' };
		} else if (localBulkSupported(step)) {
			const body = object(step.body);
			if (!Array.isArray(body.ids) || !body.ids.length || new Set(body.ids).size !== body.ids.length)
				refuse('Choose distinct Things from this workspace');
			const ids = (body.ids as unknown[]).map(id);
			const folderId = body.folderId == null ? null : id(body.folderId);
			const results: { id: string; ok: boolean; newId?: string; error?: string; status?: number }[] = [];
			for (const targetId of ids) {
				active.assertCurrent();
				try {
					const target = await things.get(targetId);
					editableKinds(target.thingtime);
					let newId: string | undefined;
					if (body.op === 'move') await things.move([targetId], folderId);
					else if (body.op === 'copy') {
						const bundle: Awaited<ReturnType<LocalThings['export']>> & { assertCurrentInTransaction?: (tx: WorkspaceTransaction) => Promise<void> } = await things.export([targetId], { signal });
						// A folder/dependency closure cannot smuggle protected content
						// through this editable-only endpoint adapter.
						for (const row of bundle.manifest.things) editableKinds(row.thingtime);
						await bundle.assertCurrent(signal);
						newId = (await things.import(bundle.manifest, folderId, bundle.files, signal, bundle.assertCurrentInTransaction)).idMap[targetId];
					} else await things.remove([targetId]);
					results.push({ id: targetId, ok: true, ...(newId ? { newId } : {}) });
				} catch (error) {
					active.assertCurrent();
					results.push({ id: targetId, ok: false, error: error instanceof Error ? error.message : 'Local operation failed',
						status: error instanceof WorkspaceError ? error.status : 500 });
				}
			}
			const succeeded = results.filter(row => row.ok).length;
			result = { ok: true, op: body.op, results, succeeded, failed: results.length - succeeded };
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
