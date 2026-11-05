import assert from 'node:assert/strict';
import test from 'node:test';
import { JSON_BODY_WITHOUT_APPLICATION_LIMIT as unlimited, readJsonBody } from './http';

for (const [name, oldBudget] of [['post/data', 768 * 1024], ['comment', 256 * 1024], ['message/edit', 64 * 1024], ['attachment metadata', 16 * 1024], ['file metadata', 32 * 1024]] as const) {
  test(`${name} JSON preserves content beyond its previous byte budget`, async () => {
    const text = '雪'.repeat(Math.floor(oldBudget / 3) + 32);
    const source = JSON.stringify({ text });
    const bytes = new TextEncoder().encode(source);
    let position = 0;
    const stream = new ReadableStream({ pull(controller) {
      if (position === bytes.length) return controller.close();
      const next = Math.min(position + 8191, bytes.length);
      controller.enqueue(bytes.subarray(position, next)); position = next;
    } });
    const request = new Request('https://thingtime.test', { method: 'POST', body: stream, duplex: 'half', headers: { 'Content-Length': String(bytes.length) } } as RequestInit);
    assert.deepEqual(await readJsonBody(request, unlimited), { text });
  });
}

test('control-message numeric budgets still cancel a dishonest streamed body', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(33)); }, cancel() { cancelled = true; } });
  const request = new Request('https://thingtime.test', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
  await assert.rejects(readJsonBody(request, 32), (error: any) => error instanceof Response && error.status === 413);
  assert.equal(cancelled, true);
});

test('abort cancels an in-flight no-ceiling read; malformed JSON remains empty', async () => {
  const controller = new AbortController(); let cancelled = false;
  const request = new Request('https://thingtime.test', { method: 'POST', signal: controller.signal, body: new ReadableStream({ cancel() { cancelled = true; } }), duplex: 'half' } as RequestInit);
  const reading = readJsonBody(request, unlimited);
  controller.abort(); await assert.rejects(reading, { name: 'AbortError' }); assert.equal(cancelled, true);
  assert.deepEqual(await readJsonBody(new Request('https://thingtime.test', { method: 'POST', body: '{bad' }), unlimited), {});
});

test('already-aborted requests cancel their unread stream', async () => {
  const controller = new AbortController(); controller.abort(); let cancelled = false;
  const request = new Request('https://thingtime.test', { method: 'POST', signal: controller.signal, body: new ReadableStream({ cancel() { cancelled = true; } }), duplex: 'half' } as RequestInit);
  await assert.rejects(readJsonBody(request, unlimited), { name: 'AbortError' });
  assert.equal(cancelled, true);
});
