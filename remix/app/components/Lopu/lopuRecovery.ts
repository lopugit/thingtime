import { LOPU_MAX_RECOVERY_FAILURES, lopuRecoveryFailures } from '~/api/utils/lopu/continuationCore';
import { taskNeedsAttention } from '~/api/utils/lopu/backgroundTaskCore';
export const canContinueLopuReply = (status: unknown, stopReason: unknown) =>
	status === 'error' || status === 'aborted' || stopReason === 'aborted' || taskNeedsAttention(stopReason);
export { LOPU_CONTINUE_PROMPT } from '~/api/utils/lopu/continuationCore';
// Continue only a persisted, cleanly observed budget boundary. A lost stream or
// unacknowledged provider error may leave a write in flight and needs review.
export const shouldAutoContinueLopuReply = (turn: {
 status: string; stopReason: string | null; assistantMessageId: string | null;
 continuationSafe?: boolean; recoveryFailures?: number;
 tools: Array<{ status: string; result?: unknown; confirm?: { resolved?: string | null } | null }>;
}) => lopuRecoveryFailures(turn.recoveryFailures) < LOPU_MAX_RECOVERY_FAILURES && turn.status === 'done' && turn.continuationSafe !== false && (turn.stopReason !== 'error' || turn.continuationSafe === true) && !!turn.assistantMessageId &&
 ['checkpoint', 'tool_limit', 'hop_limit', 'time_limit', 'max_tokens', 'error'].includes(turn.stopReason || '') &&
 !turn.tools.some(tool => tool.status === 'streaming' || tool.status === 'running' || tool.status === 'confirm' || (tool.status === 'error' && !tool.result) || (tool.confirm && !tool.confirm.resolved));
