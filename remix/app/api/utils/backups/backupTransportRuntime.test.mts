import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
mock.module('../auth/getCurrentUser', {
	namedExports: {
		getCurrentUser: async () => ({ id: 'owner', accountKind: 'user', temporary: false, isCharacter: false }),
		isFullAccountSessionPurpose: () => true
	}
});
const { createBackupEngineTransport } = await import('./backupTransport.server');
test('outer runtime fetch races a stalled guard before dispatch and preserves request abort', async () => {
	let calls = 0,
		resolve!: () => void;
	const gate = new Promise<void>((r) => {
		resolve = r;
	});
	const context: any = {
		request: new Request('https://transport.test/api/v1/backups'),
		guard: async () => {
			calls++;
			if (calls > 1) await gate;
		},
		withRequest: async () => {
			throw Error('Must not bind or dispatch');
		}
	};
	const runtime = await createBackupEngineTransport(context);
	const abort = new AbortController();
	const pending = runtime.fetch(new Request('https://transport.test/api/v1/auth/me', { signal: abort.signal }));
	setTimeout(() => abort.abort(new DOMException('fixture aborted', 'AbortError')), 20);
	await assert.rejects(pending, { name: 'AbortError' });
	resolve();
	await new Promise((r) => setImmediate(r));
	assert.equal(calls, 2);
});
