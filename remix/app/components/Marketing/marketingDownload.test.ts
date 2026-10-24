import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes this TypeScript test directly and requires the .ts extension.
import {
	DOWNLOAD_BATCH_CAP,
	copyText,
	downloadPng,
	downloadSequentially,
	downloadSvg,
	planDownloads,
	rasteriseSvg,
	triggerDownload
} from './marketingDownload.ts';
// @ts-ignore see above
import { HASHTAGS } from '../../marketing/copy.ts';
// @ts-ignore see above
import { FEATURES, getFeature } from '../../marketing/features.ts';
// @ts-ignore see above
import { PLATFORM_FOR_FORMAT, socialAssetFilename, socialCaption } from '../../marketing/social.ts';
// @ts-ignore see above
import { SOCIAL_FORMATS, TRENDS } from '../../marketing/trends.ts';

// Swaps the global `navigator` for the duration of one assertion. Node ships a
// `navigator` global (without a clipboard) since v21, so the "no clipboard, no
// document" path is the default here; the stubs exercise the other branches.
const withNavigator = async (value: unknown, run: () => Promise<void>) => {
	const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
	try {
		await run();
	} finally {
		if (original) Object.defineProperty(globalThis, 'navigator', original);
		else delete (globalThis as { navigator?: unknown }).navigator;
	}
};

test('planDownloads caps a batch and reports what it skipped', () => {
	assert.equal(DOWNLOAD_BATCH_CAP, 40);
	assert.deepEqual(planDownloads(0), { allowed: 0, skipped: 0 });
	assert.deepEqual(planDownloads(12), { allowed: 12, skipped: 0 });
	assert.deepEqual(planDownloads(40), { allowed: 40, skipped: 0 });
	assert.deepEqual(planDownloads(120), { allowed: 40, skipped: 80 });
	assert.deepEqual(planDownloads(120, 10), { allowed: 10, skipped: 110 });
	assert.deepEqual(planDownloads(-5), { allowed: 0, skipped: 0 });
	assert.deepEqual(planDownloads(Number.NaN), { allowed: 0, skipped: 0 });
	assert.deepEqual(planDownloads(7.9, 3.2), { allowed: 3, skipped: 4 });
});

test('a full all-styles × all-formats grid can never start more than the cap at once', () => {
	const gridSize = TRENDS.length * SOCIAL_FORMATS.length;
	assert.ok(gridSize > DOWNLOAD_BATCH_CAP, `expected the 120-card grid to exceed the cap, got ${gridSize}`);
	const plan = planDownloads(gridSize);
	assert.equal(plan.allowed, DOWNLOAD_BATCH_CAP);
	assert.equal(plan.allowed + plan.skipped, gridSize);
});

test('socialAssetFilename ends with the format pixel size and the extension', () => {
	for (const format of SOCIAL_FORMATS) {
		const ref = { feature: 'feed', trend: 'bold-brutal' as const, format: format.key };
		const png = socialAssetFilename(ref, 'png');
		const svg = socialAssetFilename(ref, 'svg');
		assert.ok(png.endsWith(`-${format.width}x${format.height}.png`), png);
		assert.ok(svg.endsWith(`-${format.width}x${format.height}.svg`), svg);
		assert.ok(png.startsWith('thingtime-feed-bold-brutal-'), png);
		assert.match(png, /^[a-z0-9-]+\.png$/, 'filenames stay filesystem-safe');
	}
});

