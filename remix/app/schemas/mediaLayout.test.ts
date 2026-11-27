import assert from 'node:assert/strict';
import test from 'node:test';

import { validateThingtimeCrystal } from './registry.ts';

// crystal.mediaLayout — the owner-chosen gallery layout for a post's visual
// attachments. Post-LEVEL presentation data with validated shapes; absent means
// the automatic masonry default, so every legacy post crystal must stay valid.

const basePost = { type: 'text', text: 'hello' };

const validatePost = (mediaLayout: unknown) => validateThingtimeCrystal(['post'], { ...basePost, mediaLayout });

const crystalOf = (result: ReturnType<typeof validateThingtimeCrystal>): Record<string, any> => {
	assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result)}`);
	return (result as { ok: true; crystal: Record<string, any> }).crystal;
};

test('legacy and Auto post crystals stay valid with mediaLayout absent', () => {
	const crystal = crystalOf(validateThingtimeCrystal(['post'], basePost));
	assert.equal('mediaLayout' in crystal, false);
	assert.equal('mediaLayout' in crystalOf(validatePost(null)), false);
});

test('masonry mode stores only the mode', () => {
	const crystal = crystalOf(validatePost({ mode: 'masonry', pattern: [1, 2], columns: 4, junk: true }));
	assert.deepEqual(crystal.mediaLayout, { mode: 'masonry' });
});

test('rows mode keeps a positive integer pattern and strips unknown keys', () => {
	const crystal = crystalOf(validatePost({ mode: 'rows', pattern: [1, 2, 3], columns: 4, junk: 'x' }));
	assert.deepEqual(crystal.mediaLayout, { mode: 'rows', pattern: [1, 2, 3] });
});

test('rows mode rejects missing and invalid patterns', () => {
	assert.equal(validatePost({ mode: 'rows' }).ok, false);
	assert.equal(validatePost({ mode: 'rows', pattern: [] }).ok, false);
	assert.equal(validatePost({ mode: 'rows', pattern: [0] }).ok, false);
	assert.equal(validatePost({ mode: 'rows', pattern: [Number.POSITIVE_INFINITY] }).ok, false);
	assert.equal(validatePost({ mode: 'rows', pattern: [1.5] }).ok, false);
	assert.equal(validatePost({ mode: 'rows', pattern: ['2'] }).ok, false);
	assert.equal(validatePost({ mode: 'rows', pattern: [true] }).ok, false);
	assert.equal(validatePost({ mode: 'rows', pattern: ['two'] }).ok, false);
});

test('grid mode defaults to 3 columns and validates explicit positive integers', () => {
	assert.deepEqual(crystalOf(validatePost({ mode: 'grid' })).mediaLayout, { mode: 'grid', columns: 3 });
	assert.deepEqual(crystalOf(validatePost({ mode: 'grid', columns: 6 })).mediaLayout, { mode: 'grid', columns: 6 });
	assert.equal(validatePost({ mode: 'grid', columns: 0 }).ok, false);
	assert.equal(validatePost({ mode: 'grid', columns: Number.POSITIVE_INFINITY }).ok, false);
	assert.equal(validatePost({ mode: 'grid', columns: 2.5 }).ok, false);
	assert.equal(validatePost({ mode: 'grid', columns: '2' }).ok, false);
	assert.equal(validatePost({ mode: 'grid', columns: true }).ok, false);
	assert.equal(validatePost({ mode: 'grid', columns: null }).ok, false);
});

test('grid spans are enum-valued, and drop redundant normal entries', () => {
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

test('grid spans reject bad values and bad keys', () => {
	assert.equal(validatePost({ mode: 'grid', spans: { att_a: 'huge' } }).ok, false);
	assert.equal(validatePost({ mode: 'grid', spans: { ['x'.repeat(129)]: 'wide' } }).ok, false);
	assert.equal(validatePost({ mode: 'grid', spans: { 'att.with.path': 'wide' } }).ok, false);
	assert.equal(validatePost({ mode: 'grid', spans: { '$attachment': 'wide' } }).ok, false);
	assert.equal(validatePost({ mode: 'grid', spans: { ['__proto__']: 'wide' } }).ok, false);
	assert.equal(validatePost({ mode: 'grid', spans: ['wide'] }).ok, false);
});

test('non-object payloads and unknown modes fail', () => {
	assert.equal(validatePost('grid').ok, false);
	assert.equal(validatePost(['grid']).ok, false);
	assert.equal(validatePost({ mode: 'diagonal' }).ok, false);
	assert.equal(validatePost({}).ok, false);
});


test('gallery metadata preserves more than 25 rows/spans and more than six tracks', () => {
 const pattern = Array.from({ length: 27 }, (_, index) => index + 7);
 assert.deepEqual(crystalOf(validatePost({ mode: 'rows', pattern })).mediaLayout.pattern, pattern);
 const spans = Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`att_${index}`, 'wide']));
 assert.deepEqual(crystalOf(validatePost({ mode: 'grid', columns: 9, spans })).mediaLayout, { mode: 'grid', columns: 9, spans });
});
