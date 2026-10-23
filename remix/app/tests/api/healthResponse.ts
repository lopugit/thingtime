// A health contract smoke is not a claim that every deployment is migrated.
// Required migrations must remain degraded, never be relabelled ready.
export const nitroHealthResponseIsConsistent = (body: any): boolean => {
	if (body?.service !== 'nitro' || body?.runtime !== 'nitro' || !Number.isSafeInteger(body?.storageAccounting?.expectedVersion) || body.storageAccounting.expectedVersion < 1) return false;
	if (body?.storageAccounting?.migrationId !== 'backfill-user-storage-accounting') return false;
	return (body.state === 'ready' && body.ok === true && body.storageAccounting.state === 'ready') ||
		(body.state === 'degraded' && body.ok === false && body.storageAccounting.state === 'migration-required');
};
