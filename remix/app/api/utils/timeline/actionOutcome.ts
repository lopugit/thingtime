import { randomUUID } from 'node:crypto';
import { parseTimelineEvent, type TimelineEvent } from '../../../timeline/contract.ts';
import {
	ACTION_OUTCOME_ADAPTER,
	actionOutcomeLabel,
	readActionOutcome,
	type ActionOutcome,
	type ActionTimelineReport
} from '../../../timeline/actionOutcome.ts';
import { getThingsCollection, withMongoTransaction } from '../mongodb/collections';
import { appendTimelineEvent } from './repository.ts';
import { timelineMutationContext } from './mutationContext';
import { actionOutcomeRecovery } from './actionRecovery';

const append = async (event: TimelineEvent) => {
	const things = await getThingsCollection();
	await withMongoTransaction((session) => appendTimelineEvent(things, event, session));
};

/** Server-only admission/completion journal. No request field can supply its
 * provenance. Effects never replace the Action's Published content head.
 * A committed admission survives process failure without claiming completion. */
export function createActionTimelineRecorder(write = append, now = () => new Date(), seal = actionOutcomeRecovery.seal) {
	return {
		async begin(ownerId: string, actionId: string, runId: string, actionName = 'Action') {
			const context = timelineMutationContext(ownerId);
			if (!context) throw new Error('Action history requires trusted execution context');
			const value: ActionOutcome = {
				runId,
				actionName: actionName.trim().slice(0, 160) || 'Action',
				status: 'started',
				startedAt: now().toISOString(),
				durationMs: null,
				opsUsed: null,
				depthUsed: null,
				childActionsUsed: null
			};
			const event = parseTimelineEvent({
				formatVersion: 1,
				id: randomUUID(),
				ownerId,
				thingId: actionId,
				branchId: 'main',
				parentIds: [],
				operationId: context.operationId,
				actorId: ownerId,
				source: context.source,
				clientId: null,
				occurredAt: value.startedAt,
				mode: 'effect',
				operation: 'effect',
				label: actionOutcomeLabel(value),
				before: null,
				after: { adapter: ACTION_OUTCOME_ADAPTER, version: 1, value },
				dependencies: []
			});
			if (!readActionOutcome(event)) throw new Error('Invalid Action admission');
			await write(event); // Failure means the caller MUST NOT execute any steps.
			return event;
		},
		async finish(
			start: TimelineEvent,
			outcome: Pick<ActionOutcome, 'status' | 'durationMs' | 'opsUsed' | 'depthUsed' | 'childActionsUsed'>
		): Promise<ActionTimelineReport> {
			const admission = readActionOutcome(start);
			if (!admission || admission.status !== 'started' || outcome.status === 'started') throw new Error('Invalid Action completion');
			// Project known fields individually. Future executor fields or an error
			// object must never accidentally become retained account content.
			const value: ActionOutcome = {
				runId: admission.runId,
				actionName: admission.actionName,
				startedAt: admission.startedAt,
				status: outcome.status,
				durationMs: outcome.durationMs,
				opsUsed: outcome.opsUsed,
				depthUsed: outcome.depthUsed,
				childActionsUsed: outcome.childActionsUsed
			};
			const event = parseTimelineEvent({
				...start,
				id: randomUUID(),
				parentIds: [start.id],
				occurredAt: now().toISOString(),
				label: actionOutcomeLabel(value),
				after: { adapter: ACTION_OUTCOME_ADAPTER, version: 1, value }
			});
			if (!readActionOutcome(event)) throw new Error('Invalid Action outcome');
			// Retry only the SAME immutable receipt, never execute the Action again.
			// This also resolves a committed write whose acknowledgement was lost.
			for (let attempt = 0; attempt < 3; attempt += 1) {
				try {
					await write(event);
					return { status: 'recorded', startedEventId: start.id, outcomeEventId: event.id };
				} catch {
					/* Preserve the actual execution result after bounded retries. */
				}
			}
			const recovery = await seal(event).catch(() => null);
			return { status: 'incomplete', startedEventId: start.id, outcomeEventId: null, ...(recovery ? { recovery } : {}) };
		}
	};
}
export const actionTimelineRecorder = createActionTimelineRecorder();
