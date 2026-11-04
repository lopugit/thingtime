import assert from 'node:assert/strict';
import test from 'node:test';

import {
	installPreviewBuildFreshness,
	isStalePreviewEntry,
	isVercelPreviewHost,
	previewEntryAssetFromHtml,
	previewEntryAssetFromSources,
	previewRefreshUrl
} from './previewBuildFreshness';

type TestListener = (event: Record<string, unknown>) => void;

const createPreviewRuntime = (freshAsset: string) => {
	const windowListeners = new Map<string, Set<TestListener>>();
	const documentListeners = new Map<string, Set<TestListener>>();
	const scripts: Array<{ src: string }> = [];
	const replacements: string[] = [];
	const session = new Map<string, string>();
	let clock = 1_000;

	const addListener = (listeners: Map<string, Set<TestListener>>, type: string, listener: TestListener) => {
		const registered = listeners.get(type) ?? new Set<TestListener>();
		registered.add(listener);
		listeners.set(type, registered);
	};
	const removeListener = (listeners: Map<string, Set<TestListener>>, type: string, listener: TestListener) => {
		listeners.get(type)?.delete(listener);
	};
	const location = {
		hostname: 'thingtime-git-feature.vercel.app',
		origin: 'https://thingtime-git-feature.vercel.app',
		href: 'https://thingtime-git-feature.vercel.app/things?preview=abc#details',
		replace(value: string) {
			replacements.push(value);
			location.href = value;
		}
	};
	const runtimeWindow = {
		location,
		fetch: async () => ({
			ok: true,
			text: async () => `<script type="module" src="${freshAsset}"></script>`
		}),
		sessionStorage: {
			getItem: (key: string) => session.get(key) ?? null,
			setItem: (key: string, value: string) => session.set(key, value)
		},
		addEventListener: (type: string, listener: TestListener) => addListener(windowListeners, type, listener),
		removeEventListener: (type: string, listener: TestListener) => removeListener(windowListeners, type, listener)
	} as unknown as Window;
	const runtimeDocument = {
		scripts,
		readyState: 'loading',
		visibilityState: 'visible',
		addEventListener: (type: string, listener: TestListener) => addListener(documentListeners, type, listener),
		removeEventListener: (type: string, listener: TestListener) => removeListener(documentListeners, type, listener)
	} as unknown as Document;
	const dispatch = (listeners: Map<string, Set<TestListener>>, type: string, event: Record<string, unknown> = {}) => {
		for (const listener of listeners.get(type) ?? []) listener(event);
	};

	return {
		runtime: { window: runtimeWindow, document: runtimeDocument, now: () => clock++ },
		scripts,
		replacements,
		dispatchWindow: (type: string, event?: Record<string, unknown>) => dispatch(windowListeners, type, event),
		dispatchDocument: (type: string, event?: Record<string, unknown>) => dispatch(documentListeners, type, event)
	};
};

const flushAsyncWork = () => new Promise<void>((resolve) => setImmediate(resolve));

test('recognises Vercel preview hosts without affecting production domains', () => {
	assert.equal(isVercelPreviewHost('thingtime-git-feature.vercel.app'), true);
	assert.equal(isVercelPreviewHost('THINGTIME-GIT-FEATURE.VERCEL.APP'), true);
	assert.equal(isVercelPreviewHost('thingtime.com'), false);
	assert.equal(isVercelPreviewHost('vercel.app.thingtime.com'), false);
});

test('extracts the hashed Vite entry asset from the document and live HTML', () => {
	assert.equal(
		previewEntryAssetFromSources(['https://thingtime.example/assets/vendor.js', 'https://thingtime.example/assets/index-BzJD4WWi.js']),
		'/assets/index-BzJD4WWi.js'
	);
	assert.equal(
		previewEntryAssetFromHtml(
			'<script defer src="/other.js"></script><script type="module" crossorigin src="/assets/index-New123.js?fresh=1"></script>'
		),
		'/assets/index-New123.js'
	);
});

test('reloads only when both entry assets are known and differ', () => {
	assert.equal(isStalePreviewEntry('/assets/index-old.js', '/assets/index-new.js'), true);
	assert.equal(isStalePreviewEntry('/assets/index-current.js', '/assets/index-current.js'), false);
	assert.equal(isStalePreviewEntry(null, '/assets/index-new.js'), false);
	assert.equal(isStalePreviewEntry('/assets/index-old.js', null), false);
});

test('builds a unique same-route refresh URL without dropping existing state', () => {
	assert.equal(
		previewRefreshUrl('https://thingtime-git-feature.vercel.app/things?preview=abc#details', '/assets/index-New123.js', 1234),
		'https://thingtime-git-feature.vercel.app/things?preview=abc&__tt_preview_refresh=index-New123.js-1234#details'
	);
});

test('checks freshness after parsing when the pre-app head guard starts before the entry script exists', async () => {
	const harness = createPreviewRuntime('/assets/index-new.js');
	installPreviewBuildFreshness(harness.runtime);
	harness.scripts.push({ src: '/assets/index-old.js' });
	harness.dispatchDocument('DOMContentLoaded');
	await flushAsyncWork();

	assert.equal(harness.replacements.length, 1);
	assert.match(harness.replacements[0], /__tt_preview_refresh=index-new\.js-/);
});

test('forces a versioned navigation when Safari restores a preview from its page cache', () => {
	const harness = createPreviewRuntime('/assets/index-current.js');
	installPreviewBuildFreshness(harness.runtime);
	harness.scripts.push({ src: '/assets/index-current.js' });
	harness.dispatchWindow('pageshow', { persisted: true });

	assert.equal(harness.replacements.length, 1);
	assert.match(harness.replacements[0], /__tt_preview_refresh=index-current\.js-/);
});

test('retries a crashed current bundle only once per preview session', async () => {
	const harness = createPreviewRuntime('/assets/index-current.js');
	installPreviewBuildFreshness(harness.runtime);
	harness.scripts.push({ src: '/assets/index-current.js' });

	harness.dispatchWindow('error', { filename: 'https://thingtime-git-feature.vercel.app/assets/index-current.js' });
	await flushAsyncWork();
	harness.dispatchWindow('error', { filename: 'https://thingtime-git-feature.vercel.app/assets/index-current.js' });
	await flushAsyncWork();

	assert.equal(harness.replacements.length, 1);
});
