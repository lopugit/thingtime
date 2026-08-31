export const featureStackTargetsForSource = (base: string, selectedTargets: string[], autoDecideBranches: boolean) => {
	if (!autoDecideBranches) return [...selectedTargets];
	if (base === 'github-actions') return selectedTargets.filter((target) => target === 'github-actions');
	if (base === 'main') return selectedTargets.filter((target) => target === 'main');
	if (base === 'develop') return selectedTargets.filter((target) => target === 'develop' || target === 'main');
	return selectedTargets.filter((target) => target === base);
};
