import test from 'node:test';
import assert from 'node:assert/strict';
import { hasNativeMailSync, nativeMailRequest } from './native';
const account = { sync: { local: true, cloud: false, transport: 'native' } } as any;
test('native feature negotiation fails closed without invoking another transport', async () => {
	const previous = (globalThis as any).window;
	try {
		let calls = 0;
		(globalThis as any).window = {
			thingtimeDesktop: {
				mailSyncVersion: '2.0.0',
				syncMail: () => {
					calls++;
				},
				cancelMailSync: async () => {}
			}
		};
		assert.equal(hasNativeMailSync(), false);
		await assert.rejects(nativeMailRequest(account, {}, new AbortController().signal), /does not support/);
		assert.equal(calls, 0);
	} finally {
		(globalThis as any).window = previous;
	}
});
test('native requests cancel the exact operation and suppress a late response', async () => {
	const previous = (globalThis as any).window;
	try {
		let sent: any, finish: any;
		const cancellations: string[] = [];
		(globalThis as any).window = {
			thingtimeDesktop: {
				mailSyncVersion: '1.0.0',
				syncMail: (request: unknown) => {
					sent = request;
					return new Promise((resolve) => {
						finish = resolve;
					});
				},
				cancelMailSync: async ({ requestId }: any) => {
					cancellations.push(requestId);
				}
			}
		};
		const controller = new AbortController();
		const pending = nativeMailRequest(account, { protocol: 'imap' }, controller.signal);
		controller.abort();
		await assert.rejects(pending, /cancelled/);
		finish({ ok: true, version: 1, folders: [], messages: [], nextCursor: null });
		assert.deepEqual(cancellations, [sent.requestId]);
		assert.equal(sent.protocol, 'imap');
	} finally {
		(globalThis as any).window = previous;
	}
});

test('native IPC exception details never enter the user-facing error', async () => {
	const previous = (globalThis as any).window;
	try {
		(globalThis as any).window = {
			thingtimeDesktop: {
				mailSyncVersion: '1.0.0',
				cancelMailSync: async () => {},
				syncMail: async () => {
					throw new Error('Error invoking remote method thingtime-desktop:mail-sync: fixture-private');
				}
			}
		};
		await assert.rejects(
			nativeMailRequest(account, {}, new AbortController().signal),
			(error) => error instanceof Error && error.message === 'Device mail sync failed. Check the server and app password, then retry.'
		);
	} finally {
		(globalThis as any).window = previous;
	}
});
