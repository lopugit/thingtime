export const visibleWatchRequests = <T extends { pairingId: string; expiresAt: string }>(
	snapshot: { accountId: string; requests: T[] } | null,
	user: { id?: string; temporary?: boolean } | null | undefined,
	dismissed: ReadonlySet<string>,
	now = Date.now()
): T[] => {
	if (!snapshot || !user?.id || user.temporary || snapshot.accountId !== user.id) return [];
	return snapshot.requests.filter((request) => !dismissed.has(request.pairingId) && Date.parse(request.expiresAt) > now);
};

// Every signed-in page mounts the approval prompt. Desktop windows stay
// "visible" all day, so a fixed 15 s poll kept a hosted function busy for
// hours even though Watch pairing is rare. Explicit signals (focus,
// visibility, an offered approval) always check. The background tick checks
// every 15 s only while a request is pending; otherwise every 5 minutes.
export const WATCH_APPROVAL_TICK_MS = 15_000;
export const WATCH_APPROVAL_IDLE_POLL_MS = 5 * 60_000;
export const shouldPollWatchApprovals = (
	trigger: 'tick' | 'signal',
	state: { lastPolledAt: number; hasPending: boolean },
	now = Date.now()
): boolean => trigger === 'signal' || state.hasPending || now - state.lastPolledAt >= WATCH_APPROVAL_IDLE_POLL_MS;
