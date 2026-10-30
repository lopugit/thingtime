import assert from 'node:assert/strict';
import test from 'node:test';

import { SSO_HUB_DEVELOP, SSO_HUB_PRODUCTION, resolveSsoHub, ssoHubDisplayName } from './ssoHub';

test('Vercel previews use the development Thingtime authority', () => {
	assert.equal(resolveSsoHub({ branch: 'codex/account-hint-environment-labels', vercelEnv: 'preview' }), SSO_HUB_DEVELOP);
	assert.equal(resolveSsoHub({ branch: 'develop', vercelEnv: 'development' }), SSO_HUB_DEVELOP);
});

test('an explicit data environment wins over Vercel deployment metadata', () => {
	assert.equal(
		resolveSsoHub({
			branch: 'main',
			vercelEnv: 'production',
			dataEnvironment: { kind: 'development', authorityOrigin: 'https://dev.thingtime.com' }
		}),
		SSO_HUB_DEVELOP
	);
	assert.equal(
		resolveSsoHub({ dataEnvironment: { kind: 'custom', authorityOrigin: 'https://demo.thingtime.com' } }),
		'https://demo.thingtime.com'
	);
	assert.equal(resolveSsoHub({ dataEnvironment: { kind: 'custom', authorityOrigin: null } }), null);
});

test('only production and main select the production Thingtime authority', () => {
	assert.equal(resolveSsoHub({ branch: 'main', vercelEnv: 'production' }), SSO_HUB_PRODUCTION);
	assert.equal(ssoHubDisplayName(SSO_HUB_DEVELOP), 'Dev Thingtime');
});

test('a valid local authority override wins and malformed overrides fail closed', () => {
	assert.equal(
		resolveSsoHub({ vercelEnv: 'preview' }, 'https://pr-373.previews.dev.thingtime.com/path'),
		'https://pr-373.previews.dev.thingtime.com'
	);
	assert.equal(resolveSsoHub({ vercelEnv: 'preview' }, 'ftp://invalid.example'), SSO_HUB_DEVELOP);
});
