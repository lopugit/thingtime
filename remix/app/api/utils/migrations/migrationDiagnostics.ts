import { randomUUID } from 'node:crypto';

import { fromBin, toBin } from '../auth/users';
import {
	MAX_ADMIN_DIAGNOSTIC_CHARS,
	MAX_ADMIN_DIAGNOSTIC_REVEALABLES,
	sanitizeStoredAdminDiagnosticDetail,
	type AdminDiagnosticRevealable,
	type AdminErrorDiagnostic
} from '../errors/adminDiagnostic';
import { safeErrorText } from '../errors/safeError';
import { getHomeThingsCollection } from '../mongodb/collections';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, MIGRATION_DIAGNOSTIC_ID_PREFIX, MIGRATION_DIAGNOSTIC_THINGTIME } from '../../../schemas/registry';

const LEGACY_DIAGNOSTIC_VERSION = 1;
const DIAGNOSTIC_VERSION = 2;
const DIAGNOSTIC_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DIAGNOSTIC_WRITE_OPERATION_TIMEOUT_MS = 750;
const DIAGNOSTIC_READ_OPERATION_TIMEOUT_MS = 2_000;
const MAX_BEST_EFFORT_DIAGNOSTICS_PER_ADMIN = 25;
const MAX_BEST_EFFORT_DIAGNOSTICS_PER_MINUTE = 5;
const MAX_SUMMARY_CHARS = 2_048;
const MAX_OWNER_ID_CHARS = 256;
const DIAGNOSTIC_ID_PATTERN = /^migration-diagnostic-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVEAL_REFERENCE_PATTERN = /^mongodb-object-id-([1-9]|[12][0-9]|3[0-2])$/;
const MONGODB_OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

type DiagnosticOutcome = 'rejected' | 'unknown';

export type CreateMigrationDiagnosticInput = {
	ownerId: string;
	migrationId: string;
	status: number;
	outcome: DiagnosticOutcome;
	summary: string;
	diagnostic: AdminErrorDiagnostic;
};

type StoredDiagnosticSecureV1 = Omit<AdminErrorDiagnostic, 'revealables'> & {
	diagnosticVersion: typeof LEGACY_DIAGNOSTIC_VERSION;
};

type StoredDiagnosticSecureV2 = AdminErrorDiagnostic & {
	diagnosticVersion: typeof DIAGNOSTIC_VERSION;
};

type StoredDiagnosticSecure = StoredDiagnosticSecureV1 | StoredDiagnosticSecureV2;

type MigrationDiagnosticDoc = {
	shareId: string;
	schemaVersion: number;
	thingtime: [typeof MIGRATION_DIAGNOSTIC_THINGTIME];
	storageClass: 'control';
	crystal: {
			diagnosticVersion: typeof LEGACY_DIAGNOSTIC_VERSION | typeof DIAGNOSTIC_VERSION;
		migrationId: string;
		mode: 'run';
		status: number;
		outcome: DiagnosticOutcome;
		summary: string;
		capturedAt: string;
	};
	secure: ReturnType<typeof toBin>;
	ownerId: string;
	acl: [typeof ACL_OWNER];
	targetId: null;
	tags: [typeof MIGRATION_DIAGNOSTIC_THINGTIME];
	expiresAt: Date;
	createdAt: Date;
	updatedAt: Date;
};

export type MigrationDiagnostic = {
	id: string;
	migrationId: string;
	status: number;
	outcome: DiagnosticOutcome;
	summary: string;
	capturedAt: string;
	expiresAt: string;
	detail: string;
	redactions: number;
	truncated: boolean;
	revealables: MigrationDiagnosticRevealDescriptor[];
};

export type MigrationDiagnosticRevealDescriptor = Omit<AdminDiagnosticRevealable, 'value'>;

export type MigrationDiagnosticReveal = Pick<AdminDiagnosticRevealable, 'reference' | 'kind' | 'label' | 'value'>;

const safeMigrationId = (value: unknown): string =>
	typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,127}$/.test(value) ? value : 'requested-migration';

const safeStatus = (value: unknown): number => {
	const status = Number(value);
	return Number.isSafeInteger(status) && status >= 400 && status <= 599 ? status : 500;
};

const safeSummary = (value: unknown): string =>
	typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_SUMMARY_CHARS) : 'Migration stopped before completion.';

const safeOwnerId = (value: unknown): string | null => {
	const ownerId = typeof value === 'string' ? value.trim() : '';
	return ownerId && ownerId.length <= MAX_OWNER_ID_CHARS ? ownerId : null;
};

