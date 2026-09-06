export const visibleWatchRequests = <T extends { pairingId: string; expiresAt: string }>(
	snapshot: { accountId: string; requests: T[] } | null,
	user: { id?: string; temporary?: boolean } | null | undefined,
	dismissed: ReadonlySet<string>,
	now = Date.now()
): T[] => {
	if (!snapshot || !user?.id || user.temporary || snapshot.accountId !== user.id) return [];
	return snapshot.requests.filter((request) => !dismissed.has(request.pairingId) && Date.parse(request.expiresAt) > now);
};
