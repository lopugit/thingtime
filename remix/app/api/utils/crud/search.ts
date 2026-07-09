import type { PublicUser } from '../auth/users';
import { getThingsCollection } from '../mongodb/collections';
import {
  loadDataKeys,
  normalizeExactValue,
  normalizeTerms,
  searchToken
} from './encryption.server';
import { subjectKeysForUser } from './permissions';
import {
  buildUpdatedCursor,
  capListLimit,
  cursorPageFilter,
  parseUpdatedCursor,
  toRecordSummary,
  type PublicThingRecordSummary,
  type ThingRecordDoc
} from './records';
import { findVisibleType } from './types';
import { fail, isFail, type Fail, type ThingTypeField } from './validation';

// Permission-first record search. The ACL filter is part of every Mongo query
// — a record outside acl.searchKeys can never match, whatever the tokens say.

const MAX_QUERY_CHARS = 200;
const MAX_QUERY_TERMS = 8;

export type SearchInput = {
  q?: unknown;
  typeId?: unknown;
  fields?: unknown; // list or comma-separated field keys to search within
  cursor?: string | null;
  limit?: unknown;
};

export type SearchResult =
  | Fail
  | { ok: true; records: PublicThingRecordSummary[]; nextCursor: string | null };

const requestedFieldKeys = (fields: unknown): string[] | null => {
  if (fields === undefined || fields === null || fields === '') return null;
  const list = Array.isArray(fields) ? fields : String(fields).split(',');
  const keys = list.map((entry) => String(entry).trim()).filter(Boolean);
  return keys.length ? keys : null;
};

export const searchRecords = async (user: PublicUser | null, input: SearchInput): Promise<SearchResult> => {
  const q = typeof input.q === 'string' ? input.q.trim().slice(0, MAX_QUERY_CHARS) : '';
  if (!q) return fail(400, 'A search query (q) is required');

  const type = await findVisibleType(user, input.typeId);
  if (!type) return fail(404, 'Type not found');

  const requested = requestedFieldKeys(input.fields);
  let searchableFields = (type.fields || []).filter((field) => field.searchable !== 'none');
  if (requested) {
    const wanted = new Set(requested);
    searchableFields = searchableFields.filter((field) => wanted.has(field.key));
  }
  if (!searchableFields.length) {
    return fail(400, 'None of the requested fields are searchable for this type');
  }

  // Blind-index tokens for encrypted fields need the active data key. If keys
  // aren't configured, drop those fields; only hard-fail when nothing is left.
  const needsKeys = searchableFields.some((field) => field.encrypted);
  const loadedKeys = needsKeys ? loadDataKeys() : null;
  const dataKeys = loadedKeys && !isFail(loadedKeys) ? loadedKeys.keys : null;
  if (!dataKeys) {
    searchableFields = searchableFields.filter((field) => !field.encrypted);
    if (!searchableFields.length && loadedKeys && isFail(loadedKeys)) return loadedKeys;
  }

  const termFields = searchableFields.filter((field) => field.searchable === 'term');
  const exactFields = searchableFields.filter((field) => field.searchable === 'exact');

  const tokensFor = (field: ThingTypeField, mode: 'exact' | 'term', normalized: string) =>
    searchToken(type.shareId, field.key, mode, normalized, field.encrypted ? dataKeys : null);

  // Semantics: every query term must match somewhere in a term field (AND
  // across terms, OR across fields), or some exact field equals the whole
  // normalized query. Exact + term clauses combine with $or.
  const terms = normalizeTerms(q).slice(0, MAX_QUERY_TERMS);
  const termClauses =
    terms.length && termFields.length
      ? terms.map((term) => ({
          'search.tokens': { $in: termFields.map((field) => tokensFor(field, 'term', term)) }
        }))
      : null;
  const exactTokens = exactFields.map((field) => tokensFor(field, 'exact', normalizeExactValue(q)));

  const matchClauses: any[] = [];
  if (termClauses) matchClauses.push(termClauses.length === 1 ? termClauses[0] : { $and: termClauses });
  if (exactTokens.length) matchClauses.push({ 'search.tokens': { $in: exactTokens } });
  if (!matchClauses.length) {
    // query normalized to nothing a term index can use, and no exact fields
    return { ok: true, records: [], nextCursor: null };
  }

  const limit = capListLimit(input.limit);
  const cursor = parseUpdatedCursor(input.cursor);
  const pageFilter = cursorPageFilter(cursor);

  const match: any = {
    kind: 'record',
    typeId: type.shareId,
    deletedAt: null,
    'acl.searchKeys': { $in: subjectKeysForUser(user) },
    $and: [
      matchClauses.length === 1 ? matchClauses[0] : { $or: matchClauses },
      ...(pageFilter ? [pageFilter] : [])
    ]
  };

  const things = await getThingsCollection();
  const docs = (await things
    .find(match)
    .sort({ updatedAt: -1, shareId: 1 })
    .limit(limit + 1)
    .toArray()) as any as ThingRecordDoc[];

  const page = docs.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = docs.length > limit && last ? buildUpdatedCursor(last) : null;
  return { ok: true, records: page.map(toRecordSummary), nextCursor };
};
