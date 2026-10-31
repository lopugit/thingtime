import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createStackCompletionHandler } from '../../../routes/api/v1/integrations/ci/stack-completion/_stack-completion';
import { AiWaterfallFailure } from '../ai/providerWaterfall';

const runId = 'feature-stack-run-11111111-1111-4111-8111-111111111111';
const config = { version: 1, entries: [{ endpointId: 'vault:mine', modelId: 'vendor/model', effort: null, speed: 'normal' }] };
const dispatch = {
	shareId: 'dispatch',
	parentId: 'stack',
	crystal: { actorId: 'owner', inputs: { feature_stack_plan_b64: Buffer.from(JSON.stringify({ runId, modelWaterfall: config })).toString('base64') } }
};
const stack = { crystal: { status: 'running', lastDispatchId: 'dispatch' } };
const workflow = {
	status: 'in_progress',
	run_attempt: 1,
	head_branch: 'develop',
	path: '.github/workflows/resolve-pr-conflicts.yml',
	display_title: `Merge ${runId}`
};
function fixture(overrides: Record<string, unknown> = {}) {
	const calls: unknown[] = [];
	const handler = createStackCompletionHandler({
		secret: () => 'test-key',
		collection: async () => ({ findOne: async (query: any) => (query.thingtime === 'ci-dispatch' ? dispatch : stack) }),
		run: async () => workflow,
		claim: async () => true,
		complete: async (...args: any[]) => {
			calls.push(args);
			return { value: 'resolved' };
		},
		...overrides
	} as any);
	const invoke = async (patch = {}, signature = true) => {
		const body = JSON.stringify({
			repository: 'lopugit/thingtime',
			workflowRef: 'lopugit/thingtime/.github/workflows/resolve-pr-conflicts.yml@refs/heads/develop',
			runId: '123',
			runAttempt: '1',
			nonce: 'a'.repeat(32),
			requestedAt: new Date().toISOString(),
			featureStackRunId: runId,
			index: 0,
			prompt: 'conflicts',
			...patch
		});
		return handler({
			request: new Request('https://thingtime.com/api/v1/integrations/ci/stack-completion', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-thingtime-ci-signature': signature ? `sha256=${createHmac('sha256', 'test-key').update(body).digest('hex')}` : 'invalid'
				},
				body
			})
		});
	};
	return { calls, invoke };
}
test('gateway uses immutable run selection and owner, never caller overrides', async () => {
	const { calls, invoke } = fixture();
	const response = await invoke({ ownerId: 'attacker', modelWaterfall: { entries: [] } });
	assert.equal(response.status, 200);
	assert.equal((calls[0] as any[])[0], 'owner');
	assert.deepEqual((calls[0] as any[])[1], config);
});
test('gateway rejects signatures, replay, stopped stacks, unrelated runs and invalid position before AI', async () => {
	const unsigned = fixture();
	assert.equal((await unsigned.invoke({}, false)).status, 403);
	assert.equal(unsigned.calls.length, 0);
	for (const override of [
		{ claim: async () => false },
		{ run: async () => ({ ...workflow, display_title: 'unrelated' }) },
		{ run: async () => ({ ...workflow, status: 'completed' }) },
		{
			collection: async () => ({
				findOne: async (query: any) => (query.thingtime === 'ci-dispatch' ? dispatch : { ...stack, crystal: { ...stack.crystal, status: 'stopped' } })
			})
		}
	]) {
		const subject = fixture(override);
		assert.ok([403, 409].includes((await subject.invoke()).status));
		assert.equal(subject.calls.length, 0);
	}
	const invalid = fixture();
	assert.equal((await invalid.invoke({ index: 9 })).status, 400);
	assert.equal(invalid.calls.length, 0);
});
test('only classified availability errors let the runner advance', async () => {
	const unavailable = fixture({
		complete: async () => {
			throw new AiWaterfallFailure([]);
		}
	});
	assert.deepEqual(await (await unavailable.invoke()).json(), { ok: false, unavailable: true });
	const foreign = fixture({
		complete: async () => {
			throw new TypeError('foreign');
		}
	});
	const response = await foreign.invoke();
	assert.equal(response.status, 403);
	assert.equal((await response.json()).unavailable, undefined);
});
