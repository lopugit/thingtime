import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatGPTPlanHandlers } from './_chatgpt-plan';

const user = { id: 'owner', temporary: false, accountKind: 'user' };
const request = (action = 'begin', headers: Record<string, string> = {}) => new Request('https://runtime.test/api/v1/ai/chatgpt-plan', {
	method: 'POST', headers: { Origin: 'https://runtime.test', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ action })
});
const setup = () => {
	let current: typeof user | null = user;
	let called = 0;
	let callback: (() => Promise<boolean>) | null = null;
	const dependencies: any = {
		getCurrentUser: async () => current,
		scope: async () => ({ ownerId: 'owner', origin: 'https://runtime.test', sessionId: 'session' }),
		enforceRateLimit: async () => ({ allowed: true }),
		getRuntime: () => ({
			begin: async (_scope: unknown, revalidate: () => Promise<boolean>) => { called++; callback = revalidate; return { attemptId: 'pending', authorizationUrl: 'https://auth.openai.com/api/accounts/authorize' }; },
			status: async () => ({ accounts: [], attempts: [] })
		})
	};
	return { dependencies, handlers: createChatGPTPlanHandlers(dependencies), setUser: (next: typeof user | null) => { current = next; }, count: () => called, revalidate: () => callback!() };
};

test('cross-origin and non-JSON mutations cannot start OAuth', async () => {
	const fixture = setup();
	assert.equal((await fixture.handlers.action({ request: request('begin', { Origin: 'https://attacker.test' }) })).status, 403);
	assert.equal((await fixture.handlers.action({ request: request('begin', { 'Content-Type': 'text/plain' }) })).status, 415);
	assert.equal(fixture.count(), 0);
});

test('sign-in callback revalidates the original Thingtime account before storage', async () => {
	const fixture = setup();
	assert.equal((await fixture.handlers.action({ request: request() })).status, 200);
	assert.equal(await fixture.revalidate(), true);
	fixture.setUser(null);
	assert.equal(await fixture.revalidate(), false);
	fixture.setUser({ ...user, id: 'different-owner' });
	assert.equal(await fixture.revalidate(), false);
});

test('unconfigured hosted runtime cannot begin or expose credentials', async () => {
	const fixture = setup(); fixture.dependencies.getRuntime = () => null;
	const status = await fixture.handlers.loader({ request: new Request('https://runtime.test/api/v1/ai/chatgpt-plan') });
	assert.equal(status.headers.get('Cache-Control'), 'private, no-store');
	assert.equal((await status.json()).available, false);
	assert.equal((await fixture.handlers.action({ request: request() })).status, 503);
	assert.equal(fixture.count(), 0);
});

test('unauthenticated and service callers cannot use personal plan storage', async () => {
	const fixture = setup(); fixture.setUser(null);
	assert.equal((await fixture.handlers.action({ request: request() })).status, 401);
	fixture.setUser({ ...user, accountKind: 'service' });
	assert.equal((await fixture.handlers.action({ request: request() })).status, 403);
	assert.equal(fixture.count(), 0);
});

test('unexpected storage errors cannot leak paths or credential bytes', async () => {
	const fixture = setup(); fixture.dependencies.getRuntime = () => { throw new Error('secret-token at /private/account.json'); };
	const response = await fixture.handlers.action({ request: request() });
	const body = await response.text();
	assert.equal(response.status, 400); assert.doesNotMatch(body, /secret-token|private\/account/);
});


test('a stale account UI cannot mutate the newly active account', async () => {
  const fixture = setup();
  const response = await fixture.handlers.action({ request: request('begin', { 'X-Thingtime-Expected-User': 'previous-owner' }) });
  assert.equal(response.status, 409);
  assert.equal(fixture.count(), 0);
});

test('portable connection actions retain owner scope and live session validation', async () => {
  const fixture = setup();
  const calls: { name: string; scope: any; args: unknown[]; revalidate: () => Promise<boolean> }[] = [];
  const runtime = Object.fromEntries(['prepareImport', 'moveAccount', 'importAccount'].map(name => [name, async (scope: any, ...args: any[]) => {
    const revalidate = args.pop(); calls.push({ name, scope, args, revalidate }); return { id: 'safe-result' };
  }]));
  fixture.dependencies.getRuntime = () => runtime;
  for (const [action, fields, name] of [
    ['prepare-import', {}, 'prepareImport'],
    ['move-account', { id: 'chatgpt-plan-synthetic', recipient: { id: 'recipient' } }, 'moveAccount'],
    ['import-account', { bundle: { ciphertext: 'synthetic-ciphertext' } }, 'importAccount']
  ] as const) {
    const req = new Request('https://runtime.test/api/v1/ai/chatgpt-plan', {
      method: 'POST', headers: { Origin: 'https://runtime.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...fields })
    });
    const response = await fixture.handlers.action({ request: req });
    assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control')!, /no-store/);
    assert.equal(calls.at(-1)?.name, name); assert.equal(calls.at(-1)?.scope.ownerId, 'owner');
    assert.equal(await calls.at(-1)!.revalidate(), true);
  }
  fixture.setUser(null);
  for (const call of calls) assert.equal(await call.revalidate(), false);
});

test('transfer requests reject oversized packages before invoking runtime storage', async () => {
  const fixture = setup();
  const req = new Request('https://runtime.test/api/v1/ai/chatgpt-plan', {
    method: 'POST', headers: { Origin: 'https://runtime.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'import-account', bundle: { ciphertext: 'x'.repeat(129 * 1024) } })
  });
  const response = await fixture.handlers.action({ request: req });
  assert.ok(response.status >= 400); assert.equal(fixture.count(), 0);
});
