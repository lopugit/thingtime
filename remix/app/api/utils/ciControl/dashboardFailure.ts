export const CI_DASHBOARD_ROUTE = '/api/v1/admin/ci';
export const CI_DASHBOARD_QUERY_CAPACITY_CODE = 'ci_dashboard_query_capacity';
export const CI_DASHBOARD_RETRY_AFTER_SECONDS = 30;

type MongoLikeError = {
	code?: unknown;
	codeName?: unknown;
	name?: unknown;
};

const safeToken = (value: unknown): string | null => {
	const token = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
	return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(token) ? token : null;
};

export const isCiDashboardSortMemoryError = (error: unknown): boolean => {
	if (!error || typeof error !== 'object') return false;
	const mongo = error as MongoLikeError;
	return Number(mongo.code) === 292 || mongo.codeName === 'QueryExceededMemoryLimitNoDiskUseAllowed';
};

export const ciDashboardCapacityFailure = (error: unknown) => {
	if (!isCiDashboardSortMemoryError(error)) return null;
	const mongo = error as MongoLikeError;
	return {
		status: 503,
		retryAfterSeconds: CI_DASHBOARD_RETRY_AFTER_SECONDS,
		body: {
			ok: false,
			error: 'CI dashboard data is temporarily unavailable. Last-known cached data remains safe to use.',
			code: CI_DASHBOARD_QUERY_CAPACITY_CODE,
			retryable: true
		},
		log: {
			event: 'ci_dashboard_query_failed',
			route: CI_DASHBOARD_ROUTE,
			errorCode: CI_DASHBOARD_QUERY_CAPACITY_CODE,
			mongoCode: 292,
			mongoCodeName: safeToken(mongo.codeName) ?? 'QueryExceededMemoryLimitNoDiskUseAllowed',
			retryAfterSeconds: CI_DASHBOARD_RETRY_AFTER_SECONDS
		}
	};
};
