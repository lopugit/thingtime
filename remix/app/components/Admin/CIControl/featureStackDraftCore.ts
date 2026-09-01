type PullRequestReference = {
	number?: string | number | null;
	parentId?: string | null;
};

export const resolveFeatureStackSources = (
	sourcePrNumbers: number[],
	pullRequests: PullRequestReference[]
): { selectedFeatureIds: string[]; pendingSourcePrNumbers: number[] } => {
	const featureIdByPrNumber = new Map<number, string>();
	for (const pullRequest of pullRequests) {
		const number = Number(pullRequest.number);
		if (Number.isInteger(number) && pullRequest.parentId) featureIdByPrNumber.set(number, pullRequest.parentId);
	}

	const selectedFeatureIds: string[] = [];
	const pendingSourcePrNumbers: number[] = [];
	for (const number of sourcePrNumbers) {
		const featureId = featureIdByPrNumber.get(number);
		if (featureId) selectedFeatureIds.push(featureId);
		else pendingSourcePrNumbers.push(number);
	}

	return { selectedFeatureIds, pendingSourcePrNumbers };
};

export const sameNumberOrder = (left: number[], right: number[]) =>
	left.length === right.length && left.every((number, index) => number === right[index]);
