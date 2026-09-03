import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
	LOPU_CATALOG_CACHE_KEY,
	LOPU_CHAT_STORE_MODELS_CACHE_KEY,
	LOPU_LAUNCHER_BOTTOM_INSET,
	LOPU_DEVKIT_CLEARANCE,
	LOPU_LAUNCHER_CACHE_KEY,
	LOPU_LAUNCHER_EDGE_GUTTER,
	LOPU_LAUNCHER_INSET,
	LOPU_LAUNCHER_SIZE,
	LOPU_SETTINGS_DEFAULTS,
	LOPU_WINDOW_CACHE_KEY,
	LOPU_WINDOW_DEFAULT_SIZE,
	LOPU_WINDOW_LAUNCHER_GAP,
	LOPU_WINDOW_MARGIN,
	LOPU_WINDOW_MIN_SIZE,
	clampLopuLauncherPosition,
	clampLopuWindowGeometry,
	clampLopuWindowSize,
	defaultLopuLauncherPosition,
	defaultLopuWindowGeometry,
	describeLopuModelChoice,
	dockedLopuWindowGeometry,
	isLopuHostHiddenOnPath,
	isLopuVoicePath,
	normalizeLopuCatalog,
	normalizeLopuSettings,
	preferredLopuEffort,
	readLopuCatalogCache,
	readLopuLauncherPosition,
	readLopuWindowGeometry,
	resolveLopuModelChoice,
	resolveLopuWindowGeometry,
	writeLopuLauncherPosition,
	writeLopuWindowGeometry
} from './useLopuSettings';

const desktop = { width: 1440, height: 900 };
const phone = { width: 375, height: 667 };

// ——— settings ————————————————————————————————————————————————————————————

describe('normalizeLopuSettings', () => {
	test('a missing or junk branch yields the documented defaults', () => {
		assert.deepEqual(normalizeLopuSettings(undefined), LOPU_SETTINGS_DEFAULTS);
		assert.deepEqual(normalizeLopuSettings(null), LOPU_SETTINGS_DEFAULTS);
		assert.deepEqual(normalizeLopuSettings('nope'), LOPU_SETTINGS_DEFAULTS);
		assert.deepEqual(normalizeLopuSettings({ launcher: 'yes', dock: 'up', speed: 'warp', model: 42 }), LOPU_SETTINGS_DEFAULTS);
	});

	test('defaults are the safe product choices: launcher on, free dock, live patches, confirm deletes, enter sends, quiet voice', () => {
		assert.equal(LOPU_SETTINGS_DEFAULTS.launcher, true);
		assert.equal(LOPU_SETTINGS_DEFAULTS.dock, 'free');
		assert.equal(LOPU_SETTINGS_DEFAULTS.applyPatches, true);
		assert.equal(LOPU_SETTINGS_DEFAULTS.confirmDeletes, true);
		assert.equal(LOPU_SETTINGS_DEFAULTS.enterSends, true);
		assert.equal(LOPU_SETTINGS_DEFAULTS.model, null);
		// voice: text-only replies, no transcribe, the model picker's brain
		assert.equal(LOPU_SETTINGS_DEFAULTS.spokenReplies, false);
		assert.equal(LOPU_SETTINGS_DEFAULTS.transcribe, false);
		assert.equal(LOPU_SETTINGS_DEFAULTS.providerId, null);
		assert.equal(LOPU_SETTINGS_DEFAULTS.open, false);
	});

	test('explicit values survive, ids are trimmed and bounded', () => {
		const settings = normalizeLopuSettings({
			launcher: false,
			dock: 'right',
			applyPatches: false,
			confirmDeletes: false,
			enterSends: false,
			model: '  claude-opus-5  ',
			effort: 'xhigh',
			speed: 'fast',
			spokenReplies: true,
			transcribe: true,
			providerId: ' vault-provider-1 ',
			open: true
		});
		assert.deepEqual(settings, {
			launcher: false,
			dock: 'right',
			applyPatches: false,
			confirmDeletes: false,
			enterSends: false,
			model: 'claude-opus-5',
			effort: 'xhigh',
			speed: 'fast',
			spokenReplies: true,
			transcribe: true,
			providerId: 'vault-provider-1',
			open: true
		});
		assert.equal(normalizeLopuSettings({ model: 'x'.repeat(500) }).model?.length, 80);
		assert.equal(normalizeLopuSettings({ model: '   ' }).model, null);
	});

	test('voice keys normalise like the rest: junk falls back, ids are bounded', () => {
		const junk = normalizeLopuSettings({ spokenReplies: 'yes', transcribe: 1, providerId: 42 });
		assert.equal(junk.spokenReplies, false);
		assert.equal(junk.transcribe, false);
		assert.equal(junk.providerId, null);
		assert.equal(normalizeLopuSettings({ providerId: 'p'.repeat(200) }).providerId?.length, 80);
		assert.equal(normalizeLopuSettings({ providerId: '   ' }).providerId, null);
	});
});