test('socialCaption carries the hook, the feature description and platform hashtags', () => {
	const samples = [
		{ feature: 'feed', trend: 'bold-brutal' as const, format: 'ig-square' },
		{ feature: FEATURES[0].key, trend: 'dark-neon' as const, format: 'x-post' },
		{ feature: FEATURES[FEATURES.length - 1].key, trend: 'listicle' as const, format: 'linkedin' }
	];
	for (const ref of samples) {
		const caption = socialCaption(ref);
		const feature = getFeature(ref.feature);
		const platform = PLATFORM_FOR_FORMAT[ref.format];
		assert.ok(caption.includes(feature.description), `caption for ${ref.feature} lacks its description`);
		const tags = caption.match(/#[a-z0-9]+/gi) ?? [];
		assert.ok(tags.length >= 3, `caption for ${ref.format} has too few hashtags: ${tags.length}`);
		for (const tag of tags) assert.ok(HASHTAGS[platform].includes(tag), `${tag} is not a ${platform} hashtag`);
		assert.ok(caption.split('\n\n').length >= 3, 'caption keeps hook / body / cta+tags paragraphs');
	}
	const a = socialCaption({ feature: 'feed', trend: 'bold-brutal', format: 'ig-square' });
	assert.equal(a, socialCaption({ feature: 'feed', trend: 'bold-brutal', format: 'ig-square' }), 'captions are deterministic');
});

test('copyText returns false instead of throwing when neither clipboard nor document exist', async () => {
	assert.equal(typeof document, 'undefined', 'this test expects to run without a DOM');
	await withNavigator(undefined, async () => {
		assert.equal(await copyText('hello'), false);
	});
	await withNavigator({}, async () => {
		assert.equal(await copyText('hello'), false, 'a navigator without a clipboard falls through to the (absent) DOM path');
	});
});

test('copyText prefers the async clipboard and survives a rejecting one', async () => {
	const written: string[] = [];
	await withNavigator({ clipboard: { writeText: async (text: string) => void written.push(text) } }, async () => {
		assert.equal(await copyText('caption text'), true);
	});
	assert.deepEqual(written, ['caption text']);
	await withNavigator(
		{
			clipboard: {
				writeText: async () => {
					throw new Error('NotAllowedError');
				}
			}
		},
		async () => {
			assert.equal(await copyText('blocked'), false, 'a blocked clipboard with no DOM fallback resolves false');
		}
	);
});

test('downloadSequentially runs in order, counts failures and never throws', async () => {
	const seen: number[] = [];
	const progress: [number, number][] = [];
	const result = await downloadSequentially(
		['a', 'b', 'c', 'd'],
		async (item, index) => {
			seen.push(index);
			if (item === 'b' || item === 'd') throw new Error(`boom ${item}`);
		},
		0,
		(done, total) => progress.push([done, total])
	);
	assert.deepEqual(result, { done: 2, failed: 2 });
	assert.deepEqual(seen, [0, 1, 2, 3]);
	assert.deepEqual(progress, [
		[1, 4],
		[2, 4],
		[3, 4],
		[4, 4]
	]);
	assert.deepEqual(await downloadSequentially([], async () => {}, 0), { done: 0, failed: 0 });
});

test('downloadSequentially waits between items and tolerates a throwing progress listener', async () => {
	const started = Date.now();
	const result = await downloadSequentially(
		[1, 2, 3],
		async () => {},
		20,
		() => {
			throw new Error('listener bug');
		}
	);
	assert.deepEqual(result, { done: 3, failed: 0 });
	assert.ok(Date.now() - started >= 35, 'two 20ms pauses separate three downloads');
});

test('the DOM helpers are inert on the server and reject with a readable Error', async () => {
	assert.doesNotThrow(() => triggerDownload(new Blob(['x']), 'x.txt'));
	assert.doesNotThrow(() => downloadSvg('<svg xmlns="http://www.w3.org/2000/svg"/>', 'x.svg'));
	await assert.rejects(rasteriseSvg('<svg xmlns="http://www.w3.org/2000/svg"/>', 10, 10), (error: unknown) => {
		assert.ok(error instanceof Error);
		assert.match(error.message, /browser/i);
		return true;
	});
	await assert.rejects(downloadPng('<svg xmlns="http://www.w3.org/2000/svg"/>', 10, 10, 'x.png'), /browser/i);
});
