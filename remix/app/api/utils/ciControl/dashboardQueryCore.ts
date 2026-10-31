export const CI_DASHBOARD_UPDATED_SORT: Record<string, 1 | -1> = {
	updatedAt: -1,
	shareId: 1
};

export const CI_DASHBOARD_UPDATED_INDEX: Record<string, 1 | -1> = {
	thingtime: 1,
	'crystal.repository': 1,
	...CI_DASHBOARD_UPDATED_SORT
};

export const CI_DASHBOARD_ACTIVITY_LIMIT = 250;
export const CI_DASHBOARD_SELECTION_LIMIT = 1000;

const UNBOUNDED_SELECTION_KINDS = new Set(['ci-feature', 'ci-branch', 'ci-pull-request']);

export const ciDashboardKindFilter = (kind: string, repository: string) => ({
	thingtime: kind,
	'crystal.repository': repository.trim().slice(0, 300)
});

export const ciDashboardReadLimit = (kind: string, requestedLimit: number) => {
	const normalized = Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 100;
	if (UNBOUNDED_SELECTION_KINDS.has(kind)) {
		return normalized === 0 ? 0 : Math.min(CI_DASHBOARD_SELECTION_LIMIT, Math.max(1, normalized));
	}
	return Math.min(CI_DASHBOARD_ACTIVITY_LIMIT, normalized === 0 ? CI_DASHBOARD_ACTIVITY_LIMIT : Math.max(1, normalized));
};

export const ciDashboardFieldFilter = (
	kind: string,
	repository: string,
	field: 'state' | 'status',
	values: string[]
) => ({
	...ciDashboardKindFilter(kind, repository),
	[`crystal.${field}`]: { $in: values }
});
