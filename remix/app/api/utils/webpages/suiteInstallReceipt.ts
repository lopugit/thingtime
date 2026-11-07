import { createHash } from 'node:crypto';
import { parseTimelineEvent, type TimelineEvent } from '../../../timeline/contract';
import type { InstallSuiteResult } from '../../../schemas/suiteInstallation';
import type { PublicThing } from '../things/things';

export type SuiteReceiptScope = { ownerId: string; origin: string; dataPlane: string; requestId: string; key: string; onlyMissing: boolean; bundleVersion: string };
export const suiteReceiptEventId = (requestId: string) => `suite-install-${requestId}`;
export const suiteReceiptDigest = (scope: SuiteReceiptScope) => createHash('sha256').update(JSON.stringify(scope)).digest('hex');
const reject = (): never => { throw new Error('Suite installation receipt does not match this operation.'); };
export function suiteReceiptEvent(scope: SuiteReceiptScope, id: string, thingId: string, adapter: string, value: Record<string, unknown>, at: string): TimelineEvent {
	return parseTimelineEvent({ formatVersion: 1, id, ownerId: scope.ownerId, thingId, branchId: 'main', parentIds: [], operationId: scope.requestId,
		actorId: scope.ownerId, source: 'api', clientId: null, occurredAt: at, mode: 'effect', operation: 'effect', label: 'Installed suite',
		before: null, after: { adapter, version: 1, value: { requestDigest: suiteReceiptDigest(scope), ...value } }, dependencies: [] });
}
export function suiteReceiptValue(raw: unknown, scope: SuiteReceiptScope, id: string, adapter: string): Record<string, unknown> {
	const event = parseTimelineEvent(raw), value = event.after?.value;
	if (!value || typeof value !== 'object' || Array.isArray(value)) return reject();
	if (event.id !== id || event.ownerId !== scope.ownerId || event.actorId !== scope.ownerId || event.operationId !== scope.requestId || event.source !== 'api' ||
		event.clientId !== null || event.mode !== 'effect' || event.operation !== 'effect' || event.branchId !== 'main' || event.parentIds.length || event.dependencies.length ||
		event.before !== null || event.after?.adapter !== adapter || event.after.version !== 1 || value.requestDigest !== suiteReceiptDigest(scope)) return reject();
	return value;
}
export function suiteInstallIds(result: InstallSuiteResult): string[] {
	return [...new Set([...Object.values(result.schemaIds), ...Object.values(result.componentIds), ...Object.values(result.actionIds), ...Object.values(result.pageIds), ...result.dataIds])];
}
export function validateSuiteReceiptSnapshots(result: InstallSuiteResult, scope: SuiteReceiptScope, snapshots: PublicThing[]): void {
	const ids = suiteInstallIds(result), receipt = result.receipt;
	if (result.ok !== true || result.suite !== scope.key || !ids.includes(result.entryPageId) || !receipt || receipt.requestId !== scope.requestId ||
		receipt.ownerId !== scope.ownerId || receipt.origin !== scope.origin || receipt.dataPlane !== scope.dataPlane ||
		receipt.bundleVersion !== scope.bundleVersion || typeof receipt.bundleVersion !== 'string' || !/^suite-bundle-v1:[a-f0-9]{64}$/.test(receipt.bundleVersion) || snapshots.length !== ids.length ||
		new Set(snapshots.map(snapshot => snapshot.id)).size !== ids.length || snapshots.some(snapshot => !ids.includes(snapshot.id) || snapshot.author?.id !== scope.ownerId ||
			!Array.isArray(snapshot.thingtime) || !Array.isArray(snapshot.acl) || typeof snapshot.visibility !== 'string' ||
			!Number.isFinite(Date.parse(snapshot.createdAt)) || !Number.isFinite(Date.parse(snapshot.updatedAt)))) return reject();
}

/** Deliberate owner-content projection. Hidden-link bearer keys, token grants,
 * attachment handles and profile metadata never enter durable install receipts. */
export function suiteInstallSnapshot(thing: PublicThing): PublicThing {
	return { id: thing.id, thingtime: thing.thingtime, crystal: thing.crystal, extended: thing.extended, tags: thing.tags,
		acl: thing.acl, visibility: thing.visibility, author: thing.author ? { id: thing.author.id } as PublicThing['author'] : null,
		folderId: thing.folderId, targetId: thing.targetId, createdAt: thing.createdAt, updatedAt: thing.updatedAt,
		...(thing.timelineHeadId ? { timelineHeadId: thing.timelineHeadId } : {}), ...(thing.geo === undefined ? {} : { geo: thing.geo }) };
}
export const suiteSnapshotDigest = (text: string) => createHash('sha256').update(text).digest('hex');
// A transport chunk, never a product size limit. Even fully escaped UTF-16
// chunks fit the existing 4 MiB Timeline event protocol. More chunks preserve
// larger valid customized parts without imposing a total install-size ceiling.
export const SUITE_SNAPSHOT_CHARS = 128 * 1024;