// ——— launcher geometry ————————————————————————————————————————————————————

describe('launcher position', () => {
	test('rests bottom-right, stacked above DevKit (72px over its 20px corner)', () => {
		assert.equal(LOPU_LAUNCHER_BOTTOM_INSET, 92);
		assert.deepEqual(defaultLopuLauncherPosition(desktop), {
			x: desktop.width - LOPU_LAUNCHER_INSET - LOPU_LAUNCHER_SIZE,
			y: desktop.height - LOPU_LAUNCHER_BOTTOM_INSET - LOPU_LAUNCHER_SIZE
		});
	});

	test('clamps a persisted position back inside the viewport when the window shrinks', () => {
		const clamped = clampLopuLauncherPosition({ x: 5000, y: -40 }, phone);
		assert.deepEqual(clamped, {
			x: phone.width - LOPU_LAUNCHER_SIZE - LOPU_LAUNCHER_EDGE_GUTTER,
			y: LOPU_LAUNCHER_EDGE_GUTTER
		});
		// an in-range position is untouched (rounded)
		assert.deepEqual(clampLopuLauncherPosition({ x: 100.4, y: 200.6 }, desktop), { x: 100, y: 201 });
		// NaN / junk falls back to the far corner instead of throwing
		assert.deepEqual(clampLopuLauncherPosition({ x: Number.NaN, y: undefined as unknown as number }, desktop), {
			x: desktop.width - LOPU_LAUNCHER_SIZE - LOPU_LAUNCHER_EDGE_GUTTER,
			y: desktop.height - LOPU_LAUNCHER_SIZE - LOPU_LAUNCHER_EDGE_GUTTER
		});
	});
});

// ——— window geometry ——————————————————————————————————————————————————————

