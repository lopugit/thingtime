import { taskNeedsAttention } from '~/api/utils/lopu/backgroundTaskCore';
export const canContinueLopuReply = (status: unknown, stopReason: unknown) =>
	status === 'error' || status === 'aborted' || stopReason === 'aborted' || taskNeedsAttention(stopReason);
export const LOPU_CONTINUE_PROMPT =
	'Continue the interrupted reply from its saved progress. Check the conversation’s tool receipts and the current state first. Do not repeat completed actions or recreate things that already exist. Finish the remaining work; ask for a fresh confirmation wherever one is required.';

// Continue only a persisted, cleanly observed budget boundary. A lost stream or
// provider error may leave a write in flight, so those require manual recovery.
export const shouldAutoContinueLopuReply = (turn: {
 status: string; stopReason: string | null; assistantMessageId: string | null;
 tools: Array<{ status: string; result?: unknown; confirm?: { resolved?: string | null } | null }>;
}) => turn.status === 'done' && !!turn.assistantMessageId &&
 ['checkpoint', 'tool_limit', 'hop_limit', 'time_limit', 'max_tokens'].includes(turn.stopReason || '') &&
 !turn.tools.some(tool => tool.status === 'confirm' || (tool.status === 'error' && !tool.result) || (tool.confirm && !tool.confirm.resolved));
