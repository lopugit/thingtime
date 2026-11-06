import { CONTENT_CREATION_REQUIREMENTS } from '../../../backups/contentCreation';
import { thingtimeCapabilityManifest, capabilitySatisfies } from '../capabilities/thingtimeCapabilities';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalJsonBytes } from '../../../utils/canonicalJsonStream';
import { accountRestoreDestination, type AccountRestoreDestination } from '../../../backups/accountRestore';
import { backupJson } from '../../../backups/manifest';
import { parseTimelineEvent } from '../../../timeline/contract';
import { folderThingMatch } from '../../../schemas/folderThing';
import { fenceAccountSession } from '../auth/fenceAccountSession';
import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { StorageMutationError } from '../storage/storageCore';
import { createThing, isFail, type CreateThingInput } from '../things/things';
import { appendTimelineEvent, readTimelineEntries } from '../timeline/repository';
import { openBackupWorkspace } from './backupWorkspace';
import { CREATION_COMPLETION_ADAPTER, type ContentExecutionHold } from '../things/contentExecutionGate';
import { openBackupReferenceIndex, iterateBackupThingReferences } from './storedReferences';
import { getCurrentUser } from '../auth/getCurrentUser';

const hash = (value: unknown) => {
	const digest = createHash('sha256');
	for (const bytes of canonicalJsonBytes(value)) digest.update(bytes);
	return digest.digest('hex');
};
const updateRecordDigest = (digest: ReturnType<typeof createHash>, record: unknown) => {
	for (const bytes of canonicalJsonBytes(record)) digest.update(bytes);
	digest.update('\n');
};
const conflict = (message: string): never => { throw new StorageMutationError(409, 'storage_conflict', message); };
const ADAPTER = CREATION_COMPLETION_ADAPTER;

/** Trusted, explicitly selected ordinary-content command. This is not an
 * AccountRestorePlan and cannot claim whole-account coverage or readiness.
 * A caller must independently certify the complete selected dependency closure
 * and remapping before providing this replayable immutable record source.
 * No HTTP entry point accepts this type or a caller's claimed certification. */
export type OrdinaryRestoreReview = {
	format: 'thingtime-selected-ordinary-restore-v1';
	referenceDomain: 'ordinary-composition-v1';
	operationId: string;
	sourceSealHash: string;
	reviewHash: string;
	graphHash: string;
	count: number;
	destination: AccountRestoreDestination;
};
export type OrdinaryRestoreCreation = {
	sourceId: string;
	input: CreateThingInput;
};
const validateReview = (input: OrdinaryRestoreReview) => {
	if (!input || Object.keys(input).sort().join(',') !== 'count,destination,format,graphHash,operationId,referenceDomain,reviewHash,sourceSealHash' ||
		input.format !== 'thingtime-selected-ordinary-restore-v1' || input.referenceDomain !== 'ordinary-composition-v1' ||
		!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.operationId) ||
		![input.sourceSealHash, input.reviewHash, input.graphHash].every(value => /^[a-f0-9]{64}$/.test(value)) ||
		!Number.isSafeInteger(input.count) || input.count < 1) throw Error('Invalid selected ordinary restore review');
	const destination = accountRestoreDestination(input.destination);
	const available = thingtimeCapabilityManifest(destination.scope.apiOrigin).features;
	for (const [feature, minimum] of Object.entries(CONTENT_CREATION_REQUIREMENTS)) {
		const reviewed = destination.capabilities[feature];
		if (!reviewed || !capabilitySatisfies(reviewed, minimum) || !capabilitySatisfies(available[feature]?.version ?? '', reviewed))
			throw Error('The reviewed destination capability contract is unavailable or changed');
	}
	return { ...input, destination };
};

export const ordinaryRestoreTargetId = (review: Pick<OrdinaryRestoreReview, 'operationId' | 'destination'>, sourceId: string) =>
	'restore-' + hash([review.operationId, review.destination, sourceId]);
