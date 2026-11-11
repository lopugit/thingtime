import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeEach, mock, test } from 'node:test';

import type { CredentialImportReceipt, CredentialImportTarget } from '../../../credentials/importContract.ts';
import { challengeForImportVerifier, fingerprintImportPayload } from './importCore.ts';

const context = { origin: 'https://fixture.test', environment: 'production' };
const actor = { accountId: randomUUID(), jti: randomUUID(), expiresAt: new Date(Date.now() + 60_000), characterRevision: null };
const verifier = randomBytes(32).toString('base64url'), requestId = randomUUID();
const target: CredentialImportTarget = {
	destination: 'admin-provider-vault', format: 'text', label: 'Fixture integration', environment: context.environment,
	overwrite: { mode: 'create' }
};
const receipt: CredentialImportReceipt = {
	credentialId: 'secret_fixture', label: target.label, environment: context.environment, format: 'text', updatedAt: new Date().toISOString()
};
let doc: Record<string, any>, sessionLive = true, adminLive = true, approveDuringRevoke = false, bytesRead = 0, writes = 0;
let sessionMeta: Record<string, unknown>, approvalFence = false, breakSessionFence = false, intentReads = 0;
const transaction = {};
const payload = 'fixture-text';
const source = async (text = payload) => { bytesRead++; return new TextEncoder().encode(text); };

mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: {
	getAuthOtpsCollection: async () => ({
		async findOne(filter: any) {
			intentReads++;
			return (!filter.origin || doc.origin === filter.origin) && (!filter['target.environment'] || doc.target.environment === filter['target.environment']) &&
				doc.challenge === filter.challenge && (!filter.expiresAt || doc.expiresAt > filter.expiresAt.$gt) &&
				(!filter.status || doc.status === filter.status) ? structuredClone(doc) : null;
		},
		async updateOne(filter: any, mutation: any) {
			if (doc.status !== filter.status) return { matchedCount: 0 };
			Object.assign(doc, mutation.$set); delete doc.approval;
			return { matchedCount: 1 };
		},
		async findOneAndUpdate(filter: any, mutation: any, options: any) {
			if (approveDuringRevoke) doc.status = 'approved';
			const match = typeof filter.status === 'string' ? doc.status === filter.status : filter.status.$in.includes(doc.status);
			if (!match) return null;
			if (mutation.$set.status === 'approved') {
				assert.equal(options.session, transaction);
				assert.equal(approvalFence, true);
			}
			Object.assign(doc, mutation.$set);
			return structuredClone(doc);
		}
	}),
	getSessionsCollection: async () => ({ updateOne: async (filter: any, _mutation: unknown, options: any) => {
		assert.equal(options.session, transaction);
		assert.equal(filter['meta.characterSelectionRevision'], sessionMeta.characterSelectionRevision ?? null);
		return { matchedCount: sessionLive && !breakSessionFence ? 1 : 0 };
	} }),
	withHomeMongoTransaction: async (work: (session: object) => unknown) => work(transaction)
} });
mock.module(new URL('../auth/sessions.ts', import.meta.url).href, { namedExports: {
	getLiveSession: async () => sessionLive ? { userId: actor.accountId, purpose: 'browser', meta: sessionMeta } : null
} });
mock.module(new URL('../auth/users.ts', import.meta.url).href, { namedExports: {
	findUserById: async () => ({ meta: { admin: adminLive } }),
	fenceCurrentAdminCredentialImport: async (_id: string, session: unknown) => {
		assert.equal(session, transaction); approvalFence = true; return adminLive;
	}
} });
mock.module(new URL('../auth/getCurrentUser.ts', import.meta.url).href, { namedExports: {
	resolveSessionUser: async (_jti: string, _id: string, requestedCharacter: unknown) => {
		assert.equal(requestedCharacter, null);
		return { id: actor.accountId, isAdmin: adminLive, accountKind: 'user' };
	},
	serviceAccountAuthenticationAllowed: () => true
} });
mock.module(new URL('../admin/integrations.ts', import.meta.url).href, { namedExports: {
	writeAdminCredentialImport: async () => { writes++; return receipt; },
	inspectAdminCredentialImport: async () => null
} });
mock.module(new URL('../auth/jwt.ts', import.meta.url).href, { namedExports: {
	verifyJwt: async () => ({ sub: actor.accountId, jti: actor.jti, exp: Math.floor(actor.expiresAt.getTime() / 1000) })
} });
mock.module(new URL('../auth/authCookie.ts', import.meta.url).href, { namedExports: {
	authCookie: { parse: async () => 'fixture' }, getAuthToken: async () => 'fixture'
} });
mock.module(new URL('../deployment/dataEnvironment.ts', import.meta.url).href, { namedExports: {
	getDeploymentDataEnvironment: () => ({ id: context.environment })
} });
mock.module(new URL('../rateLimit/enforce.ts', import.meta.url).href, { namedExports: {
	enforceFixedRateLimit: async () => ({ allowed: true }), rateLimitedResponseInit: () => ({})
} });
const { credentialImportAction } = await import('../../../routes/api/v1/credentials/import/credentialImportAction.ts');
const { browserCredentialImport, credentialImportStatus, importBrowserActor, uploadCredentialImport } = await import('./importService.ts');

beforeEach(() => {
	doc = {
		challenge: 'credential-import-v1:' + requestId, proofHash: challengeForImportVerifier(verifier),
		userId: actor.accountId, origin: context.origin, target, approvalDeadline: new Date(Date.now() + 10_000),
		expiresAt: new Date(Date.now() + 60_000), status: 'pending'
	};
	bytesRead = writes = intentReads = 0;
	sessionLive = adminLive = true; approveDuringRevoke = approvalFence = breakSessionFence = false; sessionMeta = {};
});

