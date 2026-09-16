import { taskNeedsAttention } from '~/api/utils/lopu/backgroundTaskCore';
export const canContinueLopuReply = (status: unknown, stopReason: unknown) =>
	status === 'error' || status === 'aborted' || stopReason === 'aborted' || taskNeedsAttention(stopReason);
export const LOPU_CONTINUE_PROMPT =
	'Continue the interrupted reply from its saved progress. Check the conversation’s tool receipts and the current state first. Do not repeat completed actions or recreate things that already exist. Finish the remaining work; ask for a fresh confirmation wherever one is required.';