export const ordinaryRestoreAdmissionId = (ownerId: string, operationId: string) =>
	'restore-admission-' + hash([ownerId, operationId, 'review']);

/** Hash one record at a time. The caller streams graph records in canonical
 * topological folder/schema order; executable cycles use preallocated IDs.
 * There is no whole-graph array, total-count cutoff or wall-clock import cap. */
export async function ordinaryRestoreGraphHash(records: AsyncIterable<OrdinaryRestoreCreation>) {
	const digest = createHash('sha256');
	let count = 0;
	for await (const record of records) {
		updateRecordDigest(digest, record);
		if (!Number.isSafeInteger(++count)) throw Error('Restore graph count exceeds the exact integer range');
	}
	return { graphHash: digest.digest('hex'), count };
}

/** Disposable indexing only: never a durable receipt or write authority. The
 * exact reviewed graph must be destination-contained before the first write. */
async function preflightGraph(review: OrdinaryRestoreReview, records: () => AsyncIterable<OrdinaryRestoreCreation>, signal?: AbortSignal) {
	const workspace = await openBackupWorkspace({ diskBudget: 'available' });
	const references = await openBackupReferenceIndex(review.destination.scope.ownerId, { diskBudget: 'available' }).catch(async error => { await workspace.close(); throw error; });
	const db = workspace.db;
	try {
		db.exec(`CREATE TABLE creations(sourceId TEXT PRIMARY KEY,targetId TEXT UNIQUE NOT NULL,ordinal INTEGER UNIQUE NOT NULL,kind TEXT NOT NULL,parentId TEXT NOT NULL,recordHash TEXT NOT NULL);
			CREATE TABLE aliases(kind TEXT NOT NULL,name TEXT NOT NULL,targetId TEXT NOT NULL,UNIQUE(kind,name,targetId));
			CREATE INDEX aliases_lookup ON aliases(kind,name);
			CREATE TABLE orderedRefs(ordinal INTEGER NOT NULL,kind TEXT NOT NULL,reference TEXT NOT NULL,UNIQUE(ordinal,kind,reference));
			CREATE TABLE localRelations(reference TEXT NOT NULL);`);
		let ordinal = 0;
		const expected = await ordinaryRestoreGraphHash((async function* () {
			for await (const record of records()) {
				signal?.throwIfAborted();
				if (!record || Object.keys(record).sort().join(',') !== 'input,sourceId' || typeof record.sourceId !== 'string' || !record.sourceId ||
					!record.input || Object.keys(record.input).some(key => !['shareId', 'thingtime', 'crystal', 'extended', 'tags', 'acl', 'folderId', 'geo'].includes(key)) ||
					record.input.shareId !== ordinaryRestoreTargetId(review, record.sourceId) ||
					typeof record.input.folderId !== 'string' || !record.input.folderId) conflict('The reviewed graph must name an explicit contained destination');
				const kinds = Array.isArray(record.input.thingtime) ? record.input.thingtime : [];
				if (!kinds.length || kinds.some(kind => !['folder', 'data', 'schema', 'component', 'action', 'webpage', 'builder-thing'].includes(kind)) ||
					kinds.filter(kind => kind !== 'builder-thing').length !== 1 ||
					(record.input.acl != null && backupJson(record.input.acl) !== '["tt:user"]')) conflict('This graph requires an unsupported restore writer');
				const kind = kinds.find(kind => kind !== 'builder-thing');
				const crystal = record.input.crystal as Record<string, any>;
				if (kind === 'action' && Array.isArray(crystal?.steps) && crystal.steps.some((step: any) => step?.op === 'http.request'))
					conflict('HTTP request payload dependency remapping is unsupported by this selected writer');
				if (kind === 'data' && crystal?.parentId != null) {
					if (typeof crystal.parentId !== 'string' || !crystal.parentId) conflict('Invalid reviewed local relationship');
					db.prepare('INSERT INTO localRelations VALUES(?)').run(crystal.parentId);
				}
				if (kind === 'action') for (const capability of crystal?.capabilities ?? []) {
					if (Array.isArray(capability?.actions)) for (const action of capability.actions)
						references.addSelection(record.input.shareId as string, 'action', action);
				}

				if (['schema', 'action', 'component'].includes(kind)) {
					const alias = crystal?.[kind === 'schema' ? 'name' : `${kind}Key`];
					if (typeof alias === 'string') db.prepare('INSERT INTO aliases VALUES(?,?,?)').run(kind, alias, record.input.shareId as string);
				}
				for (const reference of iterateBackupThingReferences(kinds, crystal, { signal })) {
					if (reference && ((kind === 'data' && reference.kind === 'schema') || (kind === 'webpage' && reference.kind === 'component')))
						db.prepare('INSERT OR IGNORE INTO orderedRefs VALUES(?,?,?)').run(ordinal, reference.kind, reference.ref);
				}
				references.addIdentity(record.input.shareId as string, kinds);
				references.addContent({ shareId: record.input.shareId as string, ownerId: review.destination.scope.ownerId,
					thingtime: kinds, crystal: record.input.crystal });
				db.prepare('INSERT INTO creations(sourceId,targetId,ordinal,kind,parentId,recordHash) VALUES(?,?,?,?,?,?)')
					.run(record.sourceId, record.input.shareId as string, ordinal++, kind as string, record.input.folderId as string, hash(record));
				yield record;
			}
		})());
		if (expected.graphHash !== review.graphHash || expected.count !== review.count) conflict('The reviewed restore graph changed');
		const outside = db.prepare(`SELECT c.sourceId FROM creations c LEFT JOIN creations p ON c.parentId=p.targetId
			WHERE c.parentId<>? AND (p.targetId IS NULL OR p.kind<>'folder' OR p.ordinal>=c.ordinal) LIMIT 1`).get(review.destination.rootId);
		if (outside) conflict('A reviewed parent is missing, outside the destination, not a folder, or out of order');
		if (db.prepare('SELECT r.reference FROM localRelations r LEFT JOIN creations c ON r.reference=c.targetId WHERE c.targetId IS NULL LIMIT 1').get())
			conflict('A reviewed local relationship is unavailable or not remapped into the selected graph');
		const closure = await references.validate(async () => { signal?.throwIfAborted(); }, signal, { requireOptionalReferences: true, requireExactReferences: true });
		if (closure.discovery !== 'complete' || closure.resolution !== 'closed') conflict('The selected graph has unsupported or unavailable dependencies, including media');
		const lateDependency = db.prepare(`SELECT r.ordinal FROM orderedRefs r
			LEFT JOIN creations exact ON exact.targetId=r.reference AND exact.kind=r.kind
			LEFT JOIN aliases a ON a.kind=r.kind AND a.name=r.reference
			LEFT JOIN creations target ON target.targetId=COALESCE(exact.targetId,a.targetId)
			WHERE target.ordinal IS NULL OR target.ordinal>=r.ordinal LIMIT 1`).get();
		if (lateDependency) conflict('Reviewed schemas must precede their data and Components must precede capturing Webpages');
		// Parent-before-child also proves there can be no structural cycle.
		return { db, close: async () => { await references.close(); await workspace.close(); } };
	} catch (error) { await references.close(); await workspace.close(); throw error; }
}

