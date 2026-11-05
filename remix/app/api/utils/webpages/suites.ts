import { installMaterializedSuite, suiteBundleVersion, type InstallSuiteResult } from '~/schemas/suiteInstallation';
import { type BehaviourSuite } from '~/schemas/behaviourSuites';
import { getThingsCollection, withMongoTransaction } from '../mongodb/collections';
import { createThing, fail, isFail, toPublicThings, updateThing, type Fail, type Viewer, type ThingWriteTransaction } from '../things/things';
import { ACL_OWNER } from '~/schemas/registry';
import { ALL_SUITES } from '~/schemas/appSuites/index';
import { appendTimelineEvent, lockTimelineOwner, readTimelineEntries } from '../timeline/repository';
import { StorageMutationError } from '../storage/storageCore';
import { suiteInstallIds, suiteInstallSnapshot, suiteSnapshotDigest, SUITE_SNAPSHOT_CHARS, suiteReceiptEvent, suiteReceiptEventId, suiteReceiptValue, validateSuiteReceiptSnapshots, type SuiteReceiptScope } from './suiteInstallReceipt';
export type { InstallSuiteResult } from '~/schemas/suiteInstallation';

export class SuiteInstallAdmissionError extends Error {
	readonly code = 'WORKSPACE_CHANGED';
	constructor(readonly status: 401 | 409) { super('The account or database changed. Your device changes have been kept.'); }
}
export type SuiteInstallFailure = Fail & { code?: 'WORKSPACE_CHANGED' | 'SUITE_BUNDLE_CHANGED' };
class InstallRefused extends Error {
	constructor(readonly result: SuiteInstallFailure) { super(result.error); }
}
export type SuiteInstallOptions = {
	onlyMissing?: boolean;
	// Present only for the identity-pinned local install reconciliation protocol.
	requestId?: string;
	bundleVersion?: string;
	origin?: string;
	dataPlane?: string;
	admit?: () => Promise<void>;
};
const defaults = { getThingsCollection, withMongoTransaction, createThing, updateThing, toPublicThings, appendTimelineEvent, readTimelineEntries, lockTimelineOwner, suites: ALL_SUITES };

/** One active-plane transaction owns definition lookup, canonical writes,
 * accounting, History and the durable replay receipt. Timeline's existing owner
 * lock serializes installers across processes without imposing a new unique
 * constraint on users' pre-existing duplicated definition keys. */
