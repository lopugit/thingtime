import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { appControlThingMatch, deleteAppLifecycleInSession, liveAppSessionsMatch } from './appLifecycleCore.ts';

const clientId = 'ttapp_a';
const ownerId = 'owner-a';
const revokedAt = new Date('2026-08-07T01:02:03.000Z');

test('app deletion removes only the control Thing and revokes sessions on the same session', async () => {
	const transactionSession = { id: 'transaction-a' };
	const docs = [
		{ _id: 'app-row', thingtime: ['app'], ownerId, crystal: { clientId } },
		{ _id: 'namespace-row', thingtime: ['app-data'], ownerId: 'user-a', appId: clientId },
		{ _id: 'counter-row', thingtime: ['app-storage'], ownerId: 'user-a', crystal: { appId: clientId } }
	];
	const sessionsState = [
		{ jti: 'live-a', purpose: 'app', meta: { clientId }, revokedAt: null },
		{ jti: 'other-app', purpose: 'app', meta: { clientId: 'ttapp_other' }, revokedAt: null }
	];
	const operationSessions: unknown[] = [];

	const things = {
		async findOne(_filter: Record<string, unknown>, options: Record<string, unknown>) {
			operationSessions.push(options.session);
			return docs.find((doc) => doc._id === 'app-row') ?? null;
		},
		async findOneAndDelete(filter: Record<string, unknown>, options: Record<string, unknown>) {
			operationSessions.push(options.session);
			assert.deepEqual(filter, { _id: 'app-row', ...appControlThingMatch(clientId) });
			const index = docs.findIndex((doc) => doc._id === filter._id && doc.thingtime.includes('app') && doc.crystal?.clientId === clientId);
			return index < 0 ? null : docs.splice(index, 1)[0];
		}
	};
	const sessions = {
		async updateMany(filter: Record<string, unknown>, update: Record<string, any>, options: Record<string, unknown>) {
			operationSessions.push(options.session);
			assert.deepEqual(filter, liveAppSessionsMatch(clientId));
			let modifiedCount = 0;
			for (const row of sessionsState) {
				if (row.purpose === 'app' && row.meta.clientId === clientId && row.revokedAt === null) {
					row.revokedAt = update.$set.revokedAt;
					modifiedCount += 1;
				}
			}
			return { modifiedCount };
		}
	};
	const canManage = async (requestedOwnerId: string, app: any, session: any) => {
		assert.equal(requestedOwnerId, ownerId);
		assert.equal(app._id, 'app-row');
		assert.equal(session, transactionSession);
		return true;
	};

	const deleted = await deleteAppLifecycleInSession({
		things,
		sessions,
		ownerId,
		clientId,
		revokedAt,
		session: transactionSession,
		canManage
	});
	assert.deepEqual(deleted, { ok: true, state: 'deleted', revokedSessions: 1 });
	assert.deepEqual(
		docs.map((doc) => doc.thingtime[0]),
		['app-data', 'app-storage'],
		'namespace data and orphan-accounting counters must survive app deletion'
	);
	assert.equal(sessionsState[0].revokedAt, revokedAt);
	assert.equal(sessionsState[1].revokedAt, null);
	assert.ok(operationSessions.every((session) => session === transactionSession));

	const retried = await deleteAppLifecycleInSession({
		things,
		sessions,
		ownerId,
		clientId,
		revokedAt,
		session: transactionSession,
		canManage
	});
	assert.deepEqual(retried, { ok: true, state: 'absent', revokedSessions: 0 });
	assert.deepEqual(
		docs.map((doc) => doc.thingtime[0]),
		['app-data', 'app-storage']
	);
});

test('an unauthorized manager cannot delete the app or revoke its sessions', async () => {
	let deleted = false;
	let revoked = false;
	const result = await deleteAppLifecycleInSession({
		things: {
			async findOne() {
				return { _id: 'app-row', ownerId: 'someone-else', thingtime: ['app'], crystal: { clientId } };
			},
			async findOneAndDelete() {
				deleted = true;
				return null;
			}
		},
		sessions: {
			async updateMany() {
				revoked = true;
				return { modifiedCount: 1 };
			}
		},
		ownerId,
		clientId,
		revokedAt,
		session: { id: 'transaction-b' },
		canManage: async () => false
	});

	assert.deepEqual(result, { ok: false, state: 'forbidden' });
	assert.equal(deleted, false);
	assert.equal(revoked, false);
});

test('a failed exact app delete aborts before session revocation', async () => {
	let revoked = false;
	await assert.rejects(
		deleteAppLifecycleInSession({
			things: {
				async findOne() {
					return { _id: 'app-row', ownerId, thingtime: ['app'], crystal: { clientId } };
				},
				async findOneAndDelete() {
					return null;
				}
			},
			sessions: {
				async updateMany() {
					revoked = true;
					return { modifiedCount: 1 };
				}
			},
			ownerId,
			clientId,
			revokedAt,
			session: { id: 'transaction-c' },
			canManage: async () => true
		}),
		/changed while it was being deleted/
	);
	assert.equal(revoked, false);
});
