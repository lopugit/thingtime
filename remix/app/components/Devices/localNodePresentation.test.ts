import assert from 'node:assert/strict';
import test from 'node:test';

import { PASTEL_PAIRED_ACCOUNT_BADGE_STYLE, localNodeActionIsBusy, localNodeActionKey, localNodeBadgePresentation } from './localNodePresentation';

test('background node checking preserves the last-known paired badge', () => {
	assert.deepEqual(
		localNodeBadgePresentation({
			checking: true,
			paired: true,
			pairedAccountCount: 2,
			pairedToCurrentAccount: true,
			recoverablePairing: false,
			registered: true
		}),
		{
			colorScheme: 'green',
			label: '2 accounts paired',
			showChecking: true
		}
	);
});

test('only the action that is actually pending becomes busy', () => {
	const pending = [localNodeActionKey('register-project', 'local-codex-project')];
	assert.equal(localNodeActionIsBusy(pending, 'register-project', 'local-codex-project'), true);
	assert.equal(localNodeActionIsBusy(pending, 'begin-pairing', 'onboarding-pairing'), false);
	assert.equal(localNodeActionIsBusy([], 'register-project', 'local-codex-project'), false);
});

test('paired-account badge has a fixed pastel-green presentation independent of the active Chakra theme', () => {
	assert.deepEqual(PASTEL_PAIRED_ACCOUNT_BADGE_STYLE, {
		backgroundColor: '#e2f8e8',
		borderColor: '#b8e8c5',
		color: '#23633c'
	});
});