const safeDiagnosticDetail = (value: unknown): string => {
	const detail = typeof value === 'string' && value ? value : '{\n  "name": "UnavailableDiagnostic"\n}';
	return detail.slice(0, MAX_ADMIN_DIAGNOSTIC_CHARS);
};

const safeRedactions = (value: unknown): number => {
	const count = Number(value);
	return Number.isSafeInteger(count) ? Math.max(0, Math.min(count, 1_000_000)) : 0;
};

const revealableFrom = (value: unknown, detail: string): AdminDiagnosticRevealable | null => {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as Record<string, unknown>;
	const reference = typeof candidate.reference === 'string' ? candidate.reference : '';
	const match = reference.match(REVEAL_REFERENCE_PATTERN);
	if (!match || candidate.kind !== 'mongodb-object-id') return null;
	const index = Number(match[1]);
	const label = `MongoDB ObjectId #${index}`;
	const placeholder = `[redacted MongoDB ObjectId #${index}]`;
	const rawValue = typeof candidate.value === 'string' ? candidate.value : '';
	if (
		candidate.label !== label ||
		candidate.placeholder !== placeholder ||
		!MONGODB_OBJECT_ID_PATTERN.test(rawValue) ||
		!detail.includes(placeholder)
	) {
		return null;
	}
	return { reference, kind: 'mongodb-object-id', label, placeholder, value: rawValue.toLowerCase() };
};

const safeRevealables = (value: unknown, detail: string): AdminDiagnosticRevealable[] => {
	if (!Array.isArray(value) || value.length > MAX_ADMIN_DIAGNOSTIC_REVEALABLES) return [];
	const references = new Set<string>();
	const values = new Set<string>();
	const output: AdminDiagnosticRevealable[] = [];
	for (const entry of value) {
		const revealable = revealableFrom(entry, detail);
		if (!revealable || references.has(revealable.reference) || values.has(revealable.value)) return [];
		references.add(revealable.reference);
		values.add(revealable.value);
		output.push(revealable);
	}
	return output;
};

