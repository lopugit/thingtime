import type { TimelineEvent, TimelineSnapshot } from './contract.ts';

/** Only execution metadata. Never retain inputs, result values, step traces,
 * exception text, credentials or external response bodies in this adapter. */
export const ACTION_OUTCOME_ADAPTER = 'action-outcome';
export type ActionOutcome = {
	runId: string;
	actionName: string;
	status: 'started' | 'ok' | 'error';
	startedAt: string;
	durationMs: number | null;
	opsUsed: number | null;
	depthUsed: number | null;
	childActionsUsed: number | null;
};
export type ActionTimelineReport = {
	status: 'recorded' | 'incomplete';
	startedEventId: string;
	outcomeEventId: string | null;
};
export const ACTION_TIMELINE_INCOMPLETE =
	'The Action ran, but we could not confirm its completion was saved to History. The accepted run is recorded. Check its changes before running it again.';
const keys = ['actionName', 'runId', 'status', 'startedAt', 'durationMs', 'opsUsed', 'depthUsed', 'childActionsUsed'];
export function actionOutcomeValue(snapshot: TimelineSnapshot | null): ActionOutcome | null {
	if (snapshot?.adapter !== ACTION_OUTCOME_ADAPTER || snapshot.version !== 1) return null;
	const value = snapshot.value as unknown as ActionOutcome;
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		Object.keys(value).length !== keys.length ||
		keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
	)
		return null;
	if (typeof value.actionName !== 'string' || !value.actionName.trim() || value.actionName.length > 160) return null;
	if (typeof value.runId !== 'string' || !/^action-run-[a-f0-9-]{36}$/.test(value.runId) || !['started', 'ok', 'error'].includes(value.status))
		return null;
	if (
		typeof value.startedAt !== 'string' ||
		!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.startedAt) ||
		!Number.isFinite(Date.parse(value.startedAt)) ||
		new Date(value.startedAt).toISOString() !== value.startedAt
	)
		return null;
	for (const key of ['durationMs', 'opsUsed', 'depthUsed', 'childActionsUsed'] as const)
		if (value.status === 'started' ? value[key] !== null : !Number.isSafeInteger(value[key]) || Number(value[key]) < 0) return null;
	return value;
}
export function readActionOutcome(event: TimelineEvent): ActionOutcome | null {
	if (
		event.mode !== 'effect' ||
		event.operation !== 'effect' ||
		!['action', 'ai'].includes(event.source) ||
		event.clientId !== null ||
		event.actorId !== event.ownerId ||
		event.branchId !== 'main' ||
		event.before !== null ||
		event.dependencies.length
	)
		return null;
	const value = actionOutcomeValue(event.after);
	if (!value || event.parentIds.length !== (value.status === 'started' ? 0 : 1)) return null;
	return value;
}
export const actionOutcomeLabel = (value: ActionOutcome) =>
	({ started: 'Action run accepted', ok: 'Action finished', error: 'Action stopped with an error' }[value.status]);
export const actionOutcomeDescription = (value: ActionOutcome) =>
	value.status === 'started'
		? 'Execution was admitted. This moment alone does not confirm completion. A later outcome for this run records how it finished.'
		: value.status === 'error'
		? 'The server reported an error. Earlier steps may have completed; inspect the related changes before running the Action again.'
		: 'The server finished this run. This records execution status, not a guarantee about external services. Earlier changes remain in History.';