describe('window geometry', () => {
	test('size defaults to 400×560 and is bounded to 320×360 … viewport−24', () => {
		assert.deepEqual(clampLopuWindowSize({}, desktop), { width: 400, height: 560 });
		assert.deepEqual(clampLopuWindowSize({ width: 10, height: 10 }, desktop), LOPU_WINDOW_MIN_SIZE);
		assert.deepEqual(clampLopuWindowSize({ width: 9999, height: 9999 }, desktop), {
			width: desktop.width - LOPU_WINDOW_MARGIN,
			height: desktop.height - LOPU_WINDOW_MARGIN
		});
		// a viewport smaller than the minimum still yields something that fits
		const tiny = clampLopuWindowSize({}, { width: 300, height: 300 });
		assert.deepEqual(tiny, { width: 300 - LOPU_WINDOW_MARGIN, height: 300 - LOPU_WINDOW_MARGIN });
		assert.equal(LOPU_WINDOW_DEFAULT_SIZE.width, 400);
		assert.equal(LOPU_WINDOW_DEFAULT_SIZE.height, 560);
	});

	test('the default frame sits bottom-right and clears the launcher bubble', () => {
		const launcher = defaultLopuLauncherPosition(desktop);
		const frame = defaultLopuWindowGeometry(desktop);
		assert.equal(frame.width, 400);
		assert.equal(frame.height, 560);
		assert.equal(frame.x, desktop.width - 400 - LOPU_WINDOW_MARGIN);
		// bottom edge of the window is above the launcher's top edge
		assert.ok(frame.y + frame.height <= launcher.y - LOPU_WINDOW_LAUNCHER_GAP, `frame bottom ${frame.y + frame.height} should clear launcher top ${launcher.y}`);
		// a dragged launcher moves the resting spot with it
		const high = defaultLopuWindowGeometry(desktop, { x: 40, y: 40 });
		assert.ok(high.y >= 0);
	});

	test('a persisted frame is clamped on screen; partial or junk frames fill from the default', () => {
		const offscreen = clampLopuWindowGeometry({ x: 5000, y: 5000, width: 400, height: 560 }, desktop);
		assert.deepEqual(offscreen, { x: desktop.width - 400, y: desktop.height - 560, width: 400, height: 560 });

		const fallback = defaultLopuWindowGeometry(desktop);
		assert.deepEqual(resolveLopuWindowGeometry(null, desktop), fallback);
		assert.deepEqual(resolveLopuWindowGeometry({ width: 500 }, desktop), { ...fallback, width: 500, x: Math.min(fallback.x, desktop.width - 500) });
		assert.deepEqual(resolveLopuWindowGeometry({ x: 'left' as unknown as number }, desktop), fallback);

		// on a phone-sized viewport the frame still fits with the margin
		const small = resolveLopuWindowGeometry({ x: 0, y: 0, width: 400, height: 560 }, phone);
		assert.ok(small.width <= phone.width - LOPU_WINDOW_MARGIN);
		assert.ok(small.height <= phone.height - LOPU_WINDOW_MARGIN);
	});

	test('docking pins a full-height column to the chosen edge, keeping the free width', () => {
		// a right column stops above DevKit's corner bubble so the composer stays reachable
		assert.deepEqual(dockedLopuWindowGeometry('right', 420, desktop), { x: desktop.width - 420, y: 0, width: 420, height: desktop.height - LOPU_DEVKIT_CLEARANCE });
		assert.deepEqual(dockedLopuWindowGeometry('left', 420, desktop), { x: 0, y: 0, width: 420, height: desktop.height });
		// width still respects the viewport bound
		assert.equal(dockedLopuWindowGeometry('right', 9999, desktop).width, desktop.width - LOPU_WINDOW_MARGIN);
		assert.equal(dockedLopuWindowGeometry('left', 10, desktop).width, LOPU_WINDOW_MIN_SIZE.width);
	});
});

// ——— persisted geometry (localStorage tier) ————————————————————————————————

