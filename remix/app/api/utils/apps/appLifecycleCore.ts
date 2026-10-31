export type DeleteAppLifecycleResult = { ok: true; state: 'deleted' | 'absent'; revokedSessions: number } | { ok: false; state: 'forbidden' };

type AppLifecycleThings = {
	findOne: (filter: Record<string, unknown>, options: Record<string, unknown>) => Promise<any>;
	findOneAndDelete: (filter: Record<string, unknown>, options: Record<string, unknown>) => Promise<any>;
};

type AppLifecycleSessions = {
	updateMany: (
		filter: Record<string, unknown>,
		update: Record<string, unknown>,
		options: Record<string, unknown>
	) => Promise<{ modifiedCount?: number }>;
};

export const appControlThingMatch = (clientId: string): Record<string, unknown> => ({
	thingtime: 'app',
	'crystal.clientId': clientId
});

export const liveAppSessionsMatch = (clientId: string): Record<string, unknown> => ({
	purpose: 'app',
	'meta.clientId': clientId,
	revokedAt: null
});

// One transaction owns the complete app lifecycle change: authorize against
// the same snapshot, delete exactly the registered-app control Thing, and
// revoke every app session. Namespace content (`appId` rows) and protected
// per-user app-storage counters are deliberately outside this mutation and
// therefore remain browseable/reconcilable after the app is gone.
//
// Missing is success. That makes caller retries and Mongo callback retries
// converge on the same absent + revoked state, and repairs any historical
// partial delete that removed the app before its session sweep completed.
export const deleteAppLifecycleInSession = async (input: {
	things: AppLifecycleThings;
	sessions: AppLifecycleSessions;
	ownerId: string;
	clientId: string;
	revokedAt: Date;
	session: any;
	canManage: (ownerId: string, appDoc: any, session: any) => Promise<boolean>;
}): Promise<DeleteAppLifecycleResult> => {
	const match = appControlThingMatch(input.clientId);
	const app = await input.things.findOne(match, { session: input.session });

	if (app && !(await input.canManage(input.ownerId, app, input.session))) {
		return { ok: false, state: 'forbidden' };
	}

	if (app) {
		if (!app._id) throw new Error('Registered app is missing its Mongo identity');
		const deleted = await input.things.findOneAndDelete({ _id: app._id, ...match }, { session: input.session });
		if (!deleted) {
			// The read + exact delete share one snapshot, so this means a malformed
			// adapter or an invariant violation. Throwing aborts the transaction;
			// never revoke sessions while leaving the app control row live.
			throw new Error('Registered app changed while it was being deleted');
		}
	}

	const revoked = await input.sessions.updateMany(
		liveAppSessionsMatch(input.clientId),
		{ $set: { revokedAt: input.revokedAt } },
		{ session: input.session }
	);

	return {
		ok: true,
		state: app ? 'deleted' : 'absent',
		revokedSessions: Number.isSafeInteger(revoked.modifiedCount) ? Number(revoked.modifiedCount) : 0
	};
};