const safeStoredDate = (value: unknown): string | null => {
	if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') return null;
	const date = value instanceof Date ? value : new Date(value as any);
	return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

export const formatMigrationDiagnosticDetail = (input: {
	migrationId: unknown;
	mode: 'run' | 'dry run';
	status: unknown;
	outcome: DiagnosticOutcome;
	summary: unknown;
	diagnostic: AdminErrorDiagnostic;
}): string =>
	[
		`Migration: ${safeMigrationId(input.migrationId)}`,
		`Mode: ${input.mode}`,
		`HTTP status: ${safeStatus(input.status)}`,
		`Mutation outcome: ${input.outcome === 'rejected' ? 'rejected' : 'unknown'}`,
		`Summary: ${safeSummary(input.summary)}`,
		`Sensitive redactions: ${safeRedactions(input.diagnostic.redactions)}`,
		`Truncated: ${input.diagnostic.truncated === true ? 'yes' : 'no'}`,
		'',
		safeDiagnosticDetail(input.diagnostic.detail)
	].join('\n');

export const isMigrationDiagnosticId = (value: unknown): value is string =>
	typeof value === 'string' && value.length <= 128 && DIAGNOSTIC_ID_PATTERN.test(value);

export const buildMigrationDiagnosticThing = (
	input: CreateMigrationDiagnosticInput,
	options: { now?: Date; id?: string } = {}
): MigrationDiagnosticDoc => {
	const ownerId = safeOwnerId(input.ownerId);
	if (!ownerId) throw new TypeError('Invalid migration diagnostic owner');
	const now = options.now instanceof Date && Number.isFinite(options.now.getTime()) ? options.now : new Date();
	const id = isMigrationDiagnosticId(options.id) ? options.id : `${MIGRATION_DIAGNOSTIC_ID_PREFIX}${randomUUID()}`;
	const capturedAt = now.toISOString();
	const diagnosticDetail = typeof input.diagnostic.detail === 'string' ? input.diagnostic.detail : '';
	const rescrubbed = sanitizeStoredAdminDiagnosticDetail(diagnosticDetail);
	const detail = safeDiagnosticDetail(rescrubbed.detail);
	const secure: StoredDiagnosticSecureV2 = {
		diagnosticVersion: DIAGNOSTIC_VERSION,
		detail,
		redactions: safeRedactions(safeRedactions(input.diagnostic.redactions) + rescrubbed.redactions),
		truncated:
			input.diagnostic.truncated === true ||
			rescrubbed.truncated ||
			diagnosticDetail.length > MAX_ADMIN_DIAGNOSTIC_CHARS,
		revealables: safeRevealables(input.diagnostic.revealables, detail)
	};

	return {
		shareId: id,
		schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
		thingtime: [MIGRATION_DIAGNOSTIC_THINGTIME],
		storageClass: 'control',
		crystal: {
			diagnosticVersion: DIAGNOSTIC_VERSION,
			migrationId: safeMigrationId(input.migrationId),
			mode: 'run',
			status: safeStatus(input.status),
			outcome: input.outcome === 'rejected' ? 'rejected' : 'unknown',
			summary: safeSummary(input.summary),
			capturedAt
		},
		secure: toBin(JSON.stringify(secure)),
		ownerId,
		acl: [ACL_OWNER],
		targetId: null,
		tags: [MIGRATION_DIAGNOSTIC_THINGTIME],
		expiresAt: new Date(now.getTime() + DIAGNOSTIC_RETENTION_MS),
		createdAt: now,
		updatedAt: now
	};
};

const pruneOldDiagnostics = async (ownerId: string): Promise<void> => {
	const things = await getHomeThingsCollection();
	const stale = await things
		.find(
			{ ownerId, thingtime: MIGRATION_DIAGNOSTIC_THINGTIME, storageClass: 'control' },
			{ projection: { _id: 1 }, timeoutMS: DIAGNOSTIC_WRITE_OPERATION_TIMEOUT_MS }
		)
		.sort({ createdAt: -1, shareId: -1 })
		.skip(MAX_BEST_EFFORT_DIAGNOSTICS_PER_ADMIN)
		.toArray();
	const ids = stale.map((entry: any) => entry?._id).filter(Boolean);
	if (ids.length) {
		await things.deleteMany(
			{ _id: { $in: ids }, ownerId, thingtime: MIGRATION_DIAGNOSTIC_THINGTIME, storageClass: 'control' },
			{ timeoutMS: DIAGNOSTIC_WRITE_OPERATION_TIMEOUT_MS }
		);
	}
};

export const createMigrationDiagnostic = async (input: CreateMigrationDiagnosticInput): Promise<{ ok: true; id: string } | { ok: false }> => {
	try {
		const ownerId = safeOwnerId(input.ownerId);
		if (!ownerId) return { ok: false };
		const things = await getHomeThingsCollection();
		const recent = await things.countDocuments(
			{
				ownerId,
				thingtime: MIGRATION_DIAGNOSTIC_THINGTIME,
				createdAt: { $gte: new Date(Date.now() - 60_000) }
			},
			{
				limit: MAX_BEST_EFFORT_DIAGNOSTICS_PER_MINUTE,
				timeoutMS: DIAGNOSTIC_WRITE_OPERATION_TIMEOUT_MS
			}
		);
		if (recent >= MAX_BEST_EFFORT_DIAGNOSTICS_PER_MINUTE) return { ok: false };

		const doc = buildMigrationDiagnosticThing({ ...input, ownerId });
		await things.insertOne(doc as any, { timeoutMS: DIAGNOSTIC_WRITE_OPERATION_TIMEOUT_MS });
		// Do not hold the original failure response open for retention cleanup.
		// The TTL is the hard lifetime bound; this newest-25 cleanup is best effort.
		void pruneOldDiagnostics(ownerId).catch((error) => {
			safeErrorText(error, 'migration diagnostic retention', 'Diagnostic retention error');
		});
		return { ok: true, id: doc.shareId };
	} catch (error) {
		safeErrorText(error, 'migration diagnostic write', 'Diagnostic write error');
		return { ok: false };
	}
};

const unpackDiagnostic = (value: unknown): StoredDiagnosticSecure | null => {
	try {
		const parsed = JSON.parse(fromBin(value));
		if (
			!parsed ||
			typeof parsed !== 'object' ||
			typeof parsed.detail !== 'string' ||
			parsed.detail.length > MAX_ADMIN_DIAGNOSTIC_CHARS ||
			!Number.isSafeInteger(parsed.redactions) ||
			parsed.redactions < 0 ||
			parsed.redactions > 1_000_000 ||
			typeof parsed.truncated !== 'boolean' ||
			(parsed.diagnosticVersion !== LEGACY_DIAGNOSTIC_VERSION && parsed.diagnosticVersion !== DIAGNOSTIC_VERSION)
		) {
			return null;
		}
		const rescrubbed = sanitizeStoredAdminDiagnosticDetail(parsed.detail);
		const detail = safeDiagnosticDetail(rescrubbed.detail);
		const redactions = safeRedactions(parsed.redactions + rescrubbed.redactions);
		const truncated = parsed.truncated || rescrubbed.truncated;
		if (parsed.diagnosticVersion === LEGACY_DIAGNOSTIC_VERSION) {
			if ('revealables' in parsed) return null;
			return { ...parsed, detail, redactions, truncated } as StoredDiagnosticSecureV1;
		}
		if (!Array.isArray(parsed.revealables)) return null;
		const revealables = safeRevealables(parsed.revealables, detail);
		if (revealables.length !== parsed.revealables.length) return null;
		return { ...parsed, detail, redactions, truncated, revealables } as StoredDiagnosticSecureV2;
	} catch {
		return null;
	}
};

const findMigrationDiagnostic = async (ownerId: string, id: unknown, now: Date): Promise<MigrationDiagnosticDoc | null> => {
	const safeOwner = safeOwnerId(ownerId);
	if (!safeOwner || !isMigrationDiagnosticId(id)) return null;
	const things = await getHomeThingsCollection();
	return (await things.findOne(
		{
			shareId: id,
			ownerId: safeOwner,
			thingtime: MIGRATION_DIAGNOSTIC_THINGTIME,
			storageClass: 'control',
			expiresAt: { $gt: now }
		},
		{ timeoutMS: DIAGNOSTIC_READ_OPERATION_TIMEOUT_MS }
	)) as MigrationDiagnosticDoc | null;
};

export const migrationDiagnosticFromThing = (doc: unknown, now: Date = new Date()): MigrationDiagnostic | null => {
	if (!doc || typeof doc !== 'object') return null;
	const candidate = doc as MigrationDiagnosticDoc;
	if (
		!isMigrationDiagnosticId(candidate.shareId) ||
		candidate.storageClass !== 'control' ||
		!Array.isArray(candidate.thingtime) ||
		candidate.thingtime.length !== 1 ||
		candidate.thingtime[0] !== MIGRATION_DIAGNOSTIC_THINGTIME
	) {
		return null;
	}
	const secure = unpackDiagnostic(candidate.secure);
	if (!secure || candidate.crystal?.diagnosticVersion !== secure.diagnosticVersion) return null;
	const capturedAt = safeStoredDate(candidate.createdAt);
	const expiresAt = safeStoredDate(candidate.expiresAt);
	if (!capturedAt || !expiresAt || new Date(expiresAt).getTime() <= now.getTime()) return null;
	const revealables =
		secure.diagnosticVersion === DIAGNOSTIC_VERSION
			? secure.revealables.map(({ reference, kind, label, placeholder }) => ({ reference, kind, label, placeholder }))
			: [];
	return {
		id: candidate.shareId,
		migrationId: safeMigrationId(candidate.crystal?.migrationId),
		status: safeStatus(candidate.crystal?.status),
		outcome: candidate.crystal?.outcome === 'rejected' ? 'rejected' : 'unknown',
		summary: safeSummary(candidate.crystal?.summary),
		capturedAt,
		expiresAt,
		detail: safeDiagnosticDetail(secure.detail),
		redactions: safeRedactions(secure.redactions),
		truncated: secure.truncated,
		revealables
	};
};

export const getMigrationDiagnostic = async (ownerId: string, id: unknown): Promise<MigrationDiagnostic | null> => {
	const now = new Date();
	const doc = await findMigrationDiagnostic(ownerId, id, now);
	return doc ? migrationDiagnosticFromThing(doc, now) : null;
};

export const migrationDiagnosticRevealFromThing = (
	doc: unknown,
	reference: unknown,
	now: Date = new Date()
): MigrationDiagnosticReveal | null => {
	if (typeof reference !== 'string' || !REVEAL_REFERENCE_PATTERN.test(reference)) return null;
	if (!migrationDiagnosticFromThing(doc, now)) return null;
	const secure = unpackDiagnostic((doc as MigrationDiagnosticDoc).secure);
	if (
		!secure ||
		secure.diagnosticVersion !== DIAGNOSTIC_VERSION ||
		(doc as MigrationDiagnosticDoc).crystal?.diagnosticVersion !== secure.diagnosticVersion
	) {
		return null;
	}
	const revealable = secure.revealables.find((entry) => entry.reference === reference);
	return revealable
		? {
				reference: revealable.reference,
				kind: revealable.kind,
				label: revealable.label,
				value: revealable.value
		  }
		: null;
};

export const getMigrationDiagnosticReveal = async (
	ownerId: string,
	id: unknown,
	reference: unknown
): Promise<MigrationDiagnosticReveal | null> => {
	const now = new Date();
	const doc = await findMigrationDiagnostic(ownerId, id, now);
	return doc ? migrationDiagnosticRevealFromThing(doc, reference, now) : null;
};
