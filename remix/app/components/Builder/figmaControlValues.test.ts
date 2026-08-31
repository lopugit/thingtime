import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collapseShorthand, expandShorthand, parseBorder, parseShadow } from './figmaControlValues';
import { editorJsToHtml } from './editorJsHtml';

test('expandShorthand follows the css fallback chain', () => {
	assert.deepEqual(expandShorthand(''), ['', '', '', '']);
	assert.deepEqual(expandShorthand('8px'), ['8px', '8px', '8px', '8px']);
	assert.deepEqual(expandShorthand('8px 16px'), ['8px', '16px', '8px', '16px']);
	assert.deepEqual(expandShorthand('1px 2px 3px'), ['1px', '2px', '3px', '2px']);
	assert.deepEqual(expandShorthand('1px 2px 3px 4px'), ['1px', '2px', '3px', '4px']);
});

test('collapseShorthand emits the shortest equivalent form', () => {
	assert.equal(collapseShorthand('', '', '', ''), '');
	assert.equal(collapseShorthand('8px', '8px', '8px', '8px'), '8px');
	assert.equal(collapseShorthand('8px', '16px', '8px', '16px'), '8px 16px');
	assert.equal(collapseShorthand('1px', '2px', '3px', '2px'), '1px 2px 3px');
	assert.equal(collapseShorthand('1px', '2px', '3px', '4px'), '1px 2px 3px 4px');
	// empties fill as 0 so a partial edit still writes valid css
	assert.equal(collapseShorthand('4px', '', '', ''), '4px 0 0');
});

test('shorthand round-trips', () => {
	for (const value of ['12px', '4px 8px', '1em 2em 3em', '1px 2px 3px 4px']) {
		assert.equal(collapseShorthand(...expandShorthand(value)), value);
	}
});

test('functional css values stay whole through expansion', () => {
	// calc() contains spaces — a naive whitespace split would shred it
	assert.deepEqual(expandShorthand('calc(100% - 20px)'), [
		'calc(100% - 20px)',
		'calc(100% - 20px)',
		'calc(100% - 20px)',
		'calc(100% - 20px)'
	]);
	assert.equal(collapseShorthand(...expandShorthand('calc(100% - 20px)')), 'calc(100% - 20px)');
	assert.deepEqual(expandShorthand('calc(1em + 2px) 8px'), ['calc(1em + 2px)', '8px', 'calc(1em + 2px)', '8px']);
	// space-separated functional colors keep their digits out of border width
	assert.deepEqual(parseBorder('solid rgb(0 0 0 / 50%)'), { width: '', style: 'solid', color: 'rgb(0 0 0 / 50%)' });
});

test('parseBorder splits width/style/color regardless of order', () => {
	assert.deepEqual(parseBorder('1px solid #ececef'), { width: '1px', style: 'solid', color: '#ececef' });
	assert.deepEqual(parseBorder('dashed 2px hotpink'), { width: '2px', style: 'dashed', color: 'hotpink' });
	assert.deepEqual(parseBorder(''), { width: '', style: '', color: '' });
	// rgba() colors stay whole — their numbers must never leak into width
	assert.deepEqual(parseBorder('solid rgba(0, 0, 0, 0.5)'), { width: '', style: 'solid', color: 'rgba(0, 0, 0, 0.5)' });
	assert.deepEqual(parseBorder('2px solid rgba(255, 0, 128, 0.9)'), {
		width: '2px',
		style: 'solid',
		color: 'rgba(255, 0, 128, 0.9)'
	});
});

test('parseShadow keeps rgba() colors whole', () => {
	assert.deepEqual(parseShadow('0 4px 12px 0 rgba(0, 0, 0, 0.12)'), {
		x: '0',
		y: '4px',
		blur: '12px',
		spread: '0',
		color: 'rgba(0, 0, 0, 0.12)'
	});
	assert.deepEqual(parseShadow('2px 2px hotpink'), { x: '2px', y: '2px', blur: '', spread: '', color: 'hotpink' });
});

test('editorJsToHtml renders the core block vocabulary', () => {
	const html = editorJsToHtml({
		blocks: [
			{ type: 'header', data: { text: 'Hello', level: 2 } },
			{ type: 'paragraph', data: { text: 'Body with <b>bold</b>' } },
			{ type: 'list', data: { style: 'unordered', items: [{ content: 'one', items: [] }, 'two'] } },
			{ type: 'quote', data: { text: 'wise words', caption: 'someone' } },
			{ type: 'code', data: { code: '<script>alert(1)</script>' } },
			{ type: 'delimiter', data: {} },
			{ type: 'table', data: { withHeadings: true, content: [['H1', 'H2'], ['a', 'b']] } }
		]
	});
	assert.ok(html.includes('<h2>Hello</h2>'));
	assert.ok(html.includes('<b>bold</b>'));
	assert.ok(html.includes('<li>one</li>'));
	assert.ok(html.includes('<li>two</li>'));
	assert.ok(html.includes('<footer>someone</footer>'));
	// code blocks ESCAPE their contents — a pasted script stays text
	assert.ok(html.includes('&lt;script&gt;'));
	assert.ok(!html.includes('<script>'));
	assert.ok(html.includes('<hr>'));
	assert.ok(html.includes('<th>H1</th>'));
	assert.ok(html.includes('<td>b</td>'));
});
