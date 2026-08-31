export const CI_DASHBOARD_UPDATED_SORT: Record<string, 1 | -1> = {
	updatedAt: -1,
	shareId: 1
};

export const CI_DASHBOARD_UPDATED_INDEX: Record<string, 1 | -1> = {
	thingtime: 1,
	'crystal.repository': 1,
	...CI_DASHBOARD_UPDATED_SORT
};

export const ciDashboardKindFilter = (kind: string, repository: string) => ({
	thingtime: kind,
	'crystal.repository': repository.trim().slice(0, 300)
});
