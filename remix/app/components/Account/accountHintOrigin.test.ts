import assert from 'node:assert/strict';
import test from 'node:test';

import { accountHintOriginPresentation, accountHintOriginsSummary } from './accountHintOrigin';

test('account hints identify the deploy environment from their displayed origin', () => {
	assert.deepEqual(accountHintOriginPresentation('https://thingtime.com'), {
		origin: 'https://thingtime.com',
		host: 'thingtime.com',
		environment: 'Production'
	});
	assert.equal(accountHintOriginPresentation('https://pr-68.previews.dev.thingtime.com').environment, 'Dev preview · PR #68');
	assert.equal(accountHintOriginPresentation('https://develop.thingtime.com').environment, 'Develop');
	assert.equal(accountHintOriginPresentation('http://127.0.0.1:9999').environment, 'Local');
});

test('account hint summaries de-duplicate matching deployment environments', () => {
	assert.equal(
		accountHintOriginsSummary([
			{ origin: 'https://pr-68.previews.dev.thingtime.com' },
			{ origin: 'https://pr-68.previews.dev.thingtime.com' },
			{ origin: 'https://thingtime.com' }
		]),
		'Dev preview · PR #68, Production'
	);
});
