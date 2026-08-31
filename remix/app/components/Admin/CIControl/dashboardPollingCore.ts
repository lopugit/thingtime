export const CI_DASHBOARD_POLL_INTERVAL_MS = 30_000;
export const CI_DASHBOARD_LIVE_POLL_INTERVAL_MS = 5_000;
export const CI_DASHBOARD_MAX_RETRY_DELAY_MS = 5 * 60_000;

const retryAfterSeconds = (error: unknown): number | null => {
	if (!error || typeof error !== 'object') return null;
	const value = Number((error as { retryAfterSeconds?: unknown }).retryAfterSeconds);
	return Number.isFinite(value) && value >= 0 ? value : null;
};

export const ciDashboardRetryDelayMs = (failureCount: number, error?: unknown): number => {
	const exponent = Math.max(0, Math.floor(failureCount) - 1);
	const exponential = Math.min(CI_DASHBOARD_MAX_RETRY_DELAY_MS, CI_DASHBOARD_POLL_INTERVAL_MS * 2 ** exponent);
	const serverDelay = (retryAfterSeconds(error) ?? 0) * 1000;
	return Math.min(CI_DASHBOARD_MAX_RETRY_DELAY_MS, Math.max(exponential, serverDelay));
};

export const shouldPollCiDashboard = (nowMs: number, nextRetryAtMs: number, foreground = false): boolean => foreground || nowMs >= nextRetryAtMs;

export class CiDashboardSingleFlight {
	private inFlight: Promise<void> | null = null;

	peek(): Promise<void> | null {
		return this.inFlight;
	}

	run(start: () => Promise<void>): Promise<void> {
		if (this.inFlight) return this.inFlight;
		const request = start();
		this.inFlight = request;
		void request.then(
			() => {
				if (this.inFlight === request) this.inFlight = null;
			},
			() => {
				if (this.inFlight === request) this.inFlight = null;
			}
		);
		return request;
	}
}
