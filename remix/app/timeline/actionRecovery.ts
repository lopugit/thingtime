import { copyBoundedJson } from '../utils/boundedJson.ts';
import { isDataPlane } from '../utils/dataPlane.ts';
import { parseTimelineEvent, type TimelineEvent } from './contract.ts';
import { readActionOutcome, type ActionTimelineReport } from './actionOutcome.ts';

/** Delivery metadata only. The event and its relationships keep the exact
 * canonical local/server format. Only the server can verify the content proof. */
export type ActionOutcomeRecovery = { formatVersion: 1; event: TimelineEvent; dataPlane: string; proof: string };
export function parseActionOutcomeRecovery(input: unknown): ActionOutcomeRecovery {
	const value = copyBoundedJson(input, { maxBytes: 16 * 1024, maxDepth: 12, maxNodes: 256 }, 'Action history recovery') as ActionOutcomeRecovery;
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'dataPlane,event,formatVersion,proof' ||
		value.formatVersion !== 1 || !isDataPlane(value.dataPlane) || typeof value.proof !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.proof) || value.proof.length > 4096)
		throw new Error('Invalid Action history recovery');
	const event = parseTimelineEvent(value.event); const outcome = readActionOutcome(event);
	if (!outcome || outcome.status === 'started') throw new Error('Only a completed server outcome can be recovered');
	return { formatVersion: 1, event, dataPlane: value.dataPlane, proof: value.proof };
}

export function parseActionOutcomeRecoveryCommand(input: unknown): ActionOutcomeRecovery {
	if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'command,recovery' || (input as any).command !== 'recover-action-outcome')
		throw new Error('Invalid Action recovery command');
	return parseActionOutcomeRecovery((input as any).recovery);
}

/** Capture the original request identity. A late reply must never move into
 * another viewer's or database's queue. Persistence failure cannot hide the
 * actual execution result or invite an accidental rerun. */
export async function retainActionOutcomeRecovery<T extends { history?: ActionTimelineReport }>(
	response: T, ownerId: string | undefined, dataPlane: string | null,
	enqueue: (recovery: ActionOutcomeRecovery) => Promise<void>
): Promise<T & { history?: ActionTimelineReport }> {
	if (response?.history?.status !== 'incomplete' || !response.history.recovery) return response;
	let localRecovery: 'saved' | 'unavailable' = 'unavailable';
	try {
		const recovery = parseActionOutcomeRecovery(response.history.recovery);
		if (!ownerId || !dataPlane || recovery.event.ownerId !== ownerId || recovery.dataPlane !== dataPlane || recovery.event.parentIds[0] !== response.history.startedEventId)
			throw new Error('Action history request identity changed');
		await enqueue(recovery); localRecovery = 'saved';
	} catch { /* Return the original result and an honest local durability state. */ }
	return { ...response, history: { ...response.history, localRecovery } };
}
