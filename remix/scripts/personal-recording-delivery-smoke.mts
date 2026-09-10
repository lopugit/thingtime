// Opt-in real HTTP delivery test. No database access or inference/provider calls.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { capabilitySatisfies } from '../app/api/utils/capabilities/capabilityContract';
import { pairPersonalRecordingDevice, type PersonalPairingState } from './personal-recording-pair';
import { createPersonalRecordingWorker } from './personal-recording-worker';
import { deliverySmokeOptions, syntheticRecordingWav } from './personal-recording-delivery-fixture';

const requirements = {
	'api.login': '1.1.0', 'api.auth-logout': '1.1.0', 'api.things': '1.9.1',
	'api.lopu-recordings': '1.4.0', 'api.lopu-recordings-personal': '1.0.1',
	'api.devices-pairing': '1.1.0', 'api.devices-pairing-claim': '1.0.0',
	'api.watch-pairing': '1.2.0', 'api.watch-things': '1.1.0',
	'api.attachment-uploads': '1.2.0', 'api.attachment-upload-parts': '1.1.0',
	'api.attachment-upload-complete': '1.2.0', 'api.attachment-upload-abort': '1.1.0'
};

export const runDeliverySmoke = async (options: ReturnType<typeof deliverySmokeOptions>) => {
	deliverySmokeOptions(options.origin, options.username, options.password);
	let cookie = '', phase = 'manifest', uploadId = '', postId = '';
	let ownsSettings = false, passed = false, cleanupFailed = false, postCreated = false;
	const request = async (path: string, body?: unknown, token?: string, expected: number | number[] = 200, anonymous = false, method?: string) => {
		const response = await fetch(new URL(path, options.origin), {
			method: method || (body === undefined ? 'GET' : 'POST'), redirect: 'error', signal: AbortSignal.timeout(30000),
			headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
				...(token ? { Authorization: `Bearer ${token}` } : !anonymous && cookie ? { Cookie: cookie } : {}) },
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		});
		if (!(Array.isArray(expected) ? expected : [expected]).includes(response.status)) { phase += ` (HTTP ${response.status})`; await response.body?.cancel(); throw new Error('Unexpected status'); }
		if (path === '/api/v1/login') cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
		return response.json();
	};
	const recording = (body?: unknown, token?: string, expected = 200) => request('/api/v1/lopu/recordings' + (token ? '/personal' : ''), body, token, expected);
	try {
		const manifest = await request('/.well-known/thingtime-capabilities.json');
		assert.equal(manifest.origin, options.origin);
		for (const [id, version] of Object.entries(requirements)) assert.ok(capabilitySatisfies(manifest.features?.[id]?.version || '', version));
		phase = 'disposable account login';
		const login = await request('/api/v1/login', { username: options.username, password: options.password });
		assert.equal(login.ok, true); assert.ok(cookie); assert.equal(login.user?.username, options.username);
		phase = 'require unused disabled recording account';
		const initial = await recording();
		assert.equal(initial.settings.enabled, false); assert.equal(initial.settings.runtimeDeviceId, null);
		assert.equal(initial.jobs.length, 0); assert.equal(initial.todos.length, 0);
		const audio = syntheticRecordingWav();
		phase = 'approved upload reservation';
		const upload = await request('/api/v1/attachments/uploads', {
			requestId: randomUUID(), filename: 'synthetic-delivery.wav', contentType: 'audio/wav', sizeBytes: audio.length, purpose: 'post'
		});
		uploadId = upload.upload.id; assert.equal(upload.upload.partCount, 1);
		phase = 'synthetic S3 upload';
		const checksum = createHash('sha256').update(audio).digest('base64');
		const signed = await request('/api/v1/attachments/uploads/parts', { uploadId, parts: [{ partNumber: 1, checksumSha256: checksum }] });
		const part = signed.parts[0], url = new URL(part.url);
		assert.equal(url.protocol, 'https:'); assert.ok(url.hostname.endsWith('.amazonaws.com'));
		assert.equal(part.headers['x-amz-checksum-sha256'], checksum);
		const put = await fetch(url, { method: 'PUT', body: audio, headers: { 'x-amz-checksum-sha256': checksum }, redirect: 'error', signal: AbortSignal.timeout(30000) });
		assert.ok(put.ok); await put.body?.cancel();
		phase = 'attachment finalization';
		const complete = await request('/api/v1/attachments/uploads/complete', { uploadId });
		assert.equal(complete.attachment.mediaKind, 'audio');
		phase = 'synthetic Watch pairing';
		const { pairing } = await request('/api/v1/watch/pairing', { op: 'start', codeFormat: 'numeric-4', device: { name: 'Recording delivery QA Watch', platform: 'watchos', appVersion: 'test' } }, undefined, 201);
		assert.match(pairing.userCode, /^\d{4}$/);
		await request('/api/v1/watch/pairing', { op: 'approve', pairingId: pairing.pairingId, userCode: pairing.userCode });
		const watchToken = `ttnode_${randomBytes(32).toString('base64url')}`;
		await request('/api/v1/watch/pairing', { op: 'claim', pairingId: pairing.pairingId, deviceCode: pairing.deviceCode, credential: watchToken });
		phase = 'private Watch post binding';
		postId = `watch-upload-delivery-qa-${randomUUID()}`;
		await request('/api/v1/watch/things', { shareId: postId, attachmentIds: [complete.attachment.id], filenames: ['synthetic-delivery.wav'] }, watchToken, 201);
		postCreated = true;
		const before = (await request(`/api/v1/things?id=${postId}`)).thing;
		phase = 'synthetic personal processor pairing';
		const challenge = await request('/api/v1/devices/pairing', {});
		let state: PersonalPairingState | null = null;
		const store = { read: async () => structuredClone(state), write: async (next: PersonalPairingState) => { state = structuredClone(next); } };
		const paired = await pairPersonalRecordingDevice({ origin: options.origin, pairingSecret: challenge.pairing.pairingSecret, store });
		const token = (await store.read())!.credential;
		phase = 'personal-only opt in'; ownsSettings = true;
		await recording({ op: 'settings', settings: { enabled: true, runtimeDeviceId: paired.deviceId, createNotes: true, createTodos: true, dailyReminders: false } });
		await recording({ op: 'queue', postId });
		let transcriptions = 0, analyses = 0, dropped = false;
		let receipt: any;
		let completionStatuses: number[] = [];
		const transcript = 'Water the garden tomorrow. My notebook is blue.';
		const analysis = JSON.stringify({ items: [
			{ kind: 'todo', title: 'Water the garden', description: 'Synthetic delivery test', evidence: 'Water the garden tomorrow.' },
			{ kind: 'note', title: 'Blue notebook', description: 'Synthetic delivery test', evidence: 'My notebook is blue.' }
		] });
		const runtime = {
			transcribe: async ({ bytes }: { bytes: Uint8Array }) => { transcriptions++; assert.deepEqual(Buffer.from(bytes), audio); return transcript; },
			complete: async ({ prompt }: { prompt: string }) => { analyses++; assert.equal(prompt, transcript); return analysis; }
		};
		const lossyFetch: typeof fetch = async (url, init) => {
			if (init?.body && JSON.parse(String(init.body)).op === 'complete' && !dropped) {
				dropped = true; receipt = JSON.parse(String(init.body));
				const responses = await Promise.all([fetch(url, init), fetch(url, init)]);
				completionStatuses = responses.map(response => response.status);
				await Promise.all(responses.map(response => response.body?.cancel()));
				throw new Error('Synthetic lost completion receipt');
			}
			return fetch(url, init);
		};
		phase = 'concurrent workers and uncertain completion';
		const workers = [0, 1].map(() => createPersonalRecordingWorker({ origin: options.origin, credential: token, runtime, fetch: lossyFetch, retryMs: 1000 }));
		const outcomes = await Promise.allSettled(workers.map(worker => worker.runOnce({ signal: AbortSignal.timeout(60000) })));
		assert.ok(outcomes.every(outcome => outcome.status === 'fulfilled'));
		assert.deepEqual(outcomes.map(outcome => outcome.status === 'fulfilled' ? outcome.value.status : 'failed').sort(), ['done', 'idle']);
		assert.equal(transcriptions, 1); assert.equal(analyses, 1); assert.equal(dropped, true);
		assert.ok(completionStatuses.includes(200)); assert.ok(completionStatuses.every(status => status === 200 || status === 503));
		phase = 'persisted relational outputs';
		const results = await recording();
		const job = results.jobs.find((item: any) => item.postId === postId);
		assert.equal(job.status, 'done'); assert.equal(job.commentIds.length, 1); assert.equal(job.resultIds.length, 2);
		const outputTypes: string[] = [];
		for (const id of [postId, ...job.commentIds, ...job.resultIds]) {
			const item = await request(`/api/v1/things?id=${encodeURIComponent(id)}`);
			assert.equal(item.ok, true);
			if (job.commentIds.includes(id)) { assert.equal(item.thing.targetId, postId); assert.ok(item.thing.crystal.text.includes(transcript)); }
			if (job.resultIds.includes(id)) {
				assert.equal(item.thing.crystal.sourcePostId, postId);
				assert.ok(transcript.includes(item.thing.crystal.evidence)); outputTypes.push(item.thing.crystal.type);
			}
			await request(`/api/v1/things?id=${encodeURIComponent(id)}`, undefined, undefined, 404, true);
		}
		assert.deepEqual(outputTypes.sort(), ['note', 'todo']);
		const after = (await request(`/api/v1/things?id=${postId}`)).thing;
		assert.deepEqual(after.crystal, before.crystal); assert.deepEqual(after.acl, before.acl);
		const comments = await request(`/api/v1/things?target=${postId}&thingtime=comment`);
		assert.equal(comments.things.length, 1);
		phase = 'receipt replay and conflicting result';
		await recording(receipt, token);
		await recording({ ...receipt, transcript: transcript + ' Changed.' }, token, 409);
		await recording({ op: 'heartbeat', jobId: receipt.jobId, leaseId: receipt.leaseId }, token);
		assert.deepEqual((await recording()).jobs.find((item: any) => item.postId === postId).resultIds, job.resultIds);
		phase = 'opt-out enforcement';
		await recording({ op: 'settings', settings: { enabled: false } });
		await recording({ op: 'claim' }, token, 409);
		passed = true;
	} catch {
		console.error(`Recording delivery smoke failed at: ${phase}. No credentials or raw responses were printed.`);
	} finally {
		// Only this run's synthetic source/results are removed. Test account and
		// paired-device records remain for diagnosis; credentials stay memory-only.
		try {
			if (ownsSettings) {
				await recording({ op: 'settings', settings: { enabled: false, runtimeDeviceId: null } });
				const result = await recording();
				assert.equal(result.settings.enabled, false);
				for (const id of result.jobs.filter((job: any) => job.postId === postId).flatMap((job: any) => job.resultIds))
					await request('/api/v1/things', { id }, undefined, 200, false, 'DELETE');
			}
			if (postId) await request('/api/v1/things', { id: postId }, undefined, [200, 404], false, 'DELETE');
			if (uploadId && !postCreated) {
				const cleanup = await request('/api/v1/attachments/uploads/abort', { uploadId });
				if (cleanup.deferred) console.log('Synthetic upload cleanup is deferred to the storage lifecycle settlement window.');
			}
		} catch { cleanupFailed = true; console.error('Synthetic cleanup needs attention. Check this disposable account; processing may still be enabled.'); }
		// Revoke only the API login created by this test, even if content cleanup
		// failed. Never use or sign out an existing browser session.
		if (cookie) {
			try { await request('/api/v1/auth/logout', {}); }
			catch { cleanupFailed = true; console.error('Disposable test-session logout needs attention.'); }
			cookie = '';
		}
	}
	if (!passed || cleanupFailed) return false;
	console.log('PASS: real HTTP upload, concurrent claims, duplicate-safe transcript/notes/todo writes, privacy and opt-out. Synthetic inference only; no physical Watch or Claude acceptance claimed. Fixture content removed; disposable account and device records retained, processing disabled.');
	return true;
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
	if (!process.argv.includes('--confirm-disposable-qa')) console.log('SKIP: opt in with --confirm-disposable-qa, loopback origin, and THINGTIME_RECORDING_QA_USERNAME / THINGTIME_RECORDING_QA_PASSWORD for an unused, upload-approved recqa account.');
	else {
		try {
			const options = deliverySmokeOptions(process.argv[2], process.env.THINGTIME_RECORDING_QA_USERNAME, process.env.THINGTIME_RECORDING_QA_PASSWORD);
			if (!await runDeliverySmoke(options)) process.exitCode = 1;
		} catch { console.error('Recording delivery smoke requires an exact loopback origin and disposable QA credentials.'); process.exitCode = 1; }
	}
}
