/** Compose idle scheduling and active-transfer lifetimes into the host's one
 * idempotent window lease. Releasing one holder must not release another. */
export function createSyncWindowRetention(write: (active: boolean) => Promise<unknown>) {
	const holders = new Set<symbol>();
	let queue = Promise.resolve();
	const flush = () => {
		const next = queue.catch(() => {}).then(async () => { await write(holders.size > 0); });
		queue = next;
		return next;
	};
	return async () => {
		const holder = Symbol(); holders.add(holder);
		try { await flush(); } catch (error) { holders.delete(holder); await flush().catch(() => {}); throw error; }
		let released = false;
		return async () => { if (released) return; released = true; holders.delete(holder); await flush(); };
	};
}
