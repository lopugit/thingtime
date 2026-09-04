// Ingest de-noising for the CI control plane — PURE.
//
// Every GitHub delivery upserts the ci-repository row first (so the dashboard
// always has a repository header) and then the entity the delivery is about.
// Recording a ci-event for BOTH upserts made the repository row the parent of
// ~50% of all events in production (672,052 "active → active" rows out of
// 1.37M): a status history where nothing changed. A transition that is not a
// transition is not history. Entity events stay 'always' because a same-status
// delivery can still carry new data (a pull_request synchronize keeps status
// `clean` while headSha moves).

export type CiEntityEventPolicy = 'always' | 'on-change';

export type CiEntityUpsertOutcome = {
  inserted: boolean;
  previousStatus: string | null;
  nextStatus: string;
  ignoredAsOlder: boolean;
};

export const shouldRecordEntityEvent = (policy: CiEntityEventPolicy, outcome: CiEntityUpsertOutcome): boolean => {
  if (policy === 'always') return true;
  if (outcome.inserted) return true;
  if (outcome.ignoredAsOlder) return false;
  return outcome.previousStatus !== outcome.nextStatus;
};
