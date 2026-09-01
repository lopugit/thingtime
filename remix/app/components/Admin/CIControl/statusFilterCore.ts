export const PULL_REQUEST_STATUS_FILTERS = [
	{ id: 'clean', label: 'Clean', color: 'green' },
	{ id: 'conflicting', label: 'Conflicting', color: 'red' },
	{ id: 'draft', label: 'Draft', color: 'orange' },
	{ id: 'merged', label: 'Merged', color: 'green' },
	{ id: 'closed', label: 'Closed', color: 'gray' },
	{ id: 'unknown', label: 'Unknown', color: 'gray' }
] as const;

export const ALL_PULL_REQUEST_STATUS_FILTER_IDS = PULL_REQUEST_STATUS_FILTERS.map((option) => option.id);

export const normalizePullRequestStatus = (value: unknown) =>
	String(value ?? 'unknown')
		.trim()
		.toLowerCase() || 'unknown';

export const matchesPullRequestStatusFilter = (status: unknown, selectedStatuses: readonly string[]) =>
	selectedStatuses.includes(normalizePullRequestStatus(status));