describe('persisted geometry', () => {
	const store = new Map<string, string>();
	const fakeWindow = {
		localStorage: {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => {
				store.set(key, value);
			},
			removeItem: (key: string) => {
				store.delete(key);
			},
			key: (index: number) => [...store.keys()][index] ?? null,
			get length() {
				return store.size;
			}
		}
	};

	beforeEach(() => {
		store.clear();
		(globalThis as any).window = fakeWindow;
	});

	afterEach(() => {
		delete (globalThis as any).window;
	});

	test('launcher and window frames round-trip through their tt-lopu-* keys', () => {
		assert.equal(readLopuLauncherPosition(), null);
		writeLopuLauncherPosition({ x: 12.6, y: 34.2 });
		assert.deepEqual(readLopuLauncherPosition(), { x: 13, y: 34 });
		assert.ok(store.has(LOPU_LAUNCHER_CACHE_KEY));

		assert.equal(readLopuWindowGeometry(), null);
		writeLopuWindowGeometry({ x: 1, y: 2, width: 400.4, height: 560 });
		assert.deepEqual(readLopuWindowGeometry(), { x: 1, y: 2, width: 400, height: 560 });
		assert.ok(store.has(LOPU_WINDOW_CACHE_KEY));

		// keys sit under the prefix the logout sweep clears
		assert.ok(LOPU_LAUNCHER_CACHE_KEY.startsWith('tt-lopu-'));
		assert.ok(LOPU_WINDOW_CACHE_KEY.startsWith('tt-lopu-'));
		assert.ok(LOPU_CATALOG_CACHE_KEY.startsWith('tt-lopu-'));
	});

	test('junk lines are ignored instead of painting a broken frame', () => {
		store.set(LOPU_LAUNCHER_CACHE_KEY, JSON.stringify({ x: 'a', y: 1 }));
		assert.equal(readLopuLauncherPosition(), null);
		store.set(LOPU_WINDOW_CACHE_KEY, JSON.stringify({ width: 'wide' }));
		assert.equal(readLopuWindowGeometry(), null);
		store.set(LOPU_WINDOW_CACHE_KEY, '{not json');
		assert.equal(readLopuWindowGeometry(), null);
	});

	test('the catalog seeds from its own line first, then the chat store models line', () => {
		assert.equal(readLopuCatalogCache(), null);
		store.set(
			LOPU_CHAT_STORE_MODELS_CACHE_KEY,
			JSON.stringify({ at: 1, models: [{ id: 'gpt-5', label: 'GPT-5', provider: 'openai', efforts: ['low'], speeds: ['normal'] }], defaults: { model: 'gpt-5' }, providers: {} })
		);
		assert.equal(readLopuCatalogCache()?.models[0]?.id, 'gpt-5');
		store.set(LOPU_CATALOG_CACHE_KEY, JSON.stringify({ models: [{ id: 'claude-opus-5', label: 'Claude Opus 5', provider: 'anthropic' }] }));
		assert.equal(readLopuCatalogCache()?.models[0]?.id, 'claude-opus-5');
	});
});

// ——— catalog ——————————————————————————————————————————————————————————————

const catalogPayload = {
	ok: true,
	models: [
		{ id: 'claude-opus-5', label: 'Claude Opus 5', provider: 'anthropic', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], speeds: ['normal', 'fast'], family: 'claude', enabled: true, available: true, isDefault: true },
		{ id: 'claude-sonnet-5', label: 'Claude Sonnet 5', provider: 'anthropic', efforts: ['low', 'high'], speeds: ['normal'], family: 'claude', enabled: false, available: false },
		{ id: 'gpt-5', label: 'GPT-5', provider: 'openai', efforts: ['low', 'medium'], speeds: ['normal', 'fast'], family: 'gpt', enabled: true, available: false },
		{ id: '', label: 'junk' },
		'not a model'
	],
	defaults: { model: 'claude-opus-5', effort: 'high', speed: 'normal' },
	providers: { anthropic: { configured: true }, openai: { configured: false } }
};

