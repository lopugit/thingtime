import assert from 'node:assert/strict';
import test from 'node:test';

import {
	clearStaleChunkReloadGuard,
	isStaleChunkLoadError,
	recoverStaleChunk,
	reloadForStaleChunk,
	STALE_CHUNK_RELOAD_KEY
} from './staleChunkRecovery';

const createRuntime = () => {
	const session = new Map<string, string>();
	let reloads = 0;

	return {
		runtime: {
			sessionStorage: {
				getItem: (key: string) => session.get(key) ?? null,
				removeItem: (key: string) => session.delete(key),
				setItem: (key: string, value: string) => session.set(key, value)
			},
			reload: () => {
				reloads += 1;
			},
			now: () => 1_234
		},
		session,
		reloadCount: () => reloads
	};
};

test('recognises Chromium, Safari, and Firefox dynamic-import failures', () => {
	assert.equal(isStaleChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /assets/route-old.js')), true);
	assert.equal(isStaleChunkLoadError(new TypeError('Importing a module script failed.')), true);
	assert.equal(isStaleChunkLoadError(new TypeError('error loading dynamically imported module')), true);
	assert.equal(isStaleChunkLoadError(new TypeError('Failed to fetch profile data')), false);
});

test('claims at most one reload until the healthy-page guard is cleared', () => {
	const harness = createRuntime();
	let prevented = 0;

	assert.equal(
		reloadForStaleChunk(() => prevented++, harness.runtime),
		true
	);
	assert.equal(harness.session.get(STALE_CHUNK_RELOAD_KEY), '1234');
	assert.equal(
		reloadForStaleChunk(() => prevented++, harness.runtime),
		false
	);
	assert.equal(harness.reloadCount(), 1);
	assert.equal(prevented, 1);

	assert.equal(clearStaleChunkReloadGuard(harness.runtime), true);
	assert.equal(reloadForStaleChunk(undefined, harness.runtime), true);
	assert.equal(harness.reloadCount(), 2);
});

test('fails closed when session storage is unavailable', () => {
	let reloads = 0;
	const runtime = {
		sessionStorage: {
			getItem: () => {
				throw new Error('storage denied');
			},
			removeItem: () => undefined,
			setItem: () => undefined
		},
		reload: () => {
			reloads += 1;
		}
	};

	assert.equal(reloadForStaleChunk(undefined, runtime), false);
	assert.equal(reloads, 0);
});

test('lazy-route recovery reloads only for a stale chunk and preserves the original rejection', () => {
	const harness = createRuntime();
	const staleError = new TypeError('Importing a module script failed.');

	assert.throws(
		() => recoverStaleChunk(staleError, harness.runtime),
		(error) => error === staleError
	);
	assert.equal(harness.reloadCount(), 1);

	clearStaleChunkReloadGuard(harness.runtime);
	const unrelatedError = new Error('route loader rejected');
	assert.throws(
		() => recoverStaleChunk(unrelatedError, harness.runtime),
		(error) => error === unrelatedError
	);
	assert.equal(harness.reloadCount(), 1);
});