/** Accepted outcome reads require current authentication and destination
 * ownership, but never source availability, scratch indexes or a new review.
 * The mutation transaction rechecks the same receipt after preflight to cover
 * another invocation committing while this caller validates its source. */
async function readCompletedCreation(request: Request, review: OrdinaryRestoreReview) {
	const ownerId = review.destination.scope.ownerId, binding = hash(review);
	const eventId = 'restore-graph-' + hash([ownerId, review.operationId]);
	const things = await getHomeThingsCollection();
	return withHomeMongoTransaction(async session => {
		await fenceAccountSession(request, ownerId, session);
		const root = await things.findOne({ shareId: review.destination.rootId, ownerId, ...folderThingMatch() }, { session });
		if (!root || root.appId != null || root.sandbox != null || root.sandboxSpace != null) conflict('The restore destination is no longer an owned folder');
		const event = (await readTimelineEntries(things, ownerId, [eventId], session))[0]?.event;
		if (!event) return null;
		if (event.id !== eventId || event.ownerId !== ownerId || event.actorId !== ownerId || event.thingId !== review.destination.rootId ||
			event.operationId !== review.operationId || event.source !== 'api' || event.branchId !== 'main' || event.parentIds.length || event.dependencies.length ||
			event.mode !== 'effect' || event.operation !== 'effect' || event.before !== null || event.after?.adapter !== ADAPTER || event.after.version !== 1 ||
			hash(event.after.value) !== hash({ binding, count: review.count })) conflict('The restore operation was reused with different reviewed content');
		return { replayed: true, eventId, count: review.count };
	});
}