test('a wrong account or origin, missing proof, or pending/expired request never reads a credential', async () => {
	await assert.rejects(browserCredentialImport('approve', context, { ...actor, accountId: randomUUID() }, requestId), { code: 'not_found' });
	await assert.rejects(uploadCredentialImport({ ...context, origin: 'https://foreign.test' }, requestId, verifier, source), { code: 'not_found' });
	await assert.rejects(uploadCredentialImport(context, requestId, randomBytes(32).toString('base64url'), source), { code: 'not_found' });
	await assert.rejects(uploadCredentialImport(context, requestId, verifier, source), { code: 'pending' });
	doc.approvalDeadline = new Date(0);
	assert.deepEqual(await credentialImportStatus(context, requestId, verifier), { status: 'expired' });
	await assert.rejects(browserCredentialImport('approve', context, actor, requestId), { code: 'expired' });
	await assert.rejects(uploadCredentialImport(context, requestId, verifier, source), { code: 'expired' });
	assert.equal(bytesRead, 0); assert.equal(writes, 0);
});

test('explicit revocation wins a racing approval; logout and admin demotion invalidate an approved upload', async () => {
	approveDuringRevoke = true;
	assert.equal((await browserCredentialImport('revoke', context, actor, requestId)).status, 'revoked');
	await assert.rejects(uploadCredentialImport(context, requestId, verifier, source), { code: 'revoked' });
	doc.status = 'approved'; doc.approval = actor;
	sessionLive = false;
	assert.deepEqual(await credentialImportStatus(context, requestId, verifier), { status: 'revoked' });
	await assert.rejects(uploadCredentialImport(context, requestId, verifier, source), { code: 'revoked' });
	sessionLive = true; adminLive = false;
	await assert.rejects(uploadCredentialImport(context, requestId, verifier, source), { code: 'revoked' });
	assert.equal(bytesRead, 0); assert.equal(writes, 0);
});

test('an exact completed retry returns only the original receipt; different bytes cannot write', async () => {
	doc.status = 'completed'; doc.receipt = receipt;
	doc.fingerprint = fingerprintImportPayload(verifier, new TextEncoder().encode(payload));
	assert.deepEqual(await credentialImportStatus(context, requestId, verifier), { status: 'completed', receipt });
	assert.deepEqual(await uploadCredentialImport(context, requestId, verifier, source), receipt);
	await assert.rejects(uploadCredentialImport(context, requestId, verifier, () => source(payload + '\n')), { code: 'conflict' });
	assert.equal(writes, 0);
	doc.approvalDeadline = new Date(0);
	assert.deepEqual(await credentialImportStatus(context, requestId, verifier), { status: 'completed', receipt });
	await assert.rejects(uploadCredentialImport(context, requestId, verifier, source), { code: 'expired' });
});


const browserRequest = (character?: string) => new Request(context.origin, {
	method: 'POST', headers: {
		origin: context.origin, 'x-thingtime-expected-actor': actor.accountId,
		...(character === undefined ? {} : { 'x-thingtime-character': character })
	}
});

test('a Character header never restores admin import access while the session is switched', async () => {
	assert.equal((await importBrowserActor(browserRequest(actor.accountId), context.origin)).accountId, actor.accountId);
	await assert.rejects(importBrowserActor(browserRequest(randomUUID()), context.origin), { code: 'actor_changed' });
	sessionMeta.activeCharacterId = randomUUID();
	await assert.rejects(importBrowserActor(browserRequest(actor.accountId), context.origin), { code: 'actor_changed' });
	await assert.rejects(importBrowserActor(browserRequest(), context.origin), { code: 'actor_changed' });
});

test('approval is fenced at write time; switching away and back cannot revive a prior approval', async () => {
	breakSessionFence = true;
	await assert.rejects(browserCredentialImport('approve', context, actor, requestId), { code: 'revoked' });
	assert.equal(doc.status, 'pending');
	breakSessionFence = false;
	assert.equal((await browserCredentialImport('approve', context, actor, requestId)).status, 'approved');
	assert.equal(approvalFence, true);
	// No poll while away: returning to the owner on the same JTI still
	// carries a different canonical selection revision.
	sessionMeta.characterSelectionRevision = randomUUID();
	assert.deepEqual(await credentialImportStatus(context, requestId, verifier), { status: 'revoked' });
	assert.equal(doc.status, 'revoked');
	delete sessionMeta.characterSelectionRevision;
	await assert.rejects(uploadCredentialImport(context, requestId, verifier, source), { code: 'revoked' });
	assert.equal(bytesRead, 0);
});


test('status rejects oversized control bodies before intent lookup, including streamed bodies without a declared length', async () => {
	const status = credentialImportAction('status');
	const url = context.origin + '/api/v1/credentials/import/status';
	const headers = { 'content-type': 'application/json' };
	const valid = JSON.stringify({ requestId, verifier }, null, 2);
	const accepted = await status({ request: new Request(url, { method: 'POST', headers, body: valid }) });
	assert.deepEqual(await accepted.json(), { ok: true, status: 'pending' });
	assert.equal(intentReads, 1);

	let cancelled = false;
	const oversized = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(valid));
			controller.enqueue(new TextEncoder().encode(' '.repeat(1024)));
		},
		cancel() { cancelled = true; }
	});
	const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers, body: oversized, duplex: 'half' };
	const rejected = await status({ request: new Request(url, init) });
	assert.equal(rejected.status, 413);
	assert.match(rejected.headers.get('cache-control') ?? '', /no-store/);
	assert.deepEqual(await rejected.json(), { ok: false, code: 'too_large', error: 'The status control message exceeds 1 KiB.' });
	assert.equal(cancelled, true);
	assert.equal(intentReads, 1);
});
