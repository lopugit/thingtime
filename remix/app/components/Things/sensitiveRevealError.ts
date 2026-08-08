import { ThingtimeApiError, apiErrorMessage } from '~/hooks/apiFailure';

export const sensitiveRevealErrorMessage = (error: unknown): string => {
	if (error instanceof ThingtimeApiError) {
		if (error.status === 401) {
			return error.error === 'Password confirmation failed'
				? 'We could not confirm your password. Re-enter your current password and try again.'
				: 'Your session expired. Log in again before revealing this protected value.';
		}
		if (error.status === 403) return 'Your account no longer has permission to reveal this protected value.';
		if (error.status === 404) return 'This protected value is missing, expired, or no longer available. Refresh this Thing.';
		if (error.status === 429) {
			return error.retryAfterSeconds === null
				? 'Too many reveal confirmation attempts. Please wait before trying again.'
				: `Too many reveal confirmation attempts. Try again in ${error.retryAfterSeconds} seconds.`;
		}
		if (error.status !== null && error.status >= 500) {
			return 'Protected-value confirmation is temporarily unavailable. Please wait and try again.';
		}
	}
	return apiErrorMessage(error, 'We could not reveal this protected value. Please try again.');
};
