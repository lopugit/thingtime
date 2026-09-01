import { randomUUID } from 'node:crypto';

import { COLLECTION_SCHEMA_VERSIONS, EMBEDDED_THINGTIME } from '../../../schemas/registry';
import { ensureIndexes, getThingsCollection } from '../mongodb/collections';

// Embedded things share the one `things` collection with posts and every other
// kind, so they MUST carry the era fields the generic readers key off. Without
// them a `kind: 'embed'` doc reads as a schema-v1 document, which things.ts
// interprets as a POST (`thingtimeOf`: a v1 doc with no shareOfId is ['post']),
// and a `visibility: 'public'` embed matched the public audience clause in
// things/search.ts — so its name/value (wildcard-text-indexed) surfaced to
// anonymous /api/v1/things/search as a blank ghost post. Stamping the v2
// schemaVersion plus a real thingtime lets the existing PROTECTED_THINGTIME
// `$nin` exclusion in search/listThings do its job, exactly as it does for
// every other server-minted kind.

export type EmbeddedThingVisibility = 'public' | 'private';

export type EmbeddedThing = {
	id: string;
	name: string;
	value: unknown;
	visibility: EmbeddedThingVisibility;
	version: number;
	createdAt: string;
	updatedAt: string;
};

export type EmbeddedThingSummary = Omit<EmbeddedThing, 'value'>;

type EmbeddedThingDoc = {
	shareId: string;
	kind: 'embed';
	schemaVersion: number;
	thingtime: string[];
	ownerId: string;
	name: string;
	value: unknown;
	visibility: EmbeddedThingVisibility;
	version: number;
	createdAt: Date;
	updatedAt: Date;
};

type Fail = { ok: false; status: number; error: string; thing?: EmbeddedThing };
type Success<T extends object> = { ok: true } & T;

const MAX_NAME_CHARS = 120;
const MAX_ID_CHARS = 128;
const MAX_VALUE_BYTES = 256 * 1024;
const MAX_VALUE_DEPTH = 32;
const MAX_VALUE_NODES = 20_000;
const MAX_THINGS_PER_OWNER = 1_000;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const EMBED_ID = /^[A-Za-z0-9_-]+$/;

const fail = (status: number, error: string, thing?: EmbeddedThing): Fail => ({
	ok: false,
	status,
	error,
	...(thing ? { thing } : {})
});

const iso = (value: unknown) => new Date(value as any).toISOString();

const toEmbeddedThing = (doc: EmbeddedThingDoc): EmbeddedThing => ({
	id: doc.shareId,
	name: doc.name,
	value: doc.value,
	visibility: doc.visibility,
	version: doc.version,
	createdAt: iso(doc.createdAt),
	updatedAt: iso(doc.updatedAt)
});

const toEmbeddedThingSummary = (doc: EmbeddedThingDoc): EmbeddedThingSummary => {
	const { value: _value, ...summary } = toEmbeddedThing(doc);
	return summary;
};

const parseId = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const id = value.trim();
	return id && id.length <= MAX_ID_CHARS && EMBED_ID.test(id) ? id : null;
};

const cloneJsonValue = (input: unknown): Success<{ value: unknown }> | Fail => {
	let nodes = 0;

	const visit = (value: unknown, depth: number): unknown => {
		nodes += 1;
		if (nodes > MAX_VALUE_NODES) throw new Error('Thing has too many values');
		if (depth > MAX_VALUE_DEPTH) throw new Error('Thing is nested too deeply');

		if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
		if (typeof value === 'number') {
			if (!Number.isFinite(value)) throw new Error('Thing numbers must be finite');
			return value;
		}

		if (Array.isArray(value)) {
			return value.map((entry) => visit(entry, depth + 1));
		}

		if (!value || typeof value !== 'object') {
			throw new Error('Thing values must be JSON data');
		}

		const output: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) {
			if (!key || key.length > MAX_NAME_CHARS || key.startsWith('$') || key.includes('.') || FORBIDDEN_KEYS.has(key)) {
				throw new Error(`Thing key is not allowed: ${key || '(empty)'}`);
			}
			output[key] = visit(entry, depth + 1);
		}
		return output;
	};

	try {
		const value = visit(input, 0);
		const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
		if (bytes > MAX_VALUE_BYTES) return fail(413, `Thing data is too large (max ${MAX_VALUE_BYTES} bytes)`);
		return { ok: true, value };
	} catch (err: any) {
		return fail(400, err?.message || 'Thing value is invalid');
	}
};

