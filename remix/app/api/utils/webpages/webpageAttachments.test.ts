import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractWebpageAttachmentIds } from './webpageAttachments';

// Webpage saves bind referenced builder uploads (media srcs + content URLs
// inside rich/raw html) so the draft reaper can't break a saved page's media.

test('extracts full-length production ids (att_ + sha256 hex = 68 chars) without truncation', () => {
	const realId = `att_${'a1b2c3d4'.repeat(8)}`;
	assert.equal(realId.length, 68);
	const ids = extractWebpageAttachmentIds({
		blocks: [{ id: 'm', type: 'media', src: `/api/v1/attachments/content?id=${realId}` }]
	});
	assert.deepEqual(ids, [realId]);
});

test('extracts attachment ids from media srcs, html, and nested children', () => {
	const ids = extractWebpageAttachmentIds({
		blocks: [
			{ id: 'm1', type: 'media', src: '/api/v1/attachments/content?id=att_aaaaaaaabbbbbbbb' },
			{ id: 'h1', type: 'html', html: '<img src="/api/v1/attachments/content?id=att_ccccccccdddddddd"> and <img src="https://elsewhere.example/x.png">' },
			{
				id: 'box',
				type: 'container',
				children: [
					{ id: 'm2', type: 'media', src: '/api/v1/attachments/content?id=att_eeeeeeeeffffffff' },
					{ id: 't1', type: 'text', text: 'plain', html: 'rich <b>text</b> without media' }
				]
			},
			// duplicates collapse
			{ id: 'm3', type: 'media', src: '/api/v1/attachments/content?id=att_aaaaaaaabbbbbbbb' }
		]
	});
	assert.deepEqual(ids.sort(), ['att_aaaaaaaabbbbbbbb', 'att_ccccccccdddddddd', 'att_eeeeeeeeffffffff']);
});

test('extracts ids from component arg values and per-block custom css', () => {
	// the inspector is where an author pastes the URL the builder just minted —
	// an arg or a css background reaps exactly like an unbound media src
	const ids = extractWebpageAttachmentIds({
		blocks: [
			{
				id: 'c1',
				type: 'component',
				component: 'thingtime-card',
				args: { imageUrl: '/api/v1/attachments/content?id=att_aaaaaaaabbbbbbbb', label: 'no media here', count: 3 }
			},
			{
				id: 'box',
				type: 'container',
				css: { 'background-image': 'url(/api/v1/attachments/content?id=att_ccccccccdddddddd)' },
				children: [{ id: 't1', type: 'text', text: 'hi' }]
			}
		]
	});
	assert.deepEqual(ids.sort(), ['att_aaaaaaaabbbbbbbb', 'att_ccccccccdddddddd']);
});

test('ignores external, relative-non-content, and malformed references', () => {
	assert.deepEqual(
		extractWebpageAttachmentIds({
			blocks: [
				{ id: 'a', type: 'media', src: 'https://example.com/pic.png' },
				{ id: 'b', type: 'media', src: '/some/other/path?id=att_zzzz' },
				{ id: 'c', type: 'media', src: '/api/v1/attachments/content?id=short' },
				{ id: 'd', type: 'media' }
			]
		}),
		[]
	);
	assert.deepEqual(extractWebpageAttachmentIds(null), []);
	assert.deepEqual(extractWebpageAttachmentIds({}), []);
	assert.deepEqual(extractWebpageAttachmentIds({ blocks: 'nope' }), []);
});

test('caps the id list at the per-target maximum', () => {
	const blocks = Array.from({ length: 40 }, (_, index) => ({
		id: `m${index}`,
		type: 'media',
		src: `/api/v1/attachments/content?id=att_${String(index).padStart(12, '0')}`
	}));
	assert.equal(extractWebpageAttachmentIds({ blocks }).length, 25);
});
