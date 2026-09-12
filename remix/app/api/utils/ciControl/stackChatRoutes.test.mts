import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { beforeEach, mock, test } from 'node:test';
let admin = true;
let allowed = true;
const calls: any[] = [];
mock.module(new URL('../auth/requireAdmin.ts', import.meta.url).href, {
	namedExports: { requireAdmin: async () => (admin ? { user: { id: 'admin' } } : { error: { status: 403, message: 'Forbidden' } }) }
});
mock.module(new URL('../rateLimit/enforce.ts', import.meta.url).href, {
	namedExports: {
		enforceRateLimit: async (...args: any[]) => {
			calls.push(['limit', ...args.slice(1)]);
			return { allowed };
		}
	}
});
mock.module(new URL('./stackChat.ts', import.meta.url).href, {
	namedExports: {
		readStackChat: async (id: string) => {
			calls.push(['read', id]);
			return { messages: [] };
		},
		enqueueStackQuestion: async (...args: any[]) => {
			calls.push(['enqueue', ...args]);
			return { id: 'message', status: 'queued' };
		},
		pollStackChat: async (input: any) => {
			calls.push(['poll', input]);
			return { message: null };
		}
	}
});
// The signature primitive has its own providerRouter tests; here keep other
// dispatch services out of the route-boundary test process.
mock.module(new URL('./providerRouter.ts', import.meta.url).href, {
	namedExports: {
		verifyCiProviderRouteSignature: (raw: string, signature: string, secret: string) =>
			signature === `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`
	}
});
const adminRoute = await import('../../../routes/api/v1/admin/ci/stacks/chat/_chat');
const workerRoute = await import('../../../routes/api/v1/integrations/ci/chat/_chat');
const secret = 'synthetic-chat-test-secret';
const runId = 'feature-stack-run-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const body = { runId, requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', question: 'What is waiting?' };
const request = (value: any, signed = false, tamper = false) => {
	const raw = typeof value === 'string' ? value : JSON.stringify(value);
	return new Request('https://thingtime.test/api/v1/chat', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(signed
				? {
						'X-Thingtime-CI-Signature': `sha256=${createHmac('sha256', secret)
							.update(tamper ? 'other' : raw)
							.digest('hex')}`
				  }
				: {})
		},
		body: raw
	});
};
const privateResponse = (response: Response) => {
	assert.match(response.headers.get('Cache-Control')!, /private.*no-store/);
	assert.equal(response.headers.get('Pragma'), 'no-cache');
};
beforeEach(() => {
	admin = true;
	allowed = true;
	calls.length = 0;
	process.env.THINGTIME_CI_ROUTER_SECRET = secret;
	process.env.THINGTIME_GITHUB_REPOSITORY = 'owner/repo';
});
test('admin gate and fail-closed rate limits bind question writes; unauthorized reads/writes never touch the mailbox', async () => {
	admin = false;
	for (const response of [
		await adminRoute.loader({ request: new Request(`https://thingtime.test/?runId=${runId}`) }),
		await adminRoute.action({ request: request(body) })
	]) {
		assert.equal(response.status, 403);
		privateResponse(response);
	}
	assert.equal(calls.length, 0);
	admin = true;
	const accepted = await adminRoute.action({ request: request(body) });
	assert.equal(accepted.status, 202);
	privateResponse(accepted);
	assert.deepEqual(calls[0].slice(1), ['ci.stack-chat', 'user:admin', { failClosed: true }]);
	assert.deepEqual(calls[1], ['enqueue', body, 'admin']);
	calls.length = 0;
	allowed = false;
	const limited = await adminRoute.action({ request: request(body) });
	assert.equal(limited.status, 429);
	privateResponse(limited);
	assert.equal(
		calls.some((row) => row[0] === 'enqueue'),
		false
	);
});
test('worker ingress rejects tampering, stale/cross-repository requests and oversized bodies before mailbox access', async () => {
	const worker = { repository: 'owner/repo', runId, workflowRunId: 123, runAttempt: 1, at: new Date().toISOString(), available: true };
	for (const [req, status] of [
		[request(worker), 403],
		[request(worker, true, true), 403],
		[request({ ...worker, at: '2020-01-01' }, true), 400],
		[request({ ...worker, repository: 'other/repo' }, true), 400],
		[request('x'.repeat(33 * 1024), true), 413]
	] as const) {
		const response = await workerRoute.action({ request: req });
		assert.equal(response.status, status);
		privateResponse(response);
	}
	assert.equal(calls.length, 0);
	const accepted = await workerRoute.action({ request: request(worker, true) });
	assert.equal(accepted.status, 200);
	privateResponse(accepted);
	assert.equal(calls[0][0], 'poll');
});
