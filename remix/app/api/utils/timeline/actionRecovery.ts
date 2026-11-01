import { createHash } from 'node:crypto';
import { signContentProof, verifyContentProof } from '../auth/jwt';
import { getActiveMongoUri, getActiveMongoDbName } from '../mongodb/endpoint';
import { sanitiseMongoHost } from '../mongodb/config';
import { mongoDataPlane } from '../mongodb/dataPlane';
import { getThingsCollection, withMongoTransaction } from '../mongodb/collections';
import { StorageMutationError } from '../storage/storageCore';
import { parseActionOutcomeRecovery, type ActionOutcomeRecovery } from '../../../timeline/actionRecovery.ts';
import { readActionOutcome } from '../../../timeline/actionOutcome.ts';
import { timelineEventText, type TimelineEvent } from '../../../timeline/contract.ts';
import { appendTimelineEvent, readTimelineEntries } from './repository.ts';

const purpose = 'timeline-action-outcome-v1';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
// Include home's actual location as well as the selected-plane identity.
// Public host/database only; credentials must never become hash oracles.
const audience = () => `timeline:${hash(JSON.stringify([sanitiseMongoHost(getActiveMongoUri()), getActiveMongoDbName(), mongoDataPlane()]))}`;
const digest = (event: TimelineEvent) => hash(timelineEventText(event));
const defaults = {
	collection: getThingsCollection, transaction: withMongoTransaction, entries: readTimelineEntries, append: appendTimelineEvent,
	plane: mongoDataPlane, audience, sign: signContentProof, verify: verifyContentProof
};

export function createActionOutcomeRecovery(overrides: Partial<typeof defaults> = {}) {
	const deps = { ...defaults, ...overrides };
	return {
		async seal(event: TimelineEvent): Promise<ActionOutcomeRecovery> {
			const proof = await deps.sign(purpose, digest(event), deps.audience());
			return parseActionOutcomeRecovery({ formatVersion: 1, event, dataPlane: deps.plane(), proof });
		},
		async recover(ownerId: string, input: ActionOutcomeRecovery) {
			const recovery = parseActionOutcomeRecovery(input); const event = recovery.event;
			if (ownerId !== event.ownerId || recovery.dataPlane !== deps.plane() || !await deps.verify(recovery.proof, purpose, digest(event), deps.audience()))
				throw new StorageMutationError(409, 'storage_conflict', 'This saved Action outcome cannot be verified for this account and database. Your local copy is preserved.');
			const things = await deps.collection();
			return deps.transaction(async (session) => {
				const start = (await deps.entries(things, ownerId, event.parentIds, session))[0]?.event;
				const admission = start && readActionOutcome(start); const outcome = readActionOutcome(event)!;
				if (!start || !admission || admission.status !== 'started' ||
					['ownerId', 'thingId', 'branchId', 'operationId', 'actorId', 'source', 'clientId'].some(key => start[key] !== event[key]) ||
					['runId', 'actionName', 'startedAt'].some(key => admission[key] !== outcome[key]))
					throw new StorageMutationError(409, 'storage_conflict', 'The original Action admission is unavailable. Your local outcome is preserved.');
				// Exact idempotent append, ordinary quota, same canonical records.
				// There is no executor or live Action lookup on this path.
				return deps.append(things, event, session);
			});
		}
	};
}
export const actionOutcomeRecovery = createActionOutcomeRecovery();
