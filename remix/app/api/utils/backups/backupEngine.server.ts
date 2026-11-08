import { createHash } from 'node:crypto';
import { BACKUP_FORMAT, BACKUP_CHUNK_BYTES, BACKUP_METADATA_BYTES, backupJson, parseBackupSeal } from '../../../backups/manifest';
import { backupDestinationRegistry } from './backupDestinations';
import { advanceAccountInventory, type AccountInventoryCursor } from './accountInventorySteps';
import { captureBackupRangePage, openBackupWorkerView, type BackupAccess, type BackupObjectStore, type BackupWorkerItemRef } from './portableBackup';
import { createBackupEngineTransport, awaitBackupAbort, type BackupEngineManifest } from './backupTransport.server';
import { openAccountBackupRangeSource } from './cloudFolderBackup';
import { advanceSnapshotCatalogPaths } from './backupCatalogPaths';
import { openAccountInventoryReferences } from './accountInventoryReferences';
import { appendSnapshotCatalog, snapshotCatalogEntry } from './backupCatalog';
import { runAccountRestoreStep } from './accountRestoreSteps';
import type { CompletedBackupJob, BackupEngineContext, BackupEngineOutcome } from './backupJobs';
import type { BackupJobCursor } from './backupJobCore';
import { backupHashOperationId, backupJobDigest } from './backupJobCore';
import { createResumableHashWorker, type HashStreamBinding, type ImmutableHashSource, type HashCheckpointRef } from './resumableHash';

const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const encoded = (value: string) => new TextEncoder().encode(value);
const continuing: BackupEngineOutcome = { kind: 'continue' };
type OpenDestination = (id: string, access: BackupAccess, binding: string) => Promise<{ store: BackupObjectStore; binding: string }>;
/** Trusted server dependency injection is for isolated API/replica fixtures.
 * No request, Thing, environment switch or Workflow argument selects handlers. */
