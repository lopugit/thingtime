import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChakraProvider } from '@chakra-ui/react';
import { MemoryRouter } from 'react-router';
import { LopuToolCallRow } from './LopuToolCard';

test('history rows keep mobile summaries below the label without restoring actions', () => {
	for (const [ok, summary, status] of [
		[false, 'Waiting for the user’s confirmation: Post a contextual comment.', 'confirm'],
		[true, 'Saved a separate contextual comment; target content unchanged.', 'ok'],
		[false, 'Permission denied', 'error']
	] as const) {
		const html = renderToStaticMarkup(React.createElement(ChakraProvider, null,
			React.createElement(MemoryRouter, null, React.createElement(LopuToolCallRow, {
				call: { name: 'comment_on_thing', ok, summary, thingId: null }
			}))));
		assert.match(html, new RegExp(`data-status="${status}"`));
		assert.match(html, /grid-template-columns:auto minmax\(0, 1fr\) auto/);
		assert.match(html, /grid-column:1\s*\/\s*-1/);
		assert.match(html, /grid-row:2/);
		assert.doesNotMatch(html, /<button\b/);
	}
});


test('saved reference links render as native anchors with safe external targets', () => {
 const html = renderToStaticMarkup(React.createElement(ChakraProvider, null,
  React.createElement(MemoryRouter, null, React.createElement(LopuToolCallRow, {
   call: { name: 'get_page', ok: true, summary: 'Read page', thingId: null, links: [
    { label: 'Open page', href: '/builder?page=p1' },
    { label: 'Open specs', href: 'https://example.com/specs' },
    { label: 'Unsafe', href: 'javascript:alert(1)' }
   ] }
  }))));
 assert.match(html, /<a[^>]*href="\/builder\?page=p1"/);
 assert.match(html, /<a[^>]*href="https:\/\/example.com\/specs"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
 assert.doesNotMatch(html, /javascript:|Unsafe/);
});
