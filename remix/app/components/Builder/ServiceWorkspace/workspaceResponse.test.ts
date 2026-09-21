import assert from 'node:assert/strict';
import test from 'node:test';
import { readWorkspaceResponse } from './workspaceResponse';
test('gateway HTML produces a useful retry error without exposing its body', async () => {
	await assert.rejects(readWorkspaceResponse(new Response('<html>private gateway diagnostics</html>', { status: 502 })), (error) => {
		assert.equal((error as any).status, 502);
		assert.match((error as Error).message, /temporarily unavailable.*HTTP 502/);
		assert.doesNotMatch((error as Error).message, /private|Unexpected token/);
		return true;
	});
});
test('workspace JSON retains actionable server errors and successful payloads', async () => {
	await assert.rejects(readWorkspaceResponse(Response.json({ ok: false, error: 'Enable Places API (New).' }, { status: 409 })), /Enable Places/);
	assert.deepEqual(await readWorkspaceResponse(Response.json({ ok: true, suggestions: [] })), { ok: true, suggestions: [] });
});
