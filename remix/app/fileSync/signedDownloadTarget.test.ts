import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';
import { CLOUD_NATIVE_DOWNLOAD_REQUIREMENTS, fileSyncDownloadRequirements, parseSignedDownloadTarget } from './signedDownloadTarget';
import { createCloudDownloadSource } from './cloudDownloadSource';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/signedDownloadTarget.v1.json', import.meta.url), 'utf8'));
test('signed target parser enforces owner, whole-file fingerprint, exact range, HTTPS and sixty-second lifetime', () => {
 const now = Date.parse('2026-10-21T00:00:00.000Z');
 assert.deepEqual(parseSignedDownloadTarget(fixture.target, fixture.ownerId, fixture.file, 0, 32, now), fixture.target);
 for (const patch of [{ ownerId: 'other' }, { attachmentId: 'other' }, { contentVersion: 'c'.repeat(64) }, { size: 63 }, { offset: 1 }, { length: 33 }, { fingerprint: { ...fixture.target.fingerprint, sha256: 'c'.repeat(64) } }, { url: 'http://insecure.invalid' }, { expiresAt: new Date(now+61000).toISOString() }, { expiresAt: new Date(now).toISOString() }, { headers: { Range: 'bytes=0-63' } }])
  assert.throws(() => parseSignedDownloadTarget({ ...fixture.target, ...patch }, fixture.ownerId, fixture.file, 0, 32, now));
});
test('CPU downloads negotiate1.17 before target reads while upload policies have no unused download requirement', async () => {
 assert.deepEqual(fileSyncDownloadRequirements({ mode: 'backup', resourceLimits: { cpuPercent: 10 } }), {});
 assert.deepEqual(fileSyncDownloadRequirements({ mode: 'download', resourceLimits: { downloadBytesPerSecond: 1 } }), {});
 assert.deepEqual(fileSyncDownloadRequirements({ mode: 'two-way', resourceLimits: { cpuPercent: 10 } }), CLOUD_NATIVE_DOWNLOAD_REQUIREMENTS);
 for (const version of ['', '1.16.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.17.0'), false);
 for (const version of ['1.17.0', '1.18.0']) assert.equal(capabilitySatisfies(version, '1.17.0'), true);
 let targets = 0, supported = true;
 const scope = { ownerId: fixture.ownerId, rootId: 'root', deviceId: 'device', dataPlane: 'home', origin: 'https://sync.test' };
 const source = createCloudDownloadSource({ currentScope: () => scope, origin: () => scope.origin,
 requireCapability: async (_feature, version) => { if (!supported && version === '1.17.0') throw Error('Unsupported target contract'); },
 fetch: async (url, init) => { const request = new URL(String(url)); assert.equal((init!.headers as any)['X-Thingtime-Expected-Actor'], scope.ownerId);
 if (request.pathname === '/api/v1/files') return Response.json({ ok: true, file: fixture.file });
 targets++; assert.equal(request.searchParams.get('target'), '1'); assert.equal(request.searchParams.get('length'), '32');
 return Response.json({ ok: true, target: { ...fixture.target, expiresAt: new Date(Date.now()+59000).toISOString() } }); }
 }, scope, fixture.file);
 const result = await source.downloadTarget!(0, 32); assert.equal(result.ownerId, scope.ownerId); assert.equal(targets, 1);
 supported = false; await assert.rejects(source.downloadTarget!(0, 32), /Unsupported/); assert.equal(targets, 1);
});
