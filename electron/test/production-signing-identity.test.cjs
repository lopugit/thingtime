'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const helper = import('../scripts/production-signing-identity.mjs');
const identity = 'Developer ID Application: Example Company (TEAM123456)';
const development = 'Apple Development: Example Company (TEAM123456)';
const identities = `1) 0123456789 "${development}"\n2) ABCDEF0123 "${identity}"\n2 valid identities found`;

test('production selects Developer ID while giving electron-builder its accepted qualifier', async () => {
	const { productionSigningIdentity } = await helper;
	for (const requested of ['', identity]) {
		const selected = productionSigningIdentity(identities, requested);
		assert.equal(selected.identity, identity, 'Native codesign keeps the exact certificate identity');
		assert.equal(selected.qualifier, 'Example Company (TEAM123456)', 'electron-builder requires an unprefixed name including the team');
	}
});

test('production refuses missing, development, ad-hoc or unverified certificate choices', async () => {
	const { productionSigningIdentity } = await helper;
	for (const requested of [development, '-', 'Example Company (TEAM123456)', 'Developer ID Application: Other Company (OTHERTEAM1)']) {
		assert.throws(() => productionSigningIdentity(identities, requested), /Production release is blocked/u);
	}
	assert.throws(() => productionSigningIdentity(`1) ABCDEF "${development}"`), /Production release is blocked/u);
	assert.throws(() => productionSigningIdentity('1) ABCDEF "Developer ID Application:"'), /no certificate name/u);
});
