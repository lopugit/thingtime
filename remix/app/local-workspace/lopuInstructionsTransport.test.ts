import assert from 'node:assert/strict';
import test from 'node:test';
import { instructionTransport } from './lopuInstructions.client';
import { bindLocalWorkspace } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';
import { serializeInstructionWrite } from './lopuInstructions';
import { readJsonBody } from '../api/http';

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
  bind(); online = false; await assert.rejects(instructionTransport(scope).read(new AbortController().signal), { code: 'ACCOUNT_OFFLINE' }); assert.equal(calls.length, 0);
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

test('instruction writes measure the exact serialized UTF-8 body and never POST an oversized request', async () => {
 const previous = { window: globalThis.window, fetch: globalThis.fetch };
 const navigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
 const writeScope = scope, calls: string[] = [];
 Object.assign(globalThis, { window: { location: { origin: writeScope.origin }, dispatchEvent: () => true }, fetch: async (url: string, init: RequestInit) => {
  if (url.includes('capabilities')) return Response.json({ schemaVersion: 1, origin: writeScope.origin, features: { 'api.settings-lopu-prompt': { version: '1.1.0' } } });
  assert.equal(init.method, 'POST'); calls.push(String(init.body));
  const body = JSON.parse(String(init.body));
  return Response.json({ ok: true, personal: { revision: 'next', instructions: body.instructions } });
 } });
 Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
 const settings = (text: string) => ({ revision: 'expected-revision', instructions: [{ id: 'one', text, enabled: true }] });
 const bytes = (text: string) => new TextEncoder().encode(JSON.stringify({ scope: 'personal', ...settings(text) })).byteLength;
 try {
  rootIdentity.confirm(rootIdentity.read().generation); bindLocalWorkspace(false, rootIdentity.read().generation, writeScope, true);
  const transport = instructionTransport(writeScope), limit = 96 * 1024;
  for (const prefix of ['A', '🌟漢é"\\\n']) {
   const text = prefix + 'x'.repeat(limit - bytes(prefix));
   assert.equal(bytes(text), limit); assert.equal(new TextEncoder().encode(serializeInstructionWrite(settings(text))).byteLength, limit);
   assert.deepEqual(await readJsonBody(new Request(writeScope.origin, { method: 'POST', body: serializeInstructionWrite(settings(text)) }), limit), { scope: 'personal', ...settings(text) });
   await assert.rejects(readJsonBody(new Request(writeScope.origin, { method: 'POST', body: JSON.stringify({ scope: 'personal', ...settings(text + 'x') }) }), limit), (error: unknown) => error instanceof Response && error.status === 413);
   await transport.write(settings(text), new AbortController().signal);
   const before = calls.length;
   await assert.rejects(transport.write(settings(text + 'x'), new AbortController().signal), { code: 'INSTRUCTIONS_REQUEST_TOO_LARGE', status: 413 });
   assert.equal(calls.length, before, 'oversized content never reaches POST');
  }
  assert.equal(calls.length, 2); assert.ok(calls.every(body => new TextEncoder().encode(body).byteLength === limit));
 } finally {
  bindLocalWorkspace(true, rootIdentity.read().generation); Object.assign(globalThis, previous);
  if (navigator) Object.defineProperty(globalThis, 'navigator', navigator); else delete (globalThis as any).navigator;
 }
});

test('resumable transport negotiates v2, enforces receipt identity, and propagates rate-limit backoff', async () => {
 const previous = { window: globalThis.window, fetch: globalThis.fetch }, navigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
 let version = '1.1.0', wrongOwner = false, throttle = false, terminalId: string | undefined;
 const commands: any[] = [];
 Object.assign(globalThis, { window: { location: { origin: scope.origin }, dispatchEvent: () => true }, fetch: async (url: string, init: RequestInit) => {
  if (url.includes('capabilities')) return Response.json({ schemaVersion: 1, origin: scope.origin, features: { 'api.settings-lopu-prompt': { version } } });
  const command = JSON.parse(String(init.body)).command; commands.push(command);
  if (terminalId) return Response.json({ ok: false, code: 'INSTRUCTION_TRANSFER_ABORTED', attemptId: terminalId }, { status: 409 });
  if (throttle) return Response.json({ ok: false }, { status: 429, headers: { 'Retry-After': '120' } });
  return Response.json({ ok: true, ownerId: wrongOwner ? 'bob' : scope.ownerId, dataPlane: scope.dataPlane, storagePlane: 'home', base: { revision: null, basePrompt: 'Public base' }, personal: { revision: 'remote', instructions: [] } });
 } });
 Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
 try {
  rootIdentity.confirm(rootIdentity.read().generation); bindLocalWorkspace(false, rootIdentity.read().generation, scope, true);
  const transport = instructionTransport(scope), signal = new AbortController().signal;
  await assert.rejects(transport.writeResumable!({ revision: null, instructions: [{ id: 'large', text: 'x'.repeat(100_000), enabled: true }] }, { id: 'stable', nextPart: 0 }, signal, async () => {}), { code: 'INSTRUCTIONS_RESUMABLE_UNAVAILABLE' });
  assert.equal(commands.length, 0);
  version = '2.0.0'; await transport.read(signal); assert.equal(commands.at(-1).action, 'snapshot');
  wrongOwner = true; await assert.rejects(transport.read(signal), { code: 'INVALID_SETTINGS_RECEIPT' });
  wrongOwner = false; throttle = true; await assert.rejects(transport.read(signal), { status: 429, retryAfterMs: 120_000 });
  throttle = false; terminalId = 'frozen-transfer';
  const value = { revision: null, instructions: [{ id: 'one', text: 'Pending', enabled: true }] };
  await assert.rejects(transport.writeResumable!(value, { id: 'frozen-transfer', nextPart: 0 }, signal, async () => {}), { code: 'INSTRUCTION_TRANSFER_ABORTED', attemptId: 'frozen-transfer' });
  terminalId = 'another-transfer';
  await assert.rejects(transport.writeResumable!(value, { id: 'frozen-transfer', nextPart: 0 }, signal, async () => {}), { code: 'INSTRUCTIONS_SYNC_REFUSED' });
 } finally {
  bindLocalWorkspace(true, rootIdentity.read().generation); Object.assign(globalThis, previous);
  if (navigator) Object.defineProperty(globalThis, 'navigator', navigator); else delete (globalThis as any).navigator;
 }
});
