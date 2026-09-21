// Shared continuation policy. A saved checkpoint is evidence; a lost transport
// alone is not. Never infer permission from the wording of a chat message.
export const LOPU_CONTINUE_PROMPT =
	'Continue the interrupted reply from its saved progress. Check the conversation’s tool receipts and the current state first. Do not repeat completed actions or recreate things that already exist. Finish the remaining work; ask for a fresh confirmation wherever one is required.';
export const LOPU_RECOVERABLE_STOPS = ['checkpoint', 'tool_limit', 'hop_limit', 'time_limit', 'max_tokens', 'error'];
export type LopuManagement = 'client' | 'server';
export const lopuManagement = (value: unknown): LopuManagement => (value === 'server' ? 'server' : 'client');
export const continuationContext = (context: any) =>
	context
		? {
				route: context.route,
				viewport: context.viewport,
				...(context.page?.id
					? { page: { id: context.page.id, source: context.page.source, pageKey: context.page.pageKey, siteRoute: context.page.siteRoute } }
					: {})
		  }
		: undefined;
export const canAutomaticallyResume = (value: { stopReason?: unknown; continuationSafe?: unknown }) =>
	value.continuationSafe === true && LOPU_RECOVERABLE_STOPS.includes(String(value.stopReason));

export const continuationRequestId = async (chatId: string, previousRequestId: string) => {
	const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([chatId, previousRequestId])));
	return `resume-${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};
