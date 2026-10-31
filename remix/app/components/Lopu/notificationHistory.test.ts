import assert from 'node:assert/strict';
import { test } from 'node:test';
import { saveLopuHistory } from './notificationHistory.client';

test('Lopu history negotiates, retries idempotently, and never crosses accounts', async () => {
  const priorWindow = globalThis.window;
  const priorFetch = globalThis.fetch;
  const bodies: any[] = [];
  const events: string[] = [];
  let status = 503;
  let attempts = 0;
  let manifestReads = 0;
  try {
    globalThis.window = { location: { origin: 'https://example.test' },
      dispatchEvent: (event: Event) => { events.push(event.type); return true; },
      setTimeout: (callback: () => void) => { queueMicrotask(callback); return 1; }
    } as any;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('.well-known')) {
        manifestReads++;
        return Response.json({ schemaVersion: 1, origin: 'https://example.test', features: { 'api.notifications-record': { version: '1.0.0' } } });
      }
      bodies.push(JSON.parse(String(init?.body)));
      attempts++;
      return Response.json({}, { status: attempts === 1 ? status : 200 });
    };
    await saveLopuHistory(undefined, { title: 'Anonymous message' });
    assert.equal(bodies.length, 0);
    await saveLopuHistory('alice', { title: 'Saved', description: 'Details' });
    assert.equal(manifestReads, 1);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].eventId, bodies[1].eventId);
    assert.equal(bodies[1].userId, 'alice');
    assert.deepEqual(events, ['thingtime:notification-recorded']);
    await saveLopuHistory('alice', { title: 'Saved', description: 'Details' });
    assert.notEqual(bodies[1].eventId, bodies[2].eventId);
    for (const description of ['🥰'.repeat(24000), '\u0001'.repeat(48000)]) {
      await saveLopuHistory('alice', { title: 'Long message', description });
      const saved = bodies.at(-1);
      assert.ok(new TextEncoder().encode(JSON.stringify(saved)).byteLength <= 60000);
      assert.match(saved.description, /truncated/);
    }
    status = 401;
    attempts = 0;
    const before = bodies.length;
    await saveLopuHistory('alice', { title: 'Account changed' });
    assert.equal(bodies.length, before + 1);
  } finally {
    globalThis.window = priorWindow;
    globalThis.fetch = priorFetch;
  }
});
