import assert from 'node:assert/strict';
import test from 'node:test';
import { foregroundFixture, saved, scope } from './foregroundSync.fixture';
import type { ForegroundSyncInput } from './foregroundSync';
import { runPagedForegroundCloudSync } from './pagedForegroundSync';
import { streamForegroundSync } from './streamingForegroundSync';
import { SyncVolumeRemounted } from './syncConnectionWait';
import type { NativeIndexChangesPage } from './streamingIndex';
import { recoverRemountedNativeFeed } from './nativeFeedRecovery';

function inputFor(f: Awaited<ReturnType<typeof foregroundFixture>>): ForegroundSyncInput {
	const input: ForegroundSyncInput = f.input();
	input.inspectLocal = async (path) => structuredClone(f.local.find((row) => row.path === path) ?? null);
	input.scanLocalPages = async function* () {
		const entries = structuredClone(f.local);
		yield { generation: crypto.randomUUID(), ordinal: 0, entries, totalEntries: entries.length };
	};
	return input;
}
function page(id: string, entries: NativeIndexChangesPage['changes'][number]['entry'][], complete = false): NativeIndexChangesPage {
	return {
		id,
		generation: id,
		state: complete ? 'complete' : 'running',
		revision: entries.length,
		changes: entries.map((entry, i) => ({ sequence: i + 1, revision: entry.version, entry })),
		nextSequence: entries.length,
		hasMore: false
	};
}
function remount(f: Awaited<ReturnType<typeof foregroundFixture>>) {
	for (const entry of f.local) {
		entry.id = 'returned-' + entry.id;
		entry.version = 'returned-' + entry.version;
	}
}

test('verified remount drains acknowledged and unstarted hints then reconciles with no duplicate creations', { timeout: 10000 }, async () => {
	const f = await foregroundFixture(3),
		input = inputFor(f);
	let confirmed!: () => void;
	const first = new Promise<void>((resolve) => {
		confirmed = resolve;
	});
	input.progress = (value) => {
		if (value.confirmed >= 1) confirmed();
	};
	input.streamLocalChanges = async function* (id) {
		yield page(id, structuredClone(f.local));
		await first;
		remount(f);
		throw new SyncVolumeRemounted();
	};
	try {
		await runPagedForegroundCloudSync(saved, scope, input, new AbortController().signal);
		assert.equal(f.creates(), 3);
		const runs = input.journal.pagedRuns({ scope, currentScope: input.currentScope });
		assert.equal(await runs.active(), null);
		assert.ok(await input.journal.pagedCheckpoints({ scope, currentScope: input.currentScope }).current());
	} finally {
		f.journal().close();
	}
});

test('accepted write with lost reply retains its original receipt across volume remount and reload', { timeout: 10000 }, async () => {
	const f = await foregroundFixture(2),
		input = inputFor(f);
	f.lose();
	input.streamLocalChanges = async function* (id) {
		yield page(id, structuredClone(f.local), true);
	};
	try {
		await assert.rejects(streamForegroundSync(saved, scope, input, new AbortController().signal), /lost accepted creation/);
		assert.equal(f.creates(), 2);
		remount(f);
		await f.reload();
		const next = inputFor(f);
		next.streamLocalChanges = async function* () {
			throw new SyncVolumeRemounted();
		};
		await runPagedForegroundCloudSync(saved, scope, next, new AbortController().signal);
		assert.equal(f.creates(), 2, 'receipt lookup must prevent replay under a new operation identity');
	} finally {
		f.journal().close();
	}
});

test('explicit Pause abort wins over remount recovery without closing the retained feed', async () => {
	const controller = new AbortController(),
		paused = new DOMException('Paused', 'AbortError');
	let transitions = 0;
	const source = (async function* () {
		controller.abort(paused);
		throw new SyncVolumeRemounted();
	})();
	const iterator = recoverRemountedNativeFeed(
		source,
		async () => {
			transitions++;
		},
		controller.signal
	);
	await assert.rejects(iterator.next(), (error) => error === paused);
	assert.equal(transitions, 0);
});
