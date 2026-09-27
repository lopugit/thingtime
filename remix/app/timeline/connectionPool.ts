import { timelineScopeKey, type TimelineScope } from './contract.ts';
import type { TimelineLocalStore } from './localStore.ts';
import type { TimelineBranchStore } from './branchStore.ts';
import type { TimelineSync } from './sync.ts';

export type TimelineConnection = { scope: TimelineScope; folderId: string; store: TimelineLocalStore; branches: TimelineBranchStore; sync: TimelineSync };

/** Home and selected discovery may resolve to the same database. Share their
 * queue and in-flight requests, stopping only after both sessions release it. */
export class TimelineConnectionPool {
	private entries = new Map<string, { connection: TimelineConnection; users: number }>();
	private create: (scope: TimelineScope, folderId: string) => TimelineConnection;
	constructor(create: (scope: TimelineScope, folderId: string) => TimelineConnection) { this.create = create; }
	acquire(scope: TimelineScope, folderId: string) {
		const key = timelineScopeKey(scope);
		let entry = this.entries.get(key);
		if (entry && entry.connection.folderId !== folderId) throw new Error('Timeline folder changed. Reconnect your history.');
		if (!entry) { entry = { connection: this.create(scope, folderId), users: 0 }; this.entries.set(key, entry); }
		entry.users++;
		let released = false;
		return { connection: entry.connection, release: () => {
			if (released) return;
			released = true;
			if (--entry!.users === 0) { entry!.connection.sync.stop(); this.entries.delete(key); }
		} };
	}
}
