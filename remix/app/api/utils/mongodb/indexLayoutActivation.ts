// Readiness caches live for 30 seconds. Keep redundant indexes for a full
// minute after activation so compatible workers can drain their cached reads.
// This is NOT a substitute for deploying compatible code on all DB consumers.
export const INDEX_LAYOUT_DRAIN_MS = 60_000;

export const activateIndexLayout = async (settings: any, key: string, assertLease: () => Promise<void>, now = Date.now()) => {
	const marker = await settings.findOne({ key }, { projection: { ready: 1, activatedAt: 1 } });
	const activatedAt = marker?.activatedAt instanceof Date ? marker.activatedAt.getTime() : NaN;
	if (marker?.ready === true && Number.isFinite(activatedAt) && activatedAt <= now) {
		return { retirementReady: now - activatedAt >= INDEX_LAYOUT_DRAIN_MS, remainingMs: Math.max(0, INDEX_LAYOUT_DRAIN_MS - (now - activatedAt)) };
	}
	await assertLease();
	await settings.updateOne({ key }, { $set: { ready: true, activatedAt: new Date(now), updatedAt: new Date(now) }, $setOnInsert: { key } }, { upsert: true });
	return { retirementReady: false, remainingMs: INDEX_LAYOUT_DRAIN_MS };
};
