import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_MEDIA_LAYOUT_ENTRIES, MAX_MEDIA_LAYOUT_TRACK, validateThingtimeCrystal } from './registry.ts';

// crystal.mediaLayout — the owner-chosen gallery layout for a post's visual
// attachments. Post-LEVEL presentation data with strict bounds; absent means
// the automatic masonry default, so every legacy post crystal must stay valid.

const basePost = { type: 'text', text: 'hello' };

const validatePost = (mediaLayout: unknown) => validateThingtimeCrystal(['post'], { ...basePost, mediaLayout });

const crystalOf = (result: ReturnType<typeof validateThingtimeCrystal>): Record<string, any> => {
	assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result)}`);
	return (result as { ok: true; crystal: Record<string, any> }).crystal;
};

test('legacy post crystals without mediaLayout stay valid and normalize to null', () => {
	const crystal = crystalOf(validateThingtimeCrystal(['post'], basePost));
	assert.equal(crystal.mediaLayout, null);
	assert.equal(crystalOf(validatePost(null)).mediaLayout, null);
});

test('masonry mode stores only the mode', () => {
	const crystal = crystalOf(validatePost({ mode: 'masonry', pattern: [1, 2], columns: 4, junk: true }));
	assert.deepEqual(crystal.mediaLayout, { mode: 'masonry' });
});

test('rows mode keeps a bounded integer pattern and strips unknown keys', () => {
	const crystal = crystalOf(validatePost({ mode: 'rows', pattern: [1, 2, 3], columns: 4, junk: 'x' }));
	assert.deepEqual(crystal.mediaLayout, { mode: 'rows', pattern: [1, 2, 3] });
});

test('rows mode rejects missing, oversize, and out-of-range patterns', () => {
	assert.equal(validatePost({ mode: 'rows' }).ok, false);
	assert.equal(validatePost({ mode: 'rows', pattern: [] }).ok, false);
	assert.equal(validatePost({ mode: 'rows', pattern: Array(MAX_MEDIA_LAYOUT_ENTRIES + 1).fill(1) }).ok, false);
	assert.equal(validatePost({ mode: 'rows', pattern: [0] }).ok, false);
	assert.equal(validatePost({ mode: 'rows', pattern: [MAX_MEDIA_LAYOUT_TRACK + 1] }).ok, false);
	assert.equal(validatePost({ mode: 'rows', pattern: [1.5] }).ok, false);
	assert.equal(validatePost({ mode: 'rows', pattern: ['two'] }).ok, false);
});

test('grid mode defaults to 3 columns and bounds explicit ones', () => {
	assert.deepEqual(crystalOf(validatePost({ mode: 'grid' })).mediaLayout, { mode: 'grid', columns: 3 });
	assert.deepEqual(crystalOf(validatePost({ mode: 'grid', columns: 6 })).mediaLayout, { mode: 'grid', columns: 6 });
	assert.equal(validatePost({ mode: 'grid', columns: 0 }).ok, false);
	assert.equal(validatePost({ mode: 'grid', columns: MAX_MEDIA_LAYOUT_TRACK + 1 }).ok, false);
	assert.equal(validatePost({ mode: 'grid', columns: 2.5 }).ok, false);
});

test('grid spans are bounded, enum-valued, and drop redundant normal entries', () => {
	const crystal = crystalOf(
		validatePost({ mode: 'grid', columns: 2, spans: { att_a: 'wide', att_b: 'normal', att_c: 'big' } })
	);
	assert.deepEqual(crystal.mediaLayout, { mode: 'grid', columns: 2, spans: { att_a: 'wide', att_c: 'big' } });
	// all-normal spans collapse away entirely
	assert.deepEqual(crystalOf(validatePost({ mode: 'grid', columns: 2, spans: { att_a: 'normal' } })).mediaLayout, {
		mode: 'grid',
		columns: 2
	});
});

test('grid spans reject oversize maps, bad values, and bad keys', () => {
	const oversized: Record<string, string> = {};
	for (let index = 0; index <= MAX_MEDIA_LAYOUT_ENTRIES; index += 1) oversized[`att_${index}`] = 'wide';
	assert.equal(validatePost({ mode: 'grid', spans: oversized }).ok, false);
	assert.equal(validatePost({ mode: 'grid', spans: { att_a: 'huge' } }).ok, false);
	assert.equal(validatePost({ mode: 'grid', spans: { ['x'.repeat(201)]: 'wide' } }).ok, false);
	assert.equal(validatePost({ mode: 'grid', spans: ['wide'] }).ok, false);
});

test('non-object payloads and unknown modes fail', () => {
	assert.equal(validatePost('grid').ok, false);
	assert.equal(validatePost(['grid']).ok, false);
	assert.equal(validatePost({ mode: 'diagonal' }).ok, false);
	assert.equal(validatePost({}).ok, false);
});
