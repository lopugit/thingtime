import assert from 'node:assert/strict';
import test from 'node:test';
import { instructionTransport } from './lopuInstructions.client';
import { bindLocalWorkspace } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';

const scope = { kind: 'account', origin: 'https://prompt-settings.test', ownerId: 'alice', dataPlane: 'custom' } as const;
test('instruction transport requires confirmed identity/capability and fences origin, plane and late replies', async () => {
 const previous = { window: globalThis.window, fetch: globalThis.fetch };
 const navigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
 const events = new EventTarget(), calls: { url: string; init: RequestInit }[] = [];
 let online = true, duringRead: (() => void) | undefined;
 Object.assign(globalThis, { window: { location: { origin: scope.origin }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events) },
  fetch: async (url: string, init: RequestInit) => {
   if (url.includes('capabilities')) return Response.json({ schemaVersion: 1, origin: scope.origin, features: { 'api.settings-lopu-prompt': { version: '1.1.0' } } });
   calls.push({ url, init }); duringRead?.();
   return Response.json({ ok: true, base: { revision: null, basePrompt: 'Public base' }, personal: { revision: 'r1', instructions: [] } });
  }
 });
 Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { get onLine() { return online; } } });
 const bind = (confirmed = true) => { rootIdentity.confirm(rootIdentity.read().generation); bindLocalWorkspace(false, rootIdentity.read().generation, scope, confirmed); };
 try {
  bind(false); await assert.rejects(instructionTransport(scope).read(new AbortController().signal), /offline/); assert.equal(calls.length, 0);
  bind(); online = false; await assert.rejects(instructionTransport(scope).read(new AbortController().signal), /unavailable/); assert.equal(calls.length, 0);
  online = true; await instructionTransport(scope).read(new AbortController().signal);
  assert.equal(calls[0].url, '/api/v1/settings/lopu-prompt'); assert.equal(calls[0].init.credentials, 'same-origin'); assert.equal(calls[0].init.redirect, 'error'); assert.equal(calls[0].init.cache, 'no-store');
  assert.equal((calls[0].init.headers as any)['X-Thingtime-Expected-Actor'], 'alice'); assert.equal((calls[0].init.headers as any)['X-Thingtime-Expected-Data-Plane'], 'custom');
  duringRead = () => bindLocalWorkspace(false, rootIdentity.read().generation, { ...scope, ownerId: 'bob' });
  await assert.rejects(instructionTransport(scope).read(new AbortController().signal), /workspace changed/i); assert.equal(calls.at(-1)!.init.signal?.aborted, true);
  bind(); duringRead = () => bindLocalWorkspace(false, rootIdentity.read().generation, { ...scope, dataPlane: 'other' });
  await assert.rejects(instructionTransport(scope).read(new AbortController().signal), /workspace changed/i);
  bindLocalWorkspace(true, rootIdentity.read().generation); const count = calls.length;
  await assert.rejects(instructionTransport(scope).read(new AbortController().signal), /workspace changed/i); assert.equal(calls.length, count);
  assert.equal(capabilitySatisfies('1.0.0', '1.1.0'), false); assert.equal(capabilitySatisfies('1.2.0', '1.1.0'), true); assert.equal(capabilitySatisfies('2.0.0', '1.1.0'), false);
 } finally {
  bindLocalWorkspace(true, rootIdentity.read().generation); Object.assign(globalThis, previous);
  if (navigator) Object.defineProperty(globalThis, 'navigator', navigator); else delete (globalThis as any).navigator;
 }
});
