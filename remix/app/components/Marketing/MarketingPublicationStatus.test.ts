import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChakraProvider } from '@chakra-ui/react';
import { MarketingPublicationStatus } from './MarketingPublicationStatus';
import type { PublicationsSnapshot } from './marketingPublicationsStore';

const base: PublicationsSnapshot = {
	publications: { published: ['hub'], hidden: [], updatedAt: null },
	status: 'live', pending: 0, refreshing: false, error: null
};
const render = (state: PublicationsSnapshot) => renderToStaticMarkup(React.createElement(ChakraProvider, {}, React.createElement(MarketingPublicationStatus, { state, retry: () => {} })));

test('normal publication status has no extra message or retry control', () => {
	const html = render(base);
	assert.ok(!html.includes('marketing-publication-status'));
	assert.ok(!html.includes('>Retry<'));
});

test('degraded status explains saved visibility and exposes a keyboard-accessible retry', () => {
	const html = render({ ...base, status: 'degraded', error: 'Temporarily unavailable' });
	assert.ok(html.includes('role="status"'));
	assert.ok(html.includes('Publication status unavailable. Showing saved visibility.'));
	assert.match(html, /<button[^>]*>Retry<\/button>/);
	assert.ok(html.includes('aria-busy="false"'));
	let retries = 0;
	const element = MarketingPublicationStatus({ state: { ...base, status: 'degraded' }, retry: () => { retries += 1; } });
	const button = React.Children.toArray(element!.props.children).find(child => React.isValidElement<{ onClick?: () => void }>(child) && child.props.onClick) as React.ReactElement<{ onClick: () => void }>;
	button.props.onClick();
	assert.equal(retries, 1);
});

test('a cold error does not claim cached data, and an active retry has one inline spinner', () => {
	const failed = render({ ...base, publications: null, status: 'error', error: 'Temporarily unavailable' });
	assert.ok(failed.includes('Publication status unavailable.'));
	assert.ok(!failed.includes('Showing saved visibility.'));
	const refreshing = render({ ...base, status: 'degraded', refreshing: true });
	assert.ok(refreshing.includes('aria-busy="true"'));
	assert.ok(!refreshing.includes('>Retry<'));
	assert.equal((refreshing.match(/class="chakra-spinner /g) ?? []).length, 1);
});