export function createBackupEngine(
	options: {
		openDestination?: OpenDestination;
		manifestReader?: (origin: string) => Promise<BackupEngineManifest>;
	} = {}
) {
	const step = async (context: BackupEngineContext, unitSignal: AbortSignal): Promise<BackupEngineOutcome> => {
		const transport = await createBackupEngineTransport(context, options.manifestReader);
		const access: BackupAccess = { scope: transport.scope, authorize: context.guard, signal: unitSignal };
		if (context.operation.kind !== 'snapshot') {
			return runAccountRestoreStep(context, { access, runtime: transport.runtime,
				openSnapshot: async (source: CompletedBackupJob) => {
					if (source.operation.kind !== 'snapshot' || source.cursor.phase !== 'complete' || !source.cursor.planHash || !source.cursor.sealHash)
						throw Error('A completed source snapshot is required');
					const opened = await (options.openDestination ?? backupDestinationRegistry.open)(source.operation.destinationId, access, context.destinationBinding);
					if (opened.binding !== context.destinationBinding) throw Error('The admitted backup destination changed');
					return { store: opened.store, snapshotId: source.operation.snapshotId, planHash: source.cursor.planHash, sealHash: source.cursor.sealHash };
				}
			});
		}
		const { snapshotId, destinationId } = context.operation;
		const { store, binding } = await (options.openDestination ?? backupDestinationRegistry.open)(destinationId, access, context.destinationBinding);
		if (binding !== context.destinationBinding) throw Error('The admitted backup destination changed');
		const current = () => context.cursor;
		const checkpoint = (next: BackupJobCursor, clearHashSlots?: ('part' | 'composite' | 'manifest')[]) =>
			context.checkpoint(next, { clearHashSlots });
		const c = current();
		try {
			if (c.phase === 'inventory') {
				const input: AccountInventoryCursor = {
					seconds: c.snapshotSeconds,
					increment: c.snapshotIncrement,
					lastThingId: c.inventoryLastId,
					nextOrdinal: c.itemsProcessed,
					pages: c.planPage ?? 0,
					previousHash: c.headHash,
					bytes: c.inventoryBytes,
					excluded: c.inventoryExcluded,
					referenceStateHash: c.inventoryReferenceStateHash
				};
				const result = await advanceAccountInventory(store, snapshotId, access, input),
					next = result.cursor;
				await checkpoint({
					...c,
					snapshotSeconds: next.seconds,
					snapshotIncrement: next.increment,
					inventoryLastId: next.lastThingId,
					itemsProcessed: next.nextOrdinal,
					planPage: next.pages,
					headHash: next.previousHash,
					inventoryBytes: next.bytes,
					inventoryExcluded: next.excluded,
					inventoryReferenceStateHash: next.referenceStateHash,
					...(result.complete
						? {
								phase: 'capture' as const,
								stage: 'start' as const,
								planHash: backupJobDigest(result.plan),
								planPage: result.plan!.pages ? result.plan!.pages - 1 : null,
								headHash: result.plan!.headHash,
								itemIndex: 0,
								itemsProcessed: 0
						  }
						: {})
				});
				return continuing;
			}
			if (!c.planHash) throw Error('Backup inventory has not been durably admitted');
			const view = await openBackupWorkerView(store, snapshotId, access, { planHash: c.planHash, sealHash: null });
			if (c.phase === 'complete') {
				if (!c.sealHash) throw Error('Completed snapshot has no admitted seal');
				await (await openBackupWorkerView(store, snapshotId, access, { planHash: c.planHash, sealHash: c.sealHash })).assertCurrent();
				return { kind: 'complete' };
			}
			if (c.phase === 'capture') {
				if (c.planPage === null) {
					await checkpoint({
						...c,
						phase: 'verify',
						stage: 'count',
						planPage: 0,
						headHash: null,
						itemIndex: 0,
						rangePage: 0,
						rangeOffset: '0',
						itemsProcessed: 0,
						inventoryBytes: '0',
						bytesProcessed: '0',
						chunksProcessed: '0',
						rangeChainHash: null
					});
					return continuing;
				}
				if (!c.headHash) throw Error('Capture page has no immutable chain pin');
				const page = await view.readPlanPage(c.planPage, c.headHash),
					item = page.items[c.itemIndex];
				if (!item) throw Error('Capture item cursor changed');
				if (!item.content || item.content.size === 0) {
					if (c.rangePage !== 0 || c.rangeOffset !== '0') throw Error('Metadata capture cursor changed');
					let index = c.itemIndex;
					while (index < page.items.length && (!page.items[index].content || page.items[index].content!.size === 0)) index++;
					const last = index === page.items.length;
					await checkpoint({ ...c, itemsProcessed: c.itemsProcessed + index - c.itemIndex, itemIndex: last ? 0 : index,
						...(last ? { planPage: c.planPage === 0 ? null : c.planPage - 1, headHash: page.previous } : {}) });
					return continuing;
				}
				const proof = { planPage: c.planPage, pageHash: c.headHash, itemIndex: c.itemIndex };
				let source: Awaited<ReturnType<typeof openAccountBackupRangeSource>> | undefined;
				const captured = await captureBackupRangePage(
					store,
					snapshotId,
					access,
					{ planHash: c.planHash, sealHash: null },
					proof,
					{ ordinal: c.rangePage, offset: Number(c.rangeOffset) },
					{
						read: async (pinned, offset, length, signal) => {
							source ??= await openAccountBackupRangeSource(pinned, transport.runtime);
							return source.read(pinned, offset, length, signal);
						}
					}
				);
				const last = c.itemIndex === page.items.length - 1;
				await checkpoint({
					...c,
					bytesProcessed: (BigInt(c.bytesProcessed) + BigInt(captured.copiedBytes) + BigInt(captured.reusedBytes)).toString(),
					...(captured.done
						? {
								itemsProcessed: c.itemsProcessed + 1,
								itemIndex: last ? 0 : c.itemIndex + 1,
								rangePage: 0,
								rangeOffset: '0',
								...(last ? { planPage: c.planPage === 0 ? null : c.planPage - 1, headHash: page.previous } : {})
						  }
						: { rangePage: captured.nextOrdinal, rangeOffset: String(captured.nextOffset) })
				});
				return continuing;
			}
			if (c.phase !== 'verify') throw Error('Invalid snapshot phase');
			// A forward walk reaches the pinned terminal head, checking ordinal and ID
			// continuity. Each unit retains just one page and one current range receipt.
			const page = c.planPage !== null && c.planPage < view.plan.pages ? await view.readNextPlanPage(c.planPage, c.headHash) : null;
			const item = page?.page.items[c.itemIndex];
			const proof: BackupWorkerItemRef | null =
				page && c.planPage !== null ? { planPage: c.planPage, pageHash: page.pageHash, itemIndex: c.itemIndex } : null;
			const nextItem = (base: BackupJobCursor): BackupJobCursor => {
				if (!page || !item) throw Error('Verification item cursor changed');
				const last = base.itemIndex === page.page.items.length - 1;
				return {
					...base,
					itemIndex: last ? 0 : base.itemIndex + 1,
					planPage: last ? base.planPage! + 1 : base.planPage,
					headHash: last ? page.pageHash : base.headHash,
					rangePage: 0,
					rangeOffset: '0',
					rangeIndex: 0,
					partIndex: 0,
					itemsProcessed: base.itemsProcessed + 1
				};
			};
			const reset = (stage: BackupJobCursor['stage']): BackupJobCursor => ({
				...c,
				stage,
				planPage: 0,
				headHash: null,
				itemIndex: 0,
				rangePage: 0,
				rangeOffset: '0',
				rangeIndex: 0,
				partIndex: 0,
				itemsProcessed: 0,
				bytesProcessed: '0'
			});
			if (c.stage === 'count') {
				if (!item) {
					if (c.itemsProcessed !== view.plan.items || c.inventoryBytes !== view.plan.bytes || (view.plan.pages && c.headHash !== view.plan.headHash))
						throw Error('Backup inventory totals changed');
					const catalogStateHash = await appendSnapshotCatalog(store, snapshotId, c.planHash, c.catalogStateHash, [], access, true);
					const prefix = encoded(BACKUP_FORMAT + '\0' + backupJson(view.plan) + '\0');
					await checkpoint({
						...reset('catalog'),
						fileIndex:0,
						catalogStateHash,
						manifestByteLength: (BigInt(c.manifestByteLength) + BigInt(prefix.length)).toString(),
						rangeChainExpected: c.rangeChainHash
					});
					return continuing;
				}
				if (!item.content || Number(c.rangeOffset) === item.content.size) {
					let next = c; const entries = [];
					// Pure metadata from one verified immutable plan page is a bounded
					// processing batch, not one network/Workflow invocation per field.
					while (next.planPage === c.planPage) {
						const candidate = page!.page.items[next.itemIndex];
						if (candidate.content && Number(next.rangeOffset) < candidate.content.size) break;
						const entry = snapshotCatalogEntry(candidate); if (entry) entries.push(entry);
						next = nextItem({ ...next, inventoryBytes: (BigInt(next.inventoryBytes) + BigInt(candidate.content?.size ?? 0)).toString() });
					}
					const catalogStateHash = entries.length ? await appendSnapshotCatalog(store, snapshotId, c.planHash, c.catalogStateHash, entries, access) : c.catalogStateHash;
					await checkpoint({ ...next, catalogStateHash }); return continuing;
				}
				const ranges = await view.readRangePage(proof!, c.rangePage, Number(c.rangeOffset));
				await checkpoint({
					...c,
					rangePage: c.rangePage + 1,
					rangeOffset: String(ranges.offset),
					manifestByteLength: (BigInt(c.manifestByteLength) + BigInt(encoded(backupJson(ranges.page) + '\0').length)).toString(),
					chunksProcessed: (BigInt(c.chunksProcessed) + BigInt(ranges.page.ranges.length)).toString(),
					rangeChainHash: backupJobDigest([c.rangeChainHash, ranges.pageHash])
				});
				return continuing;
			}
			const hashUnit = async (
				slot: 'part' | 'composite' | 'manifest',
				stream: string,
				bytes: string,
				expected: string | null,
				source: ImmutableHashSource,
				next: (ref: HashCheckpointRef) => BackupJobCursor,
				budget = BACKUP_CHUNK_BYTES
			) => {
				const binding: HashStreamBinding = {
					operationId: backupHashOperationId(context.jobId, slot, stream, 'stream'),
					snapshotId,
					streamId: stream,
					objectVersion: backupJobDigest([c.planHash, c.rangeChainExpected, stream]),
					bytes,
					expectedSha256: expected
				};
				const worker = createResumableHashWorker({ store, keys: context.hashKeys, access, coordinator: context.hashCoordinator(slot, next) });
				const ref = await worker.start(binding, source);
				if (ref.complete) return ref;
				return worker.advance(binding, ref, backupHashOperationId(context.jobId, slot, stream, `step-${ref.sequence + 1}`), source, budget);
			};
			const identity = async () => {
				await view.assertCurrent();
				if (proof && backupJson((await view.readPlanPage(proof.planPage, proof.pageHash)).items[proof.itemIndex]) !== backupJson(item))
					throw Error('Backup source descriptor changed');
			};
			if(c.stage==='catalog'){
                if(!c.catalogStateHash)throw Error('Snapshot catalogue is missing');
                const references=c.inventoryReferenceStateHash?await openAccountInventoryReferences(store,snapshotId,access.scope.ownerId,c.inventoryReferenceStateHash,access.authorize,()=>access.signal?.throwIfAborted()):null;
                const prepared=await advanceSnapshotCatalogPaths(store,snapshotId,c.planHash,c.catalogStateHash,c.fileIndex===0,access,id=>references?references.descriptor(id):Promise.resolve(null));
                await checkpoint({...c,...(prepared.done?reset('part'):{}),catalogStateHash:prepared.hash,fileIndex:prepared.done?0:1});return continuing;
            }
			if (c.stage === 'part' || c.stage === 'composite' || c.stage === 'clear') {
				if (!item) {
					await checkpoint({ ...reset('manifest-prefix'), rangeChainHash: null });
					return continuing;
				}
				if (!item.content || item.content.size === 0) {
					if (c.stage !== 'part') throw Error('Metadata verification stage changed');
					let next = c;
					while (next.planPage === c.planPage) {
						const candidate = page!.page.items[next.itemIndex]; if (candidate.content && candidate.content.size > 0) break;
						next = nextItem(next);
					}
					await checkpoint(next); return continuing;
				}
				const content = item.content,
					fp = content.fingerprint!;
				if (c.stage === 'clear') {
					const done = c.partIndex + 1 >= fp.partCount;
					await checkpoint(
						done ? nextItem({ ...c, stage: 'part' }) : { ...c, stage: 'part', partIndex: c.partIndex + 1 },
						done ? ['part', 'composite'] : ['part']
					);
					return continuing;
				}
				if (content.size === 0) {
					if (fp !== null) throw Error('Empty file fingerprint changed');
					await checkpoint(nextItem(c));
					return continuing;
				}
				const partStart = c.partIndex * fp.partSizeBytes,
					partSize = Math.min(fp.partSizeBytes, content.size - partStart);
				if (partSize <= 0) throw Error('Backup part cursor changed');
				const ranges = Number(c.rangeOffset) < content.size ? await view.readRangePage(proof!, c.rangePage, Number(c.rangeOffset)) : null;
				const range = ranges?.page.ranges[c.rangeIndex];
				const partSource: ImmutableHashSource = {
					assertIdentity: identity,
					read: async (offset, length) => {
						if (!range || !ranges) throw Error('Backup part range missing');
						const absolute = partStart + Number(offset),
							chunk = await view.readChunk(proof!, c.rangePage, Number(c.rangeOffset), ranges.pageHash, c.rangeIndex);
						const local = absolute - range.offset;
						if (local < 0 || local + length > chunk.bytes.length) throw Error('Backup part crossed its admitted range');
						return chunk.bytes.slice(local, local + length);
					}
				};
				const advancePart = (ref: HashCheckpointRef): BackupJobCursor => {
					if (ref.sequence === 0) return c;
					if (!range || !ranges) throw Error('Backup part receipt cursor changed');
					const absolute = partStart + Number(ref.offset),
						consumed = absolute === range.offset + range.length;
					const last = consumed && c.rangeIndex === ranges!.page.ranges.length - 1;
					return {
						...c,
						stage: ref.complete ? 'composite' : 'part',
						bytesProcessed: (BigInt(c.bytesProcessed) + BigInt(absolute - Math.max(partStart, range!.offset))).toString(),
						...(consumed
							? {
									rangeIndex: last ? 0 : c.rangeIndex + 1,
									rangePage: last ? c.rangePage + 1 : c.rangePage,
									rangeOffset: last ? String(ranges!.offset) : c.rangeOffset
							  }
							: {})
					};
				};
				if (c.stage === 'part') {
					if (!range) throw Error('Backup part range cursor changed');
					const absolute = range.offset; // Ref offset supplies the exact in-chunk position.
					const partBinding: HashStreamBinding = {
						operationId: backupHashOperationId(context.jobId, 'part', `item-${item.ordinal}-part-${c.partIndex}`, 'stream'),
						snapshotId,
						streamId: `item-${item.ordinal}-part-${c.partIndex}`,
						objectVersion: backupJobDigest([c.planHash, c.rangeChainExpected, `item-${item.ordinal}-part-${c.partIndex}`]),
						bytes: String(partSize),
						expectedSha256: null
					};
					const worker = createResumableHashWorker({
						store,
						keys: context.hashKeys,
						access,
						coordinator: context.hashCoordinator('part', (ref) => advancePart(ref))
					});
					const prior = await worker.start(partBinding, partSource);
					if (prior.complete) {
						await checkpoint({ ...c, stage: 'composite' });
						return continuing;
					}
					const position = partStart + Number(prior.offset),
						budget = Math.min(BACKUP_CHUNK_BYTES, absolute + range.length - position);
					if (budget < 1) throw Error('Backup part offset changed');
					await worker.advance(
						partBinding,
						prior,
						backupHashOperationId(context.jobId, 'part', partBinding.streamId, `step-${prior.sequence + 1}`),
						partSource,
						budget
					);
					return continuing;
				}
				// Completed part digest is recovered from its protected reference. No
				// accumulated digest array is stored in the job or retained in memory.
				const partRef = await hashUnit('part', `item-${item.ordinal}-part-${c.partIndex}`, String(partSize), null, partSource, () => c);
				if (!partRef.complete || !partRef.finalDigest) throw Error('Unverified backup part');
				const raw = Buffer.from(partRef.finalDigest, 'hex');
				await hashUnit(
					'composite',
					`item-${item.ordinal}`,
					String(fp.partCount * 32),
					fp.sha256,
					{
						assertIdentity: identity,
						read: async (offset, length) => {
							if (Number(offset) !== c.partIndex * 32 || length !== 32) throw Error('Backup composite order changed');
							return raw;
						}
					},
					(ref) => (ref.sequence === 0 ? c : { ...c, stage: 'clear' }),
					32
				);
				return continuing;
			}
			const manifestSource = (segment: Uint8Array, start: bigint): ImmutableHashSource => ({
				assertIdentity: identity,
				read: async (offset, length) => {
					const local = Number(offset - start);
					if (local < 0 || local + length > segment.length) throw Error('Manifest segment cursor changed');
					return segment.slice(local, local + length);
				}
			});
			if (c.stage === 'manifest-prefix') {
				const segment = encoded(BACKUP_FORMAT + '\0' + backupJson(view.plan) + '\0');
				await hashUnit(
					'manifest',
					'canonical-manifest',
					c.manifestByteLength,
					null,
					manifestSource(segment, BigInt(0)),
					(ref) => (ref.sequence === 0 ? c : { ...c, stage: 'manifest', bytesProcessed: ref.offset }),
					segment.length
				);
				return continuing;
			}
			if (c.stage === 'manifest') {
				if (!item) {
					if (
						c.itemsProcessed !== view.plan.items ||
						c.rangeChainHash !== c.rangeChainExpected ||
						(view.plan.pages && c.headHash !== view.plan.headHash)
					)
						throw Error('Canonical manifest inventory changed');
					await checkpoint({ ...c, stage: 'seal' });
					return continuing;
				}
				if (!item.content || Number(c.rangeOffset) === item.content.size) {
					let next = c;
					while (next.planPage === c.planPage) {
						const candidate = page!.page.items[next.itemIndex]; if (candidate.content && Number(next.rangeOffset) < candidate.content.size) break;
						next = nextItem(next);
					}
					await checkpoint(next); return continuing;
				}
				const ranges = await view.readRangePage(proof!, c.rangePage, Number(c.rangeOffset));
				if (c.rangeIndex < ranges.page.ranges.length) {
					await view.readChunk(proof!, c.rangePage, Number(c.rangeOffset), ranges.pageHash, c.rangeIndex);
					await checkpoint({ ...c, rangeIndex: c.rangeIndex + 1 });
					return continuing;
				}
				const segment = encoded(backupJson(ranges.page) + '\0'),
					start = BigInt(c.bytesProcessed);
				await hashUnit(
					'manifest',
					'canonical-manifest',
					c.manifestByteLength,
					null,
					manifestSource(segment, start),
					(ref) =>
						ref.sequence === 0
							? c
							: {
									...c,
									bytesProcessed: ref.offset,
									rangePage: c.rangePage + 1,
									rangeOffset: String(ranges.offset),
									rangeIndex: 0,
									rangeChainHash: backupJobDigest([c.rangeChainHash, ranges.pageHash])
							  },
					segment.length
				);
				return continuing;
			}
			if (c.stage === 'seal') {
				if (c.itemsProcessed !== view.plan.items || c.rangeChainHash !== c.rangeChainExpected || c.bytesProcessed !== c.manifestByteLength)
					throw Error('Snapshot manifest is incomplete');
				const ref = await hashUnit(
					'manifest',
					'canonical-manifest',
					c.manifestByteLength,
					null,
					{
						assertIdentity: identity,
						read: async () => {
							throw Error('A completed manifest must not read new bytes');
						}
					},
					() => c
				);
				if (!ref.complete || !ref.finalDigest) throw Error('Snapshot manifest is unverified');
				const seal = parseBackupSeal({ ...view.plan, manifestHash: ref.finalDigest, chunks: c.chunksProcessed }),
					bytes = encoded(backupJson(seal));
				await view.assertCurrent();
				await store.put(`snapshots/${snapshotId}/complete.json`, bytes);
				await view.assertCurrent();
				const retained = await store.read(`snapshots/${snapshotId}/complete.json`, BACKUP_METADATA_BYTES);
				if (!retained || !Buffer.from(retained).equals(bytes)) throw Error('Snapshot seal durable readback changed');
				await view.assertCurrent();
				await checkpoint({ ...c, phase: 'complete', sealHash: digest(bytes) });
				return { kind: 'complete' };
			}
			throw Error('Invalid snapshot verification continuation');
		} catch (error: any) {
			if (error?.code === 'snapshot-expired') return { kind: 'pause', issue: 'snapshot-expired' };
			if (error?.code === 'snapshot-unavailable') return { kind: 'pause', issue: 'snapshot-unavailable' };
			throw error;
		}
	};
	return async (original: BackupEngineContext): Promise<BackupEngineOutcome> => {
		const deadline = new AbortController();
		const timer = setTimeout(() => deadline.abort(new DOMException('Backup work unit timed out', 'TimeoutError')), 60_000);
		const signal = AbortSignal.any([original.request.signal, deadline.signal]);
		const bounded = async <T>(work: () => Promise<T>) => {
			signal.throwIfAborted();
			return awaitBackupAbort(
				Promise.resolve().then(() => {
					signal.throwIfAborted();
					return work();
				}),
				signal
			);
		};
		const context: BackupEngineContext = {
			...original,
			get cursor() {
				return original.cursor;
			},
			guard: () => bounded(() => original.guard()),
			checkpoint: (next, options) => bounded(() => original.checkpoint(next, options)),
			hashCoordinator: (slot, next) => {
				const coordinator = original.hashCoordinator(slot, next);
				return {
					current: (binding) => bounded(() => coordinator.current(binding)),
					accept: (binding, previous, ref) => bounded(() => coordinator.accept(binding, previous, ref))
				};
			}
		};
		// Rejection ends the enclosing trusted Request binding promptly. A write
		// accepted before abort remains uncertain and retains its original receipt;
		// every newly attempted protected effect checks this same unit signal.
		try {
			return await awaitBackupAbort(step(context, signal), signal);
		} finally {
			clearTimeout(timer);
		}
	};
}
export const runBackupEngineStep = createBackupEngine();