const parseVisibility = (value: unknown, fallback: EmbeddedThingVisibility): EmbeddedThingVisibility | null => {
	if (value === undefined) return fallback;
	return value === 'public' || value === 'private' ? value : null;
};

const parseName = (value: unknown, fallback: string): string | null => {
	if (value === undefined) return fallback;
	if (typeof value !== 'string') return null;
	const name = value.trim();
	return name ? name.slice(0, MAX_NAME_CHARS) : null;
};

export const getEmbeddedThing = async (viewerId: string | null, rawId: unknown) => {
	const id = parseId(rawId);
	if (!id) return fail(400, 'A valid thing id is required');

	await ensureIndexes();
	const things = await getThingsCollection();
	const visibility = viewerId ? { $or: [{ visibility: 'public' }, { ownerId: viewerId }] } : { visibility: 'public' };
	const doc = await things.findOne({ shareId: id, kind: 'embed', ...visibility });

	if (!doc) return fail(404, 'Thing not found');
	return { ok: true, thing: toEmbeddedThing(doc as EmbeddedThingDoc) } as const;
};

export const listEmbeddedThings = async (ownerId: string) => {
	await ensureIndexes();
	const things = await getThingsCollection();
	const docs = await things
		.find({ kind: 'embed', ownerId }, { projection: { value: 0 } })
		.sort({ updatedAt: -1 })
		.limit(100)
		.toArray();

	return { ok: true, things: docs.map((doc) => toEmbeddedThingSummary(doc as EmbeddedThingDoc)) } as const;
};

export const saveEmbeddedThing = async (ownerId: string, rawInput: unknown) => {
	if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
		return fail(400, 'Thing request must be a JSON object');
	}
	const input = rawInput as Record<string, unknown>;
	const id = input.id === undefined ? null : parseId(input.id);
	if (input.id !== undefined && !id) return fail(400, 'Thing id is invalid');

	const parsedValue = cloneJsonValue(input.value);
	if (parsedValue.ok === false) return parsedValue;

	await ensureIndexes();
	const things = await getThingsCollection();
	const now = new Date();

	if (!id) {
		const existingCount = await things.countDocuments({ kind: 'embed', ownerId }, { limit: MAX_THINGS_PER_OWNER });
		if (existingCount >= MAX_THINGS_PER_OWNER) {
			return fail(429, `An account can have at most ${MAX_THINGS_PER_OWNER} embedded things`);
		}

		const name = parseName(input.name, 'Untitled thing');
		if (!name) return fail(400, 'Thing name is required');
		const visibility = parseVisibility(input.visibility, 'private');
		if (!visibility) return fail(400, 'Thing visibility must be public or private');

		const doc: EmbeddedThingDoc = {
			shareId: randomUUID(),
			kind: 'embed',
			schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
			thingtime: [EMBEDDED_THINGTIME],
			ownerId,
			name,
			value: parsedValue.value,
			visibility,
			version: 1,
			createdAt: now,
			updatedAt: now
		};
		await things.insertOne(doc as any);
		return { ok: true, thing: toEmbeddedThing(doc) } as const;
	}

	const current = (await things.findOne({ shareId: id, kind: 'embed', ownerId })) as EmbeddedThingDoc | null;
	if (!current) return fail(404, 'Thing not found');

	const expectedVersion = Number(input.version);
	if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
		return fail(400, 'The current thing version is required when saving');
	}
	if (current.version !== expectedVersion) {
		return fail(409, 'Thing changed somewhere else. Load it before saving again.', toEmbeddedThing(current));
	}

	const name = parseName(input.name, current.name);
	if (!name) return fail(400, 'Thing name is required');
	const visibility = parseVisibility(input.visibility, current.visibility);
	if (!visibility) return fail(400, 'Thing visibility must be public or private');

	const nextVersion = current.version + 1;
	const update = await things.updateOne(
		{ shareId: id, kind: 'embed', ownerId, version: current.version },
		{
			$set: {
				name,
				value: parsedValue.value,
				visibility,
				updatedAt: now
			},
			$inc: { version: 1 }
		}
	);

	if (update.modifiedCount !== 1) {
		const latest = (await things.findOne({ shareId: id, kind: 'embed', ownerId })) as EmbeddedThingDoc | null;
		return fail(409, 'Thing changed somewhere else. Load it before saving again.', latest ? toEmbeddedThing(latest) : undefined);
	}

	return {
		ok: true,
		thing: toEmbeddedThing({
			...current,
			name,
			value: parsedValue.value,
			visibility,
			version: nextVersion,
			updatedAt: now
		})
	} as const;
};
