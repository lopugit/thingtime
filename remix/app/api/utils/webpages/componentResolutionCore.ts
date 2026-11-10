// Component keys are author-local names, not viewer-local names. A shared
// composition must keep its author's bindings even when its reader owns a
// different component with the same key.
export type ComponentCandidate = {
	shareId: string;
	ownerId: string;
	crystal?: Record<string, any>;
};

export const selectComponent = <T extends ComponentCandidate>(
	ref: string,
	docs: T[],
	compositionOwnerId: string | null
): T | null => {
	const exact = docs.find((doc) => doc.shareId === ref);
	if (exact) return exact;
	const seeded = docs.find((doc) => doc.ownerId === 'system' && doc.shareId === `component-${ref}`);
	if (seeded) return seeded;
	return docs
		.filter((doc) => !!compositionOwnerId && doc.ownerId === compositionOwnerId && doc.crystal?.componentKey === ref)
		.reduce<T | null>((latest, doc) => {
			const version = Number(doc.crystal?.version) || 0;
			return !latest || version > (Number(latest.crystal?.version) || 0) ? doc : latest;
		}, null);
};