describe('model catalog', () => {
	test('normalises the public payload and drops junk rows', () => {
		const catalog = normalizeLopuCatalog(catalogPayload);
		assert.deepEqual(
			catalog.models.map((model) => model.id),
			['claude-opus-5', 'claude-sonnet-5', 'gpt-5']
		);
		assert.equal(catalog.models[0].isDefault, true);
		assert.equal(catalog.models[1].available, false);
		assert.deepEqual(catalog.defaults, { model: 'claude-opus-5', effort: 'high', speed: 'normal' });
		assert.deepEqual(catalog.providers, { anthropic: { configured: true }, openai: { configured: false } });
		// `available` falls back to `enabled` when the projection omits it
		assert.equal(normalizeLopuCatalog({ models: [{ id: 'x', enabled: true }] }).models[0].available, true);
		assert.deepEqual(normalizeLopuCatalog(null).models, []);
	});

	test('preferredLopuEffort prefers the requested tier, then high, then the deepest tier', () => {
		const catalog = normalizeLopuCatalog(catalogPayload);
		assert.equal(preferredLopuEffort(catalog.models[0], 'xhigh'), 'xhigh');
		assert.equal(preferredLopuEffort(catalog.models[0], 'nope'), 'high');
		assert.equal(preferredLopuEffort(catalog.models[2], 'high'), 'medium');
		assert.equal(preferredLopuEffort(null), null);
		assert.equal(preferredLopuEffort({ ...catalog.models[0], efforts: [] }), null);
	});

	test('resolveLopuModelChoice honours an available preference and falls back to the catalog default otherwise', () => {
		const catalog = normalizeLopuCatalog(catalogPayload);
		// no preference → catalog defaults
		assert.deepEqual(resolveLopuModelChoice(catalog, { model: null, effort: null, speed: null }), { model: 'claude-opus-5', effort: 'high', speed: 'normal' });
		// an available preference with a valid effort/speed sticks
		assert.deepEqual(resolveLopuModelChoice(catalog, { model: 'claude-opus-5', effort: 'max', speed: 'fast' }), { model: 'claude-opus-5', effort: 'max', speed: 'fast' });
		// an effort the model does not offer clamps back
		assert.deepEqual(resolveLopuModelChoice(catalog, { model: 'claude-opus-5', effort: 'ultra', speed: null }), { model: 'claude-opus-5', effort: 'high', speed: 'normal' });
		// an unavailable preference (no OpenAI key) yields the catalog default, not a dead choice
		assert.deepEqual(resolveLopuModelChoice(catalog, { model: 'gpt-5', effort: 'low', speed: 'fast' }), { model: 'claude-opus-5', effort: 'high', speed: 'normal' });
		// an unknown model with an empty catalog passes the preference through untouched
		assert.deepEqual(resolveLopuModelChoice(normalizeLopuCatalog(null), { model: 'mystery', effort: 'low', speed: null }), { model: 'mystery', effort: 'low', speed: null });
	});

	test('describeLopuModelChoice reads as the header chip', () => {
		const catalog = normalizeLopuCatalog(catalogPayload);
		assert.equal(describeLopuModelChoice(catalog, { model: null, effort: null, speed: null }), 'Claude Opus 5 · High');
		assert.equal(describeLopuModelChoice(catalog, { model: 'claude-opus-5', effort: 'xhigh', speed: 'fast' }), 'Claude Opus 5 · Extra high ⚡');
		assert.equal(describeLopuModelChoice(normalizeLopuCatalog(null), { model: null, effort: null, speed: null }), 'Auto');
		// models exist but nothing is available (no provider configured)
		const dark = normalizeLopuCatalog({ ...catalogPayload, defaults: {} });
		assert.equal(describeLopuModelChoice(dark, { model: null, effort: null, speed: null }), 'No model');
	});
});

// ——— host visibility ——————————————————————————————————————————————————————

test('the floating host hides on the /lopu page and its chat routes only', () => {
	assert.equal(isLopuHostHiddenOnPath('/lopu'), true);
	assert.equal(isLopuHostHiddenOnPath('/lopu/abc123'), true);
	assert.equal(isLopuHostHiddenOnPath('/lopu/voice'), true);
	assert.equal(isLopuHostHiddenOnPath('/lopusaurus'), false);
	assert.equal(isLopuHostHiddenOnPath('/messages'), false);
	assert.equal(isLopuHostHiddenOnPath('/'), false);
	assert.equal(isLopuHostHiddenOnPath(undefined), false);
});

test('/lopu/voice is the page in voice mode; a chat deep link is not', () => {
	assert.equal(isLopuVoicePath('/lopu/voice'), true);
	assert.equal(isLopuVoicePath('/lopu/voice/'), true);
	assert.equal(isLopuVoicePath('/lopu'), false);
	assert.equal(isLopuVoicePath('/lopu/voiceover-chat'), false);
	assert.equal(isLopuVoicePath(null), false);
});