/** Small-graph atomic publication primitive, not the eventual large-graph
 * coordinator. Mongo transaction resource/lifetime failures roll everything
 * back. No partially created root or dependency becomes visible. Durable
 * staging is a separate required path for graphs exceeding those resources.
 * The immutable completion effect and each ordinary content revision commit
 * with the canonical writes, so a lost reply never causes replayed mutations.
 */
export async function executeOrdinaryRestoreTransaction(
	request: Request,
	input: OrdinaryRestoreReview,
	records: () => AsyncIterable<OrdinaryRestoreCreation>,
	signal?: AbortSignal
) {
	const review = validateReview(input), destination = review.destination;
	if (isCustomMongoEndpointActive() || new URL(request.url).origin !== destination.scope.apiOrigin)
		throw Error('Selected restore requires the exact home-plane destination origin');
	const ownerId = destination.scope.ownerId;
	if ((await getCurrentUser(request))?.id !== ownerId) throw new StorageMutationError(401, 'storage_conflict', 'The authenticated account or session changed');
	const completed = await readCompletedCreation(request, review);
	if (completed) return completed;
	const binding = hash(review), eventId = 'restore-graph-' + hash([ownerId, review.operationId]);
	const graph = await preflightGraph(review, records, signal);
	try {
	const now = new Date();
	const things = await getHomeThingsCollection();
	let effects: (() => Promise<void>)[] = [];
	const result = await withHomeMongoTransaction(async session => {
		// Driver retries must discard callbacks from aborted attempts.
		effects = [];
		signal?.throwIfAborted();
		const viewer = await fenceAccountSession(request, ownerId, session);
		const root = await things.findOne({ shareId: destination.rootId, ownerId, ...folderThingMatch() }, { session });
		if (!root) conflict('The restore destination is no longer an owned folder');
		const previous = (await readTimelineEntries(things, ownerId, [eventId], session))[0];
		if (previous) {
			const event = previous.event, value = event.after?.value as any;
			if (event.id !== eventId || event.actorId !== ownerId || event.ownerId !== ownerId || event.source !== 'api' ||
				event.thingId !== destination.rootId || event.operationId !== review.operationId || event.mode !== 'effect' ||
				event.operation !== 'effect' || event.after?.adapter !== ADAPTER || event.after.version !== 1 ||
				value?.binding !== binding || value?.count !== review.count) conflict('The restore operation was reused with different reviewed content');
			// Current authorization/ownership still apply; a later root revision
			// does not invalidate historical acceptance or authorize overwriting it.
			return { replayed: true, eventId, count: review.count };
		}
		if (root.timelineHeadId !== destination.rootRevision) conflict('The reviewed destination revision changed');
		const locked = await things.updateOne({ shareId: destination.rootId, ownerId, timelineHeadId: destination.rootRevision,
			...folderThingMatch() }, { $set: { folderMutationToken: randomUUID() } }, { session });
		if (locked.modifiedCount !== 1) conflict('The reviewed destination changed before publication');
		const digest = createHash('sha256');
		let count = 0;
		for await (const record of records()) {
			signal?.throwIfAborted();
			const pin = graph.db.prepare('SELECT recordHash FROM creations WHERE sourceId=? AND ordinal=? AND targetId=?').get(record.sourceId, count, record.input.shareId as string) as any;
			if (!pin || pin.recordHash !== hash(record)) conflict('A reviewed creation changed after preflight');
			if (!record || typeof record.sourceId !== 'string' || !record.sourceId ||
				record.input.shareId !== ordinaryRestoreTargetId(review, record.sourceId)) conflict('The reviewed fresh allocation changed');
			const kinds = Array.isArray(record.input.thingtime) ? record.input.thingtime : [];
			if (!Array.isArray(kinds) || !kinds.length || kinds.some(kind => !['folder', 'data', 'schema', 'component', 'action', 'webpage', 'builder-thing'].includes(kind)) ||
				record.input.targetId != null || (record.input as any).tokenAcl != null ||
				(record.input.acl != null && backupJson(record.input.acl) !== '["tt:user"]')) conflict('This graph requires an unsupported restore writer');
			updateRecordDigest(digest, record); count++;
			const created = await createThing(ownerId, { ...record.input, acl: ['tt:user'] }, viewer, null, {
				transaction: { session, afterCommit: effect => effects.push(effect) },
				timelineCapture: { id: 'restore-created-' + hash([review.operationId, record.sourceId]), operationId: review.operationId,
					actorId: ownerId, source: 'api', now, label: 'Restored selected content' }
			});
			if (isFail(created)) throw new StorageMutationError(created.status, 'storage_conflict', created.error);
		}
		if (digest.digest('hex') !== review.graphHash || count !== review.count) conflict('The reviewed graph changed during publication');
		await fenceAccountSession(request, ownerId, session);
		signal?.throwIfAborted();
		await appendTimelineEvent(things, parseTimelineEvent({ formatVersion: 1, id: eventId, ownerId, thingId: destination.rootId,
			branchId: 'main', parentIds: [], operationId: review.operationId, actorId: ownerId, source: 'api', clientId: null,
			occurredAt: now.toISOString(), mode: 'effect', operation: 'effect', label: 'Restored selected content graph',
			before: null, after: { adapter: ADAPTER, version: 1, value: { binding, count } }, dependencies: [] }), session, { plane: 'home' });
		return { replayed: false, eventId, count };
	});
	for (const effect of effects) await effect();
	return result;
	} finally { await graph.close(); }
}

