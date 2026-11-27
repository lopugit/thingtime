import { BSON, ObjectId, type ClientSession } from 'mongodb';

import {
	CREDENTIAL_IMPORT_HEADERS, CREDENTIAL_IMPORT_PAGE_PATH,
	type CredentialImportIntent, type CredentialImportReceipt, type CredentialImportStart, type CredentialImportStatus, type CredentialImportTarget
} from '../../../credentials/importContract';
import { writeAdminCredentialImport } from '../admin/integrations';
import { isAdminDoc } from '../auth/admin';
import { authCookie } from '../auth/authCookie';
import { CHARACTER_HEADER } from '../auth/characterSession';
import { resolveSessionUser, serviceAccountAuthenticationAllowed } from '../auth/getCurrentUser';
import { verifyJwt } from '../auth/jwt';
import { getLiveSession } from '../auth/sessions';
import { fenceCurrentAdminCredentialImport, findUserById } from '../auth/users';
import { getAuthOtpsCollection, getSessionsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import {
	CREDENTIAL_IMPORT_BSON_LIMIT, CredentialImportError, challengeForImportVerifier, fingerprintImportPayload, importProofMatches, parseImportAccountId,
	parseImportProof, parseImportRequestId, parseImportTarget, prepareCredentialImport
} from './importCore';

const intentKind = 'credential-import-v1';
const approvalLifetime = 10 * 60_000;
const receiptLifetime = 60 * 60_000;
const lookup = (requestId: string) => ({ type: intentKind, challenge: `${intentKind}:${requestId}` });
const verifiedId = (value: unknown) => {
	const id = parseImportRequestId(value);
	if (!id) throw new CredentialImportError('invalid_request');
	return id;
};
type BrowserActor = { accountId: string; jti: string; expiresAt: Date; characterRevision: string | null };
const principalSelected = (accountId: string, meta: Record<string, unknown> | undefined) =>
	meta?.activeCharacterId == null || meta.activeCharacterId === accountId;
const selectionRevision = (meta: Record<string, unknown> | undefined) => meta?.characterSelectionRevision ?? null;
type ImportContext = { origin: string; environment: string };
type IntentDoc = {
	type: string;
	challenge: string;
	proofHash: string;
	userId: string;
	origin: string;
	target: CredentialImportTarget;
	approvalDeadline: Date;
	expiresAt: Date;
	createdAt: Date;
	consumedAt?: Date;
	status: Exclude<CredentialImportStatus, 'expired'>;
	approval?: BrowserActor;
	fingerprint?: string;
	receipt?: CredentialImportReceipt;
};

export const importBrowserActor = async (request: Request, origin: string): Promise<BrowserActor> => {
	if (request.headers.get('Origin') !== origin || ['cross-site', 'same-site'].includes(request.headers.get('Sec-Fetch-Site') ?? '')) {
		throw new CredentialImportError('origin_mismatch');
	}
	// Auth cookie only. A bearer, PAT, service, app, device, or switched
	// Character credential cannot approve a platform vault import.
	if (request.headers.has('Authorization')) throw new CredentialImportError('admin_required');
	const expected = parseImportAccountId(request.headers.get(CREDENTIAL_IMPORT_HEADERS.expectedActor));
	if (!expected) throw new CredentialImportError('actor_changed');
	const token = await authCookie.parse(request.headers.get('Cookie'));
	const claims = typeof token === 'string' ? await verifyJwt(token) : null;
	if (!claims || typeof claims.exp !== 'number') throw new CredentialImportError('unauthorized');
	const requestedCharacter = request.headers.get(CHARACTER_HEADER);
	if (claims.sub !== expected || (requestedCharacter !== null && requestedCharacter !== expected)) {
		throw new CredentialImportError('actor_changed');
	}
	const [session, user] = await Promise.all([
		getLiveSession(claims.jti),
		resolveSessionUser(claims.jti, claims.sub, null)
	]);
	if (session && !principalSelected(expected, session.meta)) throw new CredentialImportError('actor_changed');
	if (user && user.id !== expected) throw new CredentialImportError('actor_changed');
	if (!session || String(session.userId) !== expected || (session.purpose && session.purpose !== 'browser')
		|| !user?.isAdmin || user.isCharacter || user.temporary || user.accountKind === 'service') throw new CredentialImportError('admin_required');
	const characterRevision = selectionRevision(session.meta);
	if (characterRevision !== null && typeof characterRevision !== 'string') throw new CredentialImportError('actor_changed');
	return { accountId: expected, jti: claims.jti, expiresAt: new Date(claims.exp * 1000), characterRevision: typeof characterRevision === 'string' ? characterRevision : null };
};

const activeApproval = async (actor: BrowserActor | undefined): Promise<boolean> => {
	if (!actor || actor.expiresAt.getTime() <= Date.now()) return false;
	const [session, user] = await Promise.all([getLiveSession(actor.jti), findUserById(actor.accountId)]);
	return Boolean(session && String(session.userId) === actor.accountId && (!session.purpose || session.purpose === 'browser')
		&& principalSelected(actor.accountId, session.meta) && selectionRevision(session.meta) === actor.characterRevision
		&& user && !user.meta?.character && !user.meta?.temporary && user.accountKind !== 'service' && serviceAccountAuthenticationAllowed(user) && isAdminDoc(user));
};

// Fence the live approval against a concurrent logout/rotation. MongoDB checks
// writes to the session row for conflict with revocation before committing the
// same transaction that publishes the encrypted record and one-use receipt.
const requireLiveApprovalForWrite = async (actor: BrowserActor, session: ClientSession) => {
	if (!await activeApproval(actor)) throw new CredentialImportError('revoked');
	const now = new Date();
	if (actor.expiresAt <= now) throw new CredentialImportError('revoked');
	const matched = await (await getSessionsCollection()).updateOne({
		jti: actor.jti, userId: actor.accountId, revokedAt: null,
		'meta.characterSelectionRevision': actor.characterRevision,
		$and: [
			{ $or: [{ purpose: 'browser' }, { purpose: { $exists: false } }] },
			{ $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
			{ $or: [{ 'meta.activeCharacterId': null }, { 'meta.activeCharacterId': actor.accountId }] }
		]
	}, { $set: { 'meta.lastCredentialImportAt': now } }, { session });
	if (!matched.matchedCount || !await fenceCurrentAdminCredentialImport(actor.accountId, session)) throw new CredentialImportError('revoked');
};

const derivedStatus = async (doc: IntentDoc, persistRevocation = true): Promise<CredentialImportStatus> => {
	if (doc.status === 'completed' || doc.status === 'revoked') return doc.status;
	if (doc.approvalDeadline.getTime() <= Date.now()) return 'expired';
	if (doc.status === 'approved' && !await activeApproval(doc.approval)) {
		if (persistRevocation) {
			const collection = await getAuthOtpsCollection();
			const identity = { type: intentKind, challenge: doc.challenge };
			const revoked = await collection.updateOne({ ...identity, status: 'approved' }, {
				$set: { status: 'revoked' }, $unset: { approval: '' }
			});
			// A completed transaction may have won before the observed session
			// invalidation; report its authoritative receipt instead of failure.
			if (!revoked.matchedCount) {
				const latest = await collection.findOne({ ...identity, status: 'completed' }) as IntentDoc | null;
				if (latest) {
					doc.receipt = latest.receipt;
					return 'completed';
				}
			}
		}
		return 'revoked';
	}
	return doc.status;
};

const loadIntent = async (context: ImportContext, id: string, session?: ClientSession): Promise<IntentDoc> => {
	const doc = await (await getAuthOtpsCollection()).findOne({
		...lookup(id), origin: context.origin, 'target.environment': context.environment,
		expiresAt: { $gt: new Date() }
	}, { session }) as IntentDoc | null;
	if (!doc) throw new CredentialImportError('not_found');
	return doc;
};

const authorizeProof = (doc: IntentDoc, input: unknown) => {
	const verifier = parseImportProof(input);
	if (!verifier || !importProofMatches(doc.proofHash, challengeForImportVerifier(verifier))) throw new CredentialImportError('not_found');
	return verifier;
};

export const startCredentialImport = async (
	context: ImportContext, input: { requestId?: unknown; expectedAccountId?: unknown; challenge?: unknown; target?: unknown }
): Promise<CredentialImportStart> => {
	const requestId = verifiedId(input.requestId);
	const userId = parseImportAccountId(input.expectedAccountId);
	const proofHash = parseImportProof(input.challenge);
	if (!userId || !proofHash) throw new CredentialImportError('invalid_request');
	const target = parseImportTarget(input.target, context.origin, context.environment);
	const collection = await getAuthOtpsCollection();
	const createdAt = new Date();
	const document: IntentDoc = {
		...lookup(requestId), proofHash, userId, origin: context.origin, target, createdAt,
		status: 'pending', approvalDeadline: new Date(createdAt.getTime() + approvalLifetime),
		expiresAt: new Date(createdAt.getTime() + approvalLifetime)
	};
	// Include the ObjectId that MongoDB generates for an upsert.
	if (BSON.calculateObjectSize({ ...document, _id: new ObjectId() }) > CREDENTIAL_IMPORT_BSON_LIMIT) {
		throw new CredentialImportError('too_large');
	}
	const filter = lookup(requestId);
	let existing: IntentDoc | null;
	try {
		existing = await collection.findOneAndUpdate(filter, { $setOnInsert: document }, { upsert: true, returnDocument: 'after' }) as IntentDoc | null;
	} catch (error) {
		if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 11000) throw error;
		existing = await collection.findOne(filter) as IntentDoc | null;
	}
	if (!existing || existing.origin !== context.origin || existing.userId !== userId
		|| !importProofMatches(existing.proofHash, proofHash) || JSON.stringify(existing.target) !== JSON.stringify(target)) {
		throw new CredentialImportError('conflict');
	}
	const verificationUrl = new URL(CREDENTIAL_IMPORT_PAGE_PATH, context.origin);
	verificationUrl.searchParams.set('requestId', requestId);
	return { requestId, expiresAt: existing.approvalDeadline.toISOString(), verificationUrl: verificationUrl.href };
};

export const browserCredentialImport = async (
	operation: 'inspect' | 'approve' | 'revoke',
	context: ImportContext,
	actor: BrowserActor,
	requestId: unknown
): Promise<CredentialImportIntent> => {
	const id = verifiedId(requestId);
	const filter = { ...lookup(id), userId: actor.accountId, origin: context.origin };
	const ownerDocument = async (session?: ClientSession) => {
		const doc = await loadIntent(context, id, session);
		if (doc.userId !== actor.accountId) throw new CredentialImportError('not_found');
		return doc;
	};
	let doc = await ownerDocument();
	if (operation === 'approve') {
		const status = await derivedStatus(doc);
		if (status === 'expired' || status === 'revoked') throw new CredentialImportError(status);
		if (status === 'pending') {
			doc = await withHomeMongoTransaction(async session => {
				const current = await ownerDocument(session);
				if (current.status !== 'pending') return current;
				await requireLiveApprovalForWrite(actor, session);
				const saved = await (await getAuthOtpsCollection()).findOneAndUpdate({
					...filter, status: 'pending', approvalDeadline: { $gt: new Date() }
				}, { $set: { status: 'approved', approval: actor } }, { session, returnDocument: 'after' }) as IntentDoc | null;
				if (!saved) throw new CredentialImportError('expired');
				return saved;
			});
		}
	} else if (operation === 'revoke' && ['pending', 'approved'].includes(doc.status)) {
		const saved = await (await getAuthOtpsCollection()).findOneAndUpdate({
			...filter, status: { $in: ['pending', 'approved'] }
		}, { $set: { status: 'revoked' }, $unset: { approval: '' } }, { returnDocument: 'after' }) as IntentDoc | null;
		doc = saved ?? await ownerDocument();
	}
	const status = await derivedStatus(doc);
	return {
		requestId: id, target: doc.target, expectedAccountId: doc.userId, expiresAt: doc.approvalDeadline.toISOString(), status,
		...(status === 'completed' && doc.receipt ? { receipt: doc.receipt } : {})
	};
};

export const credentialImportStatus = async (context: ImportContext, requestId: unknown, proof: unknown) => {
	const doc = await loadIntent(context, verifiedId(requestId));
	authorizeProof(doc, proof);
	const status = await derivedStatus(doc);
	return { status, ...(status === 'completed' && doc.receipt ? { receipt: doc.receipt } : {}) };
};

const checkUploadState = async (doc: IntentDoc, persistRevocation = true) => {
	if (doc.approvalDeadline.getTime() <= Date.now()) throw new CredentialImportError('expired');
	const status = await derivedStatus(doc, persistRevocation);
	if (status === 'revoked') throw new CredentialImportError('revoked');
	if (status === 'pending') throw new CredentialImportError('pending');
	if (status !== 'approved' && status !== 'completed') throw new CredentialImportError('expired');
};

export const uploadCredentialImport = async (
	context: ImportContext, requestId: unknown, proof: unknown, readBody: () => Promise<Uint8Array>
) => {
	const id = verifiedId(requestId);
	const initial = await loadIntent(context, id);
	const verifier = authorizeProof(initial, proof);
	// Do not read a credential body before checking origin, proof, approval, and expiry.
	await checkUploadState(initial);
	const bytes = await readBody();
	try {
		const fingerprint = fingerprintImportPayload(verifier, bytes);
		const prepared = initial.status === 'completed' ? null : prepareCredentialImport(initial.target, bytes);
		return await withHomeMongoTransaction(async session => {
			const doc = await loadIntent(context, id, session);
			authorizeProof(doc, verifier);
			await checkUploadState(doc, false);
			if (doc.status === 'completed') {
				if (!doc.receipt || !doc.fingerprint || !importProofMatches(doc.fingerprint, fingerprint)) throw new CredentialImportError('conflict');
				return doc.receipt;
			}
			if (!doc.approval || !prepared) throw new CredentialImportError('revoked');
			// Revalidate current deployment/callback policy in case configuration
			// changed after approval. The immutable target never comes from upload.
			const target = parseImportTarget(doc.target, context.origin, context.environment);
			const approval = doc.approval;
			const receipt = await writeAdminCredentialImport(target, context.origin, doc.userId, prepared, session,
				() => requireLiveApprovalForWrite(approval, session));
			const result = await (await getAuthOtpsCollection()).updateOne({
				...lookup(id), status: 'approved', approvalDeadline: { $gt: new Date() }
			}, {
				$set: { status: 'completed', fingerprint, receipt, consumedAt: new Date(), expiresAt: new Date(Date.now() + receiptLifetime) },
				$unset: { approval: '' }
			}, { session });
			if (!result.matchedCount) throw new CredentialImportError('expired');
			return receipt;
		});
	} finally {
		bytes.fill(0);
	}
};

export const directCredentialImport = async (
	context: ImportContext, actor: BrowserActor, input: unknown, readBody: () => Promise<Uint8Array>
) => {
	const target = parseImportTarget(input, context.origin, context.environment);
	const bytes = await readBody();
	try {
		const prepared = prepareCredentialImport(target, bytes);
		return await withHomeMongoTransaction(session => writeAdminCredentialImport(
			target, context.origin, actor.accountId, prepared, session, () => requireLiveApprovalForWrite(actor, session)
		));
	} finally {
		bytes.fill(0);
	}
};
