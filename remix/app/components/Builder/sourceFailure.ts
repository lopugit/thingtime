export function sourceFailure(error: unknown, shared = false) {
	const failure = error as { error?: string; message?: string; status?: number; errorStatus?: number } | null;
	const message = failure?.error || failure?.message || 'The source action failed';
	const unowned = /no action you own matches/i.test(message) ||
		(shared && message === 'Browser flows require your own Action and a first-party session');
	const httpStatus = Number(failure?.errorStatus ?? failure?.status);
	return {
		status: unowned ? 'not-installed' as const : 'error' as const,
		error: unowned ? null : message,
		clear: unowned || [401, 403, 404].includes(httpStatus) || message === 'The active account changed. Run the action again.'
	};
}
