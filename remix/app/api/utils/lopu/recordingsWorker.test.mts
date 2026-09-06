import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { DEFAULT_RECORDING_SETTINGS, RECORDING_SETTINGS_KIND, RECORDING_REMINDER_KIND } from './recordingsCore';

// In-memory collaborators only. Tests never seed or modify a real database.
let settings: any;
let privateSource: boolean;
let persisted: any;
let created: any[];
let reminders: any[];
let afterCommitCrash: boolean;
let revokeAtCommit: boolean;
const post = { _id: 'source', shareId: 'watch-upload-test', ownerId: 'owner' };
const emptyState = () => ({ commentIds: [], commentIndex: 0, insightIndex: 0, resultIds: [] });
const assign = (row: any, path: string, value: any) => {
	const keys = path.split('.');
	for (const key of keys.slice(0, -1)) row = row[key] ||= {};
	row[keys.at(-1)!] = structuredClone(value);
};
const collection = {
	async findOne() {
		return privateSource ? post : null;
	},
	async updateOne(filter: any, patch: any) {
		if (filter.thingtime === RECORDING_SETTINGS_KIND) return { matchedCount: settings.enabled ? 1 : 0 };
		if (filter.thingtime === RECORDING_REMINDER_KIND) {
			reminders.push(patch.$setOnInsert);
			return { matchedCount: 1 };
		}
		if (filter._id === post._id) return { matchedCount: privateSource ? 1 : 0 };
		if (filter.shareId !== persisted.shareId || filter.lease !== persisted.lease) return { matchedCount: 0 };
		for (const [key, value] of Object.entries(patch.$set || {})) assign(persisted, key, value);
		for (const key of Object.keys(patch.$unset || {})) {
			const parts = key.split('.');
			let row = persisted;
			for (const part of parts.slice(0, -1)) row = row[part];
			delete row[parts.at(-1)!];
		}
		return { matchedCount: 1 };
	}
};
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: { getHomeThingsCollection: async () => collection } });
mock.module(new URL('../mongodb/endpoint.ts', import.meta.url).href, {
	namedExports: { runWithMongoEndpoint: async (_: unknown, fn: () => unknown) => fn() }
});
mock.module(new URL('./recordingsStore.ts', import.meta.url).href, {
	namedExports: {
		discoverRecordingUploads: async () => 0,
		getRecordingSettings: async () => settings,
		isPrivateRecordingPost: () => privateSource,
		recordingSource: async () => (privateSource ? { post } : null),
		recordingControlDoc: (kind: string, id: string, ownerId: string, crystal: unknown, targetId: string) => ({
			kind,
			id,
			ownerId,
			crystal,
			targetId
		}),
		recordingId: (...parts: string[]) => parts.join(':'),
		recordingJobState: (job: any) => structuredClone(job.secure || emptyState()),
		recordingStateBlob: (state: unknown) => structuredClone(state)
	}
});
mock.module(new URL('./recordingsProvider.ts', import.meta.url).href, {
	namedExports: {
		transcribeRecording: async () => {
			throw new Error('Unexpected provider call');
		},
		analyzeRecording: async () => {
			throw new Error('Unexpected provider call');
		},
		recordingProviderStatus: () => ({ configured: true })
	}
});
mock.module(new URL('../things/things.ts', import.meta.url).href, {
	namedExports: {
		createThing: async (ownerId: string, doc: any, _actor: unknown, _app: unknown, hooks: any) => {
			if (revokeAtCommit) privateSource = false;
			await hooks.afterInsert(doc, { transaction: true });
			created.push({ ownerId, ...doc });
			if (afterCommitCrash) {
				afterCommitCrash = false;
				throw new Error('Worker stopped after committed checkpoint');
			}
			return { ok: true };
		}
	}
});
const { processRecordingJob } = await import('./recordingsWorker');
const transcript = 'Please remind me to buy bike tubes and ART toothpaste.';
const insight = { kind: 'todo' as const, title: 'Buy bike tubes', description: '', evidence: 'buy bike tubes' };
const deps = { transcribe: async () => transcript, analyze: async () => [insight] };
beforeEach(() => {
	settings = { ...DEFAULT_RECORDING_SETTINGS, enabled: true };
	privateSource = true;
	created = [];
	reminders = [];
	afterCommitCrash = false;
	revokeAtCommit = false;
	persisted = {
		shareId: 'job',
		ownerId: 'owner',
		targetId: post.shareId,
		lease: 'lease-1',
		crystal: { attempts: 1, attachmentId: 'audio' },
		secure: emptyState()
	};
});
const attempt = () => processRecordingJob(structuredClone(persisted), deps);
const reclaim = () => {
	persisted.lease = 'lease-2';
	persisted.crystal.attempts++;
};

test('a recording becomes a relational transcript comment and owner-private todo with one reminder', async () => {
	assert.equal(await attempt(), 'done');
	assert.equal(created.length, 2);
	assert.deepEqual(created[0].thingtime, ['comment']);
	assert.equal(created[0].targetId, post.shareId);
	assert.ok(created[0].crystal.text.includes(transcript));
	assert.deepEqual(created[1].acl, ['tt:user']);
	assert.equal(created[1].crystal.completed, false);
	assert.equal(created[1].crystal.sourcePostId, post.shareId);
	assert.equal(reminders.length, 1);
	assert.equal(persisted.secure.transcript, undefined, 'completed jobs discard private scratch');
});
test('a crash after committing a comment resumes from the checkpoint without duplicate content', async () => {
	afterCommitCrash = true;
	assert.equal(await attempt(), 'retry');
	assert.equal(created.length, 1);
	assert.equal(persisted.secure.commentIndex, 1);
	reclaim();
	assert.equal(await attempt(), 'done');
	assert.equal(created.filter((row) => row.thingtime.includes('comment')).length, 1);
	assert.equal(created.filter((row) => row.thingtime.includes('data')).length, 1);
});
test('analysis failure retains the transcript and retries only unfinished work', async () => {
	assert.equal(
		await processRecordingJob(structuredClone(persisted), {
			...deps,
			analyze: async () => {
				throw new Error('Provider down with a secret URL');
			}
		}),
		'retry'
	);
	assert.equal(created.length, 1);
	assert.equal(persisted.crystal.error.includes('secret URL'), false);
	reclaim();
	assert.equal(
		await processRecordingJob(structuredClone(persisted), {
			...deps,
			transcribe: async () => {
				throw new Error('Must not transcribe twice');
			}
		}),
		'done'
	);
	assert.equal(created.length, 2);
});
test('source privacy is checked again inside the content transaction', async () => {
	revokeAtCommit = true;
	assert.equal(await attempt(), 'paused');
	assert.equal(created.length, 0);
	assert.equal(reminders.length, 0);
});
test('opt-out prevents any provider or content operation', async () => {
	settings.enabled = false;
	assert.equal(await processRecordingJob(structuredClone(persisted)), 'paused');
	assert.equal(created.length, 0);
});
test('long emoji transcripts split into valid, bounded comments and can disable derived Things', async () => {
	settings.createNotes = false;
	settings.createTodos = false;
	const text = '🥰'.repeat(1400);
	assert.equal(
		await processRecordingJob(structuredClone(persisted), {
			...deps,
			transcribe: async () => text,
			analyze: async () => {
				throw new Error('Analysis disabled');
			}
		}),
		'done'
	);
	assert.ok(created.length > 1);
	assert.ok(created.every((row) => row.crystal.text.length <= 1000 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(row.crystal.text)));
	assert.equal(reminders.length, 0);
});
