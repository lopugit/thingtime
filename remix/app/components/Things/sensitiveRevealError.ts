import { ThingtimeApiError } from '~/hooks/apiFailure';

export type SensitiveRevealRecovery = 'password' | 'login' | 'refresh' | 'wait' | 'retry' | 'dismiss';

export type SensitiveRevealFailure = {
	message: string;
	recovery: SensitiveRevealRecovery;
};

export const SENSITIVE_REVEAL_FALLBACK_MESSAGE = 'We could not reveal this protected value. Please try again.';

// This mapper is a disclosure boundary: it returns only fixed client-authored
// copy and never reflects an unexpected API/proxy error string into the modal
// or a Lopu toast.
export const sensitiveRevealFailure = (error: unknown): SensitiveRevealFailure => {
	if (error instanceof ThingtimeApiError) {
		if (error.status === 401) {
			return error.error === 'Password confirmation failed'
				? {
						message: 'We could not confirm your password. Re-enter your current password and try again.',
						recovery: 'password'
				  }
				: {
						message: 'Your session expired. Log in again before revealing this protected value.',
						recovery: 'login'
				  };
		}
		if (error.status === 403) {
			return {
				message: 'Your account no longer has permission to reveal this protected value.',
				recovery: 'dismiss'
			};
		}
		if (error.status === 404) {
			return {
				message: 'This protected value is missing, expired, or no longer available. Refresh this Thing.',
				recovery: 'refresh'
			};
		}
		if (error.status === 429) {
			return {
				message:
					error.retryAfterSeconds === null
						? 'Too many reveal confirmation attempts. Please wait before trying again.'
						: `Too many reveal confirmation attempts. Try again in ${error.retryAfterSeconds} seconds.`,
				recovery: 'wait'
			};
		}
		if (error.status !== null && error.status >= 500) {
			return {
				message: 'Protected-value confirmation is temporarily unavailable. Please wait and try again.',
				recovery: 'retry'
			};
		}
		if (error.status === null) {
			return {
				message: 'Thingtime could not reach the server. Check your connection before trying again.',
				recovery: 'retry'
			};
		}
	}
	return { message: SENSITIVE_REVEAL_FALLBACK_MESSAGE, recovery: 'dismiss' };
};

export const sensitiveRevealErrorMessage = (error: unknown): string => sensitiveRevealFailure(error).message;
