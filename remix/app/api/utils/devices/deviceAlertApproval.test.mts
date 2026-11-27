import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
let approval: any,
	command: any,
	inTransaction = false;
const dispatches: any[] = [];
const set = (row: any, update: any) => {
	for (const [k, v] of Object.entries(update.$set || {})) {
		if (k.startsWith('crystal.')) row.crystal[k.slice(8)] = v;
		else row[k] = v;
	}
};
const things = {
	findOne: async (q: any) =>
		q.thingtime === 'device-approval'
			? approval
			: q.thingtime === 'device-command' && (!q['crystal.deliveryChannel'] || command.crystal.deliveryChannel === q['crystal.deliveryChannel'])
			? command
			: null,
	findOneAndUpdate: async (_q: any, u: any) => {
		set(approval, u);
		return approval;
	},
	updateOne: async (_q: any, u: any) => {
		set(command, u);
		return { modifiedCount: 1 };
	}
};
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, {
	namedExports: {
		getHomeThingsCollection: async () => things,
		withHomeMongoTransaction: async (work: any) => {
			inTransaction = true;
			try {
				return await work({});
			} finally {
				inTransaction = false;
			}
		}
	}
});
mock.module(new URL('./devices.ts', import.meta.url).href, {
	namedExports: {
		DEVICE_CONNECTOR_FRESHNESS_MS: 120000,
		appendDeviceEvent: async () => {},
		deviceConnectorIsFresh: () => true,
		deviceExistsForOwner: async () => ({}),
		newDeviceThing: () => ({})
	}
});
mock.module(new URL('./deviceAlertMedia.ts', import.meta.url).href, {
	namedExports: { resolveDeviceMedia: async (_o: any, _d: any, _k: any, input: any) => ({ ok: true, input }) }
});
mock.module(new URL('../notifications/notifications.ts', import.meta.url).href, {
	namedExports: { notificationDoc: () => ({}), SYSTEM_NOTIFICATION_ACTOR: { id: 'system' } }
});
mock.module(new URL('./deviceAlerts.ts', import.meta.url).href, {
	namedExports: {
		dispatchDeviceAlertPush: async (...args: any[]) => {
			assert.equal(inTransaction, false, 'network dispatch cannot happen in a retried transaction');
			assert.equal(command.crystal.status, 'queued');
			dispatches.push(args);
		}
	}
});
const { decideDeviceApproval } = await import('./deviceCommands');
beforeEach(() => {
	dispatches.length = 0;
	approval = {
		createdAt: new Date(),
		updatedAt: new Date(),
		_id: 'approval',
		shareId: 'approval',
		ownerId: 'owner',
		targetId: 'device',
		crystal: { status: 'pending', kind: 'command-dispatch', commandId: 'command', expiresAt: new Date(Date.now() + 100000) }
	};
	command = {
		_id: 'command',
		shareId: 'command',
		ownerId: 'owner',
		targetId: 'device',
		crystal: { kind: 'notification.show', status: 'needs-approval', requiresApproval: true, approvalState: 'pending', deliveryChannel: 'apns' }
	};
});
test('normal dispatch approval resumes APNs only after durable approval/queue transition commits', async () => {
	const result = await decideDeviceApproval('owner', { approvalId: 'approval', decision: 'approved' });
	assert.equal(result.ok, true);
	assert.equal(command.crystal.approvalState, 'approved');
	assert.deepEqual(dispatches, [['owner', 'device', 'command']]);
	await decideDeviceApproval('owner', { approvalId: 'approval', decision: 'approved' });
	assert.equal(dispatches.length, 2, 'idempotent approval recovery reuses the idempotent dispatcher');
});
test('denial and ordinary native-queue approvals never invoke APNs', async () => {
	await decideDeviceApproval('owner', { approvalId: 'approval', decision: 'denied' });
	assert.equal(dispatches.length, 0);
	assert.equal(command.crystal.status, 'cancelled');
	approval.crystal.status = 'pending';
	command.crystal.status = 'needs-approval';
	command.crystal.deliveryChannel = 'node';
	await decideDeviceApproval('owner', { approvalId: 'approval', decision: 'approved' });
	assert.equal(dispatches.length, 0);
});