type CreationCheckpoint = {
	version: 1; operationId: string; binding: string;
	phase: 'planning' | 'restoring' | 'complete';
	planned: number; applied: number; count: number;
	chain: string;
	contentEpoch?: number;
};
const initialChain = '0'.repeat(64);
const advanceChain = (chain: string, recordHash: string) => hash([chain, recordHash]);

/** Progressive, private canonical creation. Immutable Timeline command intents
 * are accepted for the ENTIRE reviewed graph before ordinary content changes.
 * Root scalar checkpoints + intent/effect receipts are durable Mongo state;
 * disposable indexing is never resume authority. Each effect and its counter
 * increment commit with the corresponding canonical mutation.
 */
export async function executeResumableOrdinaryRestore(
	request: Request,
	input: OrdinaryRestoreReview,
	records: () => AsyncIterable<OrdinaryRestoreCreation>,
	options: { signal?: AbortSignal; afterCheckpoint?: (phase: 'intent' | 'effect' | 'verified' | 'complete', ordinal: number) => Promise<void> } = {}
) {
	const review = validateReview(input), destination = review.destination, ownerId = destination.scope.ownerId;
	if (isCustomMongoEndpointActive() || new URL(request.url).origin !== destination.scope.apiOrigin)
		throw Error('Selected restore requires the exact home-plane destination origin');
	if ((await getCurrentUser(request))?.id !== ownerId) throw new StorageMutationError(401, 'storage_conflict', 'The authenticated account or session changed');
	const accepted = await readCompletedCreation(request, review);
	if (accepted) return accepted;
	const graph = await preflightGraph(review, records, options.signal);
	const binding = hash(review), completionEventId = 'restore-graph-' + hash([ownerId, review.operationId]);
	const things = await getHomeThingsCollection();
	const hold: ContentExecutionHold = { version: 1, operationId: review.operationId, completionEventId, rootId: destination.rootId, binding };
	const effectId = (kind: string, sourceId: string) => 'restore-' + kind + '-' + hash([ownerId, review.operationId, sourceId]);
	const valueFor = (record: OrdinaryRestoreCreation, ordinal: number) => {
		const pinned = graph.db.prepare('SELECT recordHash FROM creations WHERE sourceId=? AND ordinal=? AND targetId=?').get(record.sourceId, ordinal, record.input.shareId as string) as any;
		if (!pinned || pinned.recordHash !== hash(record)) conflict('A reviewed creation changed after preflight');
		return { binding, ordinal, recordHash: pinned.recordHash as string, sourceId: record.sourceId, targetId: record.input.shareId as string, family: 'ordinary' };
	};
	const readReceipt = async (id: string, adapter: string, value: unknown, session: any) => {
		const prior = (await readTimelineEntries(things, ownerId, [id], session))[0]?.event;
		if (!prior) return false;
		if (prior.id !== id || prior.ownerId !== ownerId || prior.actorId !== ownerId || prior.thingId !== destination.rootId ||
			prior.operationId !== review.operationId || prior.source !== 'api' || prior.mode !== 'effect' || prior.operation !== 'effect' ||
			prior.after?.adapter !== adapter || prior.after.version !== 1 || hash(prior.after.value) !== hash(value)) conflict('A creation receipt conflicts with the reviewed operation');
		return true;
	};
	const append = async (id: string, adapter: string, value: any, session: any) => {
		await appendTimelineEvent(things, parseTimelineEvent({ formatVersion: 1, id, ownerId, thingId: destination.rootId,
			branchId: 'main', parentIds: [], operationId: review.operationId, actorId: ownerId, source: 'api', clientId: null,
			occurredAt: new Date().toISOString(), mode: 'effect', operation: 'effect', label: 'Restoring selected content',
			before: null, after: { adapter, version: 1, value }, dependencies: [] }), session, { plane: 'home' });
	};
	const rootAndCheckpoint = async (session: any, allowOldRevisionForReceipt = false) => {
		const root = await things.findOne({ shareId: destination.rootId, ownerId, ...folderThingMatch() }, { session });
		if (!root || root.appId != null || root.sandbox != null || root.sandboxSpace != null) conflict('The restore destination is no longer an owned folder');
		if (!allowOldRevisionForReceipt && root.timelineHeadId !== destination.rootRevision) conflict('The reviewed destination revision changed');
		const saved = root.creationCheckpoint as CreationCheckpoint | undefined;
		if (!allowOldRevisionForReceipt && saved && saved.binding !== binding && saved.phase !== 'complete') conflict('The destination has another incomplete creation operation');
		const checkpoint: CreationCheckpoint = saved?.binding === binding ? saved : {
			version: 1, operationId: review.operationId, binding, phase: 'planning', planned: 0, applied: 0, count: review.count, chain: initialChain
		};
		if (checkpoint.version !== 1 || checkpoint.operationId !== review.operationId || checkpoint.count !== review.count ||
			!['planning', 'restoring', 'complete'].includes(checkpoint.phase) ||
			![checkpoint.planned, checkpoint.applied].every(value => Number.isSafeInteger(value) && value >= 0 && value <= review.count) ||
			checkpoint.applied > checkpoint.planned || !/^[a-f0-9]{64}$/.test(checkpoint.chain)) conflict('Invalid durable creation checkpoint');
		return { root, checkpoint };
	};
	const saveCheckpoint = async (checkpoint: CreationCheckpoint, session: any) => {
		// Ordinary writers increment contentEpoch in this same transaction.
		// Update scalar progress fields without replacing that independent fence.
		const set: Record<string, unknown> = { folderMutationToken: randomUUID() };
		for (const key of ['version', 'operationId', 'binding', 'phase', 'planned', 'applied', 'count', 'chain'] as const)
			set[`creationCheckpoint.${key}`] = checkpoint[key];
		const saved = await things.updateOne({ shareId: destination.rootId, ownerId, timelineHeadId: destination.rootRevision,
			...folderThingMatch() }, { $set: set }, { session });
		if (saved.modifiedCount !== 1) conflict('The reviewed destination changed before checkpoint publication');
	};
	try {
		// Completion is immutable historical acceptance; current owner/session
		// still apply, while later user edits must not be overwritten on retry.
		const completed = await withHomeMongoTransaction(async session => {
			await fenceAccountSession(request, ownerId, session);
			await rootAndCheckpoint(session, true);
			return readReceipt(completionEventId, ADAPTER, { binding, count: review.count }, session);
		});
		if (completed) return { replayed: true, eventId: completionEventId, count: review.count };
		await withHomeMongoTransaction(async session => {
			await fenceAccountSession(request, ownerId, session);
			const { root, checkpoint } = await rootAndCheckpoint(session);
			const admissionId = ordinaryRestoreAdmissionId(ownerId, review.operationId);
			if (await readReceipt(admissionId, 'reviewed-creation-admission', { review }, session)) {
				if (!root.creationCheckpoint || root.creationCheckpoint.binding !== binding) conflict('The durable creation admission lost its checkpoint');
				return;
			}
			if (checkpoint.planned || checkpoint.applied) conflict('The original creation admission is unavailable');
			// Persist the small immutable review itself, not just its digest. A
			// fresh worker can recover it through the ordinary owner Timeline API.
			await append(admissionId, 'reviewed-creation-admission', { review }, session);
			await saveCheckpoint(checkpoint, session);
			options.signal?.throwIfAborted();
		});
		let ordinal = 0, chain = initialChain;
		for await (const record of records()) {
			options.signal?.throwIfAborted();
			const value = valueFor(record, ordinal), id = effectId('intent', record.sourceId);
			chain = advanceChain(chain, value.recordHash);
			await withHomeMongoTransaction(async session => {
				await fenceAccountSession(request, ownerId, session);
				const { checkpoint } = await rootAndCheckpoint(session);
				if (await readReceipt(id, 'reviewed-creation-intent', value, session)) {
					if (checkpoint.planned <= ordinal) conflict('A durable intent is missing its atomic checkpoint');
					return;
				}
				if (checkpoint.phase !== 'planning' || checkpoint.planned !== ordinal) conflict('Creation intent order changed');
				await append(id, 'reviewed-creation-intent', value, session);
				await saveCheckpoint({ ...checkpoint, planned: ordinal + 1, chain }, session);
				options.signal?.throwIfAborted();
			});
			await options.afterCheckpoint?.('intent', ordinal);
			ordinal++;
		}
		if (ordinal !== review.count) conflict('The selected creation inventory changed');
		await withHomeMongoTransaction(async session => {
			await fenceAccountSession(request, ownerId, session);
			const { checkpoint } = await rootAndCheckpoint(session);
			if (checkpoint.planned !== review.count || checkpoint.chain !== chain) conflict('The complete reviewed intent chain is unavailable');
			if (checkpoint.phase === 'planning') await saveCheckpoint({ ...checkpoint, phase: 'restoring' }, session);
		});
		ordinal = 0;
		for await (const record of records()) {
			options.signal?.throwIfAborted();
			const value = valueFor(record, ordinal), id = effectId('applied', record.sourceId);
			let effects: (() => Promise<void>)[] = [];
			await withHomeMongoTransaction(async session => {
				effects = [];
				const viewer = await fenceAccountSession(request, ownerId, session);
				const { checkpoint } = await rootAndCheckpoint(session);
				if (!await readReceipt(effectId('intent', record.sourceId), 'reviewed-creation-intent', value, session)) conflict('The reviewed command intent is unavailable');
				if (await readReceipt(id, 'reviewed-creation-effect', value, session)) {
					if (checkpoint.applied <= ordinal) conflict('A durable effect is missing its atomic checkpoint');
					return;
				}
				if (checkpoint.phase !== 'restoring' || checkpoint.applied !== ordinal) conflict('Creation effect order changed');
				const result = await createThing(ownerId, { ...record.input, acl: ['tt:user'] }, viewer, null, {
					transaction: { session, afterCommit: effect => effects.push(effect) },
					executionHold: hold,
					timelineCapture: { id: 'restore-created-' + hash([review.operationId, record.sourceId]), operationId: review.operationId,
						actorId: ownerId, source: 'api', now: new Date(), label: 'Restored selected content' }
				});
				if (isFail(result)) throw new StorageMutationError(result.status, 'storage_conflict', result.error);
				await append(id, 'reviewed-creation-effect', value, session);
				await saveCheckpoint({ ...checkpoint, applied: ordinal + 1 }, session);
				options.signal?.throwIfAborted();
			});
			for (const effect of effects) await effect();
			await options.afterCheckpoint?.('effect', ordinal);
			ordinal++;
		}
		options.signal?.throwIfAborted();
		const beforeVerification = await withHomeMongoTransaction(async session => {
			await fenceAccountSession(request, ownerId, session);
			return (await rootAndCheckpoint(session)).checkpoint.contentEpoch ?? 0;
		});
		if (!Number.isSafeInteger(beforeVerification) || beforeVerification < 0) conflict('Invalid creation content fence');
		// Read current content after every effect, preserving owner edits while
		// refusing missing/moved dependencies or newly broken executable closure.
		// Only one current Thing is materialized at a time; the index is scratch.
		const currentRecords = async function* (): AsyncGenerator<OrdinaryRestoreCreation> {
			for (const row of graph.db.prepare('SELECT sourceId,targetId FROM creations ORDER BY ordinal').iterate()) {
				options.signal?.throwIfAborted();
				const doc = await things.findOne({ shareId: row.targetId, ownerId });
				if (!doc || doc.appId != null || doc.sandbox != null || doc.sandboxSpace != null) conflict('Restored content was removed or changed ownership before completion');
				yield { sourceId: row.sourceId as string, input: { shareId: doc.shareId, thingtime: doc.thingtime,
					crystal: doc.crystal, extended: doc.extended ?? null, tags: doc.tags ?? [], acl: doc.acl, folderId: doc.folderId ?? null, geo: doc.geo ?? null } };
			}
		};
		const currentReview = { ...review, ...await ordinaryRestoreGraphHash(currentRecords()) };
		const currentGraph = await preflightGraph(currentReview, currentRecords, options.signal);
		await currentGraph.close();
		await options.afterCheckpoint?.('verified', ordinal);
		await withHomeMongoTransaction(async session => {
			await fenceAccountSession(request, ownerId, session);
			const { checkpoint } = await rootAndCheckpoint(session);
			if (checkpoint.phase !== 'restoring' || checkpoint.planned !== review.count || checkpoint.applied !== review.count || checkpoint.chain !== chain)
				conflict('The durable creation effect set is incomplete');
			if ((checkpoint.contentEpoch ?? 0) !== beforeVerification) conflict('Restored content changed during final verification');
			await append(completionEventId, ADAPTER, { binding, count: review.count }, session);
			await saveCheckpoint({ ...checkpoint, phase: 'complete' }, session);
			options.signal?.throwIfAborted();
		});
		await options.afterCheckpoint?.('complete', ordinal);
		return { replayed: false, eventId: completionEventId, count: review.count };
	} finally { await graph.close(); }
}
