// The desktop's remote-sync mailbox poll runs for every paired Mac, all day.
// Each poll is a short server transaction, so a fixed 2 s loop kept a hosted
// function busy around the clock even when nobody was controlling the device.
// Poll quickly while commands are flowing, then back off when idle. The cap
// bounds how long an idle device takes to notice a new remote command.
export const REMOTE_SYNC_ACTIVE_POLL_MS = 2_000;
export const REMOTE_SYNC_IDLE_AFTER_EMPTY_POLLS = 3;
export const REMOTE_SYNC_MAX_IDLE_POLL_MS = 30_000;

export const remoteSyncPollDelay = (emptyPolls: number): number => {
	if (!(emptyPolls >= REMOTE_SYNC_IDLE_AFTER_EMPTY_POLLS)) return REMOTE_SYNC_ACTIVE_POLL_MS;
	const doublings = Math.min(emptyPolls - REMOTE_SYNC_IDLE_AFTER_EMPTY_POLLS + 1, 16);
	return Math.min(REMOTE_SYNC_ACTIVE_POLL_MS * 2 ** doublings, REMOTE_SYNC_MAX_IDLE_POLL_MS);
};