export function createSuiteInstaller(overrides: Partial<typeof defaults> = {}) {
	const deps = { ...defaults, ...overrides };
	return async (viewer: Viewer, key: unknown, options: SuiteInstallOptions = {}): Promise<SuiteInstallFailure | InstallSuiteResult> => {
		if (!viewer?.id) return fail(401, 'Sign in to install a suite');
		const suiteKey = typeof key === 'string' ? key.trim() : '';
		const suite: BehaviourSuite | undefined = deps.suites.find(entry => entry.key === suiteKey);
		if (!suite && options.requestId === undefined) return fail(404, `No suite matches "${suiteKey.slice(0, 40)}"`);
		let scope: SuiteReceiptScope | null = null;
		if (options.requestId !== undefined) {
			if (viewer.pat || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.requestId) || options.onlyMissing !== true ||
				!options.origin || !options.dataPlane || !options.admit || !/^suite-bundle-v1:[a-f0-9]{64}$/.test(options.bundleVersion ?? '')) return fail(400, 'Invalid suite installation operation');
			scope = { ownerId: viewer.id, origin: options.origin, dataPlane: options.dataPlane, requestId: options.requestId, key: suiteKey, onlyMissing: true, bundleVersion: options.bundleVersion! };
		}
		const effects: (() => Promise<void>)[] = [];
		try {
			const things = await deps.getThingsCollection();
			const replay = async (session: any): Promise<InstallSuiteResult | null> => {
				if (!scope) return null;
				const id = suiteReceiptEventId(scope.requestId), entries = await deps.readTimelineEntries(things, viewer.id, [id], session);
				if (!entries.length) return null;
				try {
					if (entries.length !== 1) throw new Error();
					const value = suiteReceiptValue(entries[0].event, scope, id, 'suite-install-receipt');
					const result = value.result as InstallSuiteResult, ids = suiteInstallIds(result);
					if (!Array.isArray(value.snapshotEvents) || value.snapshotEvents.length !== ids.length) throw new Error();
					const snapshots: any[] = [];
					for (let index = 0; index < value.snapshotEvents.length; index++) {
						const reference = value.snapshotEvents[index], pieces: string[] = [];
						if (!reference || !Array.isArray(reference.ids) || !reference.ids.length || typeof reference.sha256 !== 'string') throw new Error();
						for (let offset = 0; offset < reference.ids.length; offset += 128) {
							const eventIds = reference.ids.slice(offset, offset + 128);
							const parts = await deps.readTimelineEntries(things, viewer.id, eventIds, session);
							for (let j = 0; j < eventIds.length; j++) {
								const eventId = eventIds[j], ordinal = offset + j;
								if (eventId !== `${suiteReceiptEventId(scope.requestId)}-part-${index}-chunk-${ordinal}`) throw new Error();
								const part = parts.find(part => part.event.id === eventId);
								if (!part) throw new Error();
								const chunk = suiteReceiptValue(part.event, scope, eventId, 'suite-install-part');
								if (part.event.thingId !== reference.thingId || chunk.ordinal !== ordinal || typeof chunk.data !== 'string' || !chunk.data.length || chunk.data.length > SUITE_SNAPSHOT_CHARS) throw new Error();
								pieces.push(chunk.data);
							}
						}
						const text = pieces.join('');
						if (suiteSnapshotDigest(text) !== reference.sha256) throw new Error();
						const snapshot = JSON.parse(text);
						if (snapshot.id !== reference.thingId) throw new Error();
						snapshots.push(snapshot);
					}
					validateSuiteReceiptSnapshots(result, scope, snapshots);
					return { ...result, receipt: { ...result.receipt!, snapshots } };
				} catch { throw new InstallRefused(fail(409, 'Suite installation operation changed. Your device changes have been kept.')); }
			};
			const perform = async () => deps.withMongoTransaction(async session => {
				effects.length = 0;
				await options.admit?.();
				await deps.lockTimelineOwner(things, viewer.id, session);
				const prior = await replay(session);
				if (prior) { await options.admit?.(); return prior; }
				if (!suite) throw new InstallRefused(fail(404, 'The suite is no longer bundled. Your device changes have been kept.'));
				const bundleVersion = await suiteBundleVersion(suite);
				if (scope && scope.bundleVersion !== bundleVersion) throw new InstallRefused({ ...fail(409, 'The bundled suite changed. Your device changes have been kept.'), code: 'SUITE_BUNDLE_CHANGED' });
				const transaction: ThingWriteTransaction = { session, afterCommit: effect => effects.push(effect) };
				const result = await installMaterializedSuite(suite, {
					find: async (kind, field, keys) => {
						if (!keys.length) return new Map();
						const docs = await things.find({ ownerId: viewer.id, thingtime: kind, appId: { $exists: false }, [`crystal.${field}`]: { $in: keys } } as any, { session })
							.sort({ 'crystal.version': -1, createdAt: -1, shareId: 1 }).toArray();
						const out = new Map();
						for (const doc of docs) { const partKey = doc.crystal?.[field]; if (typeof partKey === 'string' && !out.has(partKey)) out.set(partKey, { shareId: doc.shareId, crystal: doc.crystal ?? {} }); }
						return out;
					},
					create: async (kind, crystal) => {
						const result = await deps.createThing(viewer.id, { thingtime: [kind], crystal, acl: [ACL_OWNER] }, viewer, null, { transaction });
						if (isFail(result)) throw new InstallRefused(result);
						return result.doc.shareId;
					},
					update: async (id, crystal) => {
						const result = await deps.updateThing(viewer, id, { crystal }, { transaction });
						if (isFail(result)) throw new InstallRefused(result);
					}
				}, options);
				if (scope) {
					const ids = suiteInstallIds(result), docs = await things.find({ ownerId: viewer.id, shareId: { $in: ids } } as any, { session }).toArray();
					const snapshots = (await deps.toPublicThings(docs, viewer)).map(suiteInstallSnapshot);
					result.receipt = { requestId: scope.requestId, ownerId: viewer.id, origin: scope.origin, dataPlane: scope.dataPlane,
						bundleVersion, snapshots };
					validateSuiteReceiptSnapshots(result, scope, snapshots);
					const at = new Date().toISOString(), snapshotEvents: { thingId: string; ids: string[]; sha256: string }[] = [];
					for (let index = 0; index < snapshots.length; index++) {
						const text = JSON.stringify(snapshots[index]), ids: string[] = [];
						for (let offset = 0, ordinal = 0; offset < text.length; offset += SUITE_SNAPSHOT_CHARS, ordinal++) {
							const id = `${suiteReceiptEventId(scope.requestId)}-part-${index}-chunk-${ordinal}`; ids.push(id);
							await deps.appendTimelineEvent(things, suiteReceiptEvent(scope, id, snapshots[index].id, 'suite-install-part', { ordinal, data: text.slice(offset, offset + SUITE_SNAPSHOT_CHARS) }, at), session);
						}
						snapshotEvents.push({ thingId: snapshots[index].id, ids, sha256: suiteSnapshotDigest(text) });
					}
					await deps.appendTimelineEvent(things, suiteReceiptEvent(scope, suiteReceiptEventId(scope.requestId), result.entryPageId, 'suite-install-receipt', {
						result: { ...result, receipt: { ...result.receipt, snapshots: [] } }, snapshotEvents
					}, at), session);
				}
				await options.admit?.();
				return result;
			});
			// Simultaneous creation of the first protected Timeline folder can
			// lose the existing shareId unique-index race before Mongo retries a
			// write conflict. Retry that aborted transaction once, never individual
			// parts or an uncertain write outside the durable operation.
			let result;
			try { result = await perform(); }
			catch (error: any) { if (error?.code !== 11000) throw error; result = await perform(); }
			for (const effect of effects) await effect();
			return result;
		} catch (error) {
			if (error instanceof InstallRefused) return error.result;
			if (error instanceof SuiteInstallAdmissionError) {
				const refusal: SuiteInstallFailure = { ...fail(error.status, error.message), code: error.code };
				return refusal;
			}
			if (error instanceof StorageMutationError) return fail(error.status, error.message);
			return fail(503, 'Suite installation could not be confirmed. Retry the same operation; your device changes have been kept.');
		}
	};
}
export const installSuiteForViewer = createSuiteInstaller();
