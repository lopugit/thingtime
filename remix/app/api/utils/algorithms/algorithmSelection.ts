import { createHash } from 'node:crypto';
import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { readUserAlgorithmSelection, ActiveFeedAlgorithmConflictError } from '../auth/users';
import { setActiveAlgorithm } from './algorithms';
import { readTimelineEntries, appendTimelineEvent } from '../timeline/repository';
import { parseTimelineEvent } from '../../../timeline/contract';
import {
	parseAlgorithmSelectionWrite,
	parseAlgorithmSelectionAcknowledgment,
	type AlgorithmSelectionAcknowledgment,
	type AlgorithmSelectionWrite
} from './algorithmSelectionContract';
import { AlgorithmSyncError } from './algorithmSync';
const eventId = (writeId: string) => 'algorithm-selection-' + writeId;
const digest = (ownerId: string, plane: string, command: AlgorithmSelectionWrite) =>
	createHash('sha256').update(JSON.stringify({ ownerId, plane, command })).digest('hex');
export { readUserAlgorithmSelection };
/** Selection is an independent desired-state write. Algorithm creation can precede
 * it remotely without delaying the caller's local apply/save completion. */
export async function synchronizeAlgorithmSelection(
	ownerId: string,
	raw: unknown,
	admit: () => Promise<void>
): Promise<AlgorithmSelectionAcknowledgment> {
	let command: AlgorithmSelectionWrite;
	try {
		command = parseAlgorithmSelectionWrite(raw);
	} catch {
		throw new AlgorithmSyncError(400, 'Invalid algorithm selection command.');
	}
	const things = await getHomeThingsCollection(),
		requestDigest = digest(ownerId, 'home', command);
	return withHomeMongoTransaction(async (session) => {
		await admit();
		const entries = await readTimelineEntries(things, ownerId, [eventId(command.writeId)], session);
		if (entries.length) {
			const event = entries[0].event,
				value = event.after?.value as any;
			if (
				entries.length !== 1 ||
				event.id !== eventId(command.writeId) ||
				event.thingId !== ownerId ||
				event.ownerId !== ownerId ||
				event.actorId !== ownerId ||
				event.operationId !== command.writeId ||
				event.source !== 'api' ||
				event.clientId !== null ||
				event.mode !== 'effect' ||
				event.operation !== 'effect' ||
				event.branchId !== 'main' ||
				event.parentIds.length ||
				event.dependencies.length ||
				event.before !== null ||
				event.after?.adapter !== 'algorithm-selection-receipt' ||
				event.after.version !== 1 ||
				value?.requestDigest !== requestDigest
			)
				throw new AlgorithmSyncError(409, 'Algorithm selection request identity changed.');
			const { requestDigest: _, ...result } = value;
			const acknowledgment = parseAlgorithmSelectionAcknowledgment(result);
			if (
				acknowledgment.writeId !== command.writeId ||
				acknowledgment.expectedVersion !== command.expectedVersion ||
				acknowledgment.algorithmId !== command.algorithmId
			)
				throw new AlgorithmSyncError(409, 'Algorithm selection receipt changed.');
			return acknowledgment;
		}
		try {
			const result = await setActiveAlgorithm(ownerId, command.algorithmId, { expectedVersion: command.expectedVersion, session });
			if (result.ok === false) throw new AlgorithmSyncError(result.status, result.error);
		} catch (error) {
			if (error instanceof ActiveFeedAlgorithmConflictError) throw new AlgorithmSyncError(409, error.message);
			throw error;
		}
		const acknowledgment = { ...command, result: await readUserAlgorithmSelection(ownerId, session) };
		await appendTimelineEvent(
			things,
			parseTimelineEvent({
				formatVersion: 1,
				id: eventId(command.writeId),
				ownerId,
				thingId: ownerId,
				branchId: 'main',
				parentIds: [],
				operationId: command.writeId,
				actorId: ownerId,
				source: 'api',
				clientId: null,
				occurredAt: new Date().toISOString(),
				mode: 'effect',
				operation: 'effect',
				label: 'Selected algorithm',
				before: null,
				after: { adapter: 'algorithm-selection-receipt', version: 1, value: { ...acknowledgment, requestDigest } },
				dependencies: []
			}),
			session,
			{ plane: 'home' }
		);
		return acknowledgment;
	});
}
