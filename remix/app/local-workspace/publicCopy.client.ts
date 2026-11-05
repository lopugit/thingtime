import { REMOTE_TRANSFER_EXPORT_VERSION } from '../utils/thingTransfer/remoteCapabilities';
import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from '../api/utils/capabilities/capabilityContract';
import { canForkThing } from '../components/Sharing/forkThingCore';
import { compositionReferences } from '../api/utils/actions/sharedCompositionCore';
import { compositionAttachmentIds } from '../api/utils/actions/compositionMediaCore';
import { bundleFromPlan } from '../utils/thingTransfer/browser';
import { withExportDeadline } from '../utils/thingTransfer/exportDeadline';
import type { TransferPlan } from '../utils/thingTransfer/plan';
import type { ThingTransfer } from '../utils/thingTransfer/format';
import type { LocalThings } from './things';
import { WorkspaceError, type WorkspaceLease } from './storage';

const refuse = (message: string, code = 'PUBLIC_COPY_UNAVAILABLE', status = 409): never => {
	throw new WorkspaceError(code, message, status);
};

const assertCompleteCopy = (manifest: ThingTransfer) => {
	const docs = new Map(manifest.things.map(thing => [thing.id, thing])), media = new Set([...manifest.files, ...(manifest.links ?? [])].map(file => file.id));
	const pending = manifest.roots.map(id => ({ id, args: undefined as Record<string, unknown> | undefined })), seen = new Set<string>();
	for (let index = 0; index < pending.length; index++) {
		const { id, args } = pending[index], key = JSON.stringify([id, args]);
		if (seen.has(key)) continue;
		seen.add(key);
		const thing = docs.get(id)!;
		for (const reference of compositionReferences(thing.thingtime, thing.crystal, args)) {
			const target = docs.get(reference.ref);
			if (!target) { if (reference.optional) continue; refuse('A required shared dependency is missing.'); }
			if (!target.thingtime.includes(reference.kind)) refuse('A shared dependency has the wrong content kind.');
			pending.push({ id: target.id, args: reference.args });
		}
		for (const id of compositionAttachmentIds(thing.thingtime, thing.crystal, { args,
			component: reference => docs.get(reference)?.crystal })) if (!media.has(id)) refuse('A required shared file is missing.');
	}
};

/** A public read followed by a private device import. The server's ordinary
 * export resolver owns all root/dependency/media authorization. No cookie,
 * account writer, remote Action, upload or cached authorization is involved. */
export async function copyPublicThing(input: { id: string; key?: string }, deps: {
	origin: string; things: LocalThings; lease: WorkspaceLease; fetch?: typeof fetch;
}, parentSignal?: AbortSignal) {
	const { lease, things } = deps, origin = new URL(deps.origin).origin;
	if (origin !== deps.origin || !input || Object.keys(input).some(key => !['id', 'key'].includes(key)) ||
		typeof input.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(input.id) ||
		(input.key !== undefined && (typeof input.key !== 'string' || input.key.length > 256)))
		refuse('Choose a valid shared Thing.', 'INVALID_COPY', 400);
	const args = { id: input.id, ...(input.key ? { key: input.key } : {}) }, controller = new AbortController();
	const off = lease.onInvalidate(() => controller.abort(new Error('Workspace changed')));
	const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
	const check = () => { lease.assertCurrent(); signal.throwIfAborted(); };
	const read = async (path: string, init: RequestInit = {}): Promise<Response> => {
		check();
		const url = new URL(path, origin);
		if (url.origin !== origin || url.username || url.password ||
			![THINGTIME_CAPABILITY_MANIFEST_PATH, '/api/v1/things/export', '/api/v1/attachments/content'].includes(url.pathname))
			return refuse('This copy requested an unsupported content source.');
		let response: Response;
		try { response = await (deps.fetch ?? fetch)(url.href, { ...init, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: init.signal ?? signal }); }
		catch { check(); return refuse('Shared content could not be downloaded. Please retry.', 'PUBLIC_COPY_UNAVAILABLE', 502); }
		check();
		if (response.redirected || (response.url && new URL(response.url).origin !== origin)) {
			await response.body?.cancel().catch(() => {});
			return refuse('Shared content redirected away from its selected origin.');
		}
		return response;
	};
	const exportPlan = () => withExportDeadline(async metadataSignal => {
		const response = await read('/api/v1/things/export', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ ids: [args.id], ...(args.key ? { key: args.key } : {}), includeChildren: true, includeDependencies: true, includeFiles: true, includeLinks: true }), signal: metadataSignal });
		if (!response.ok) return refuse(`This shared content is unavailable (${response.status}).`, 'PUBLIC_COPY_REFUSED', response.status);
		const data = await response.json(); check();
		const plan = data?.plan as TransferPlan;
		if (data?.ok !== true || !plan || !Array.isArray(plan.roots) || plan.roots.length !== 1 || plan.roots[0] !== args.id ||
			!Array.isArray(plan.things) || !plan.things.some(thing => thing && thing.id === args.id && canForkThing(thing)))
			return refuse('The shared export did not contain the requested editable root.');
		return plan;
	}, signal);
	try {
		check();
		const manifest = await withExportDeadline(async metadataSignal => {
			const response = await read(THINGTIME_CAPABILITY_MANIFEST_PATH, { headers: { Accept: 'application/json' }, signal: metadataSignal });
			if (!response.ok) return refuse('Shared-copy capabilities are unavailable.');
			return response.json();
		}, signal);
		check();
		if (manifest?.schemaVersion !== 1 || manifest.origin !== origin || !capabilitySatisfies(manifest?.features?.['api.things-export']?.version ?? '', REMOTE_TRANSFER_EXPORT_VERSION))
			refuse('This origin does not support compatible shared exports.');
		const plan = await exportPlan(), snapshot = JSON.stringify(plan);
		if (plan.files?.length && !capabilitySatisfies(manifest?.features?.['api.attachment-content']?.version ?? '', '1.11.0'))
			refuse('This origin does not support compatible shared file downloads.');
		const originalStream = capabilitySatisfies(manifest?.features?.['api.attachment-content']?.version ?? '', '1.18.0');
		if (plan.files?.some(file => file.bytes > 16 * 1024 * 1024) && !originalStream)
			refuse('This origin needs shared original streaming support to copy these files.');
		const bundle = await bundleFromPlan(plan, { key: args.key, signal, originalStream,
			fetch: ((path: string, init: RequestInit) => {
				if (new URL(path, origin).pathname !== '/api/v1/attachments/content' || (init.method && init.method !== 'GET'))
					return Promise.reject(new WorkspaceError('PUBLIC_COPY_UNAVAILABLE', 'Unsupported shared file request', 409));
				return read(path, init);
			}) as typeof fetch });
		assertCompleteCopy(bundle.manifest);
		check();
		// Reauthorize the entire original closure after all bytes arrive. A revoked
		// root, changed dependency or different media plan cannot be committed from
		// a stale read. The resulting independent copy is a point-in-time snapshot.
		if (JSON.stringify(await exportPlan()) !== snapshot) refuse('Shared content changed while downloading. Retry the copy.', 'PUBLIC_COPY_CHANGED');
		await bundle.assertCurrent?.(signal);
		check();
		const result = await things.import(bundle.manifest, null, bundle.files, signal, async () => check());
		check();
		return { ...result, id: result.idMap[args.id] };
	} finally { off(); }
}
