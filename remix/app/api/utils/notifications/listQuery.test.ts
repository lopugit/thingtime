import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeNotificationPrefs } from '~/schemas/registry';
import {
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  MAX_SEARCH_CHARS,
  NOTIFICATION_SEARCH_FIELDS,
  buildNotificationListFilters,
  escapeRegex,
  resolveNotificationListQuery
} from './listQuery';

const prefsOn = normalizeNotificationPrefs(null);

test('limit clamps to the documented window and defaults when absent or junk', () => {
  assert.equal(resolveNotificationListQuery({}).limit, DEFAULT_LIST_LIMIT);
  assert.equal(resolveNotificationListQuery({ limit: 'abc' }).limit, DEFAULT_LIST_LIMIT);
  assert.equal(resolveNotificationListQuery({ limit: '0' }).limit, 1);
  assert.equal(resolveNotificationListQuery({ limit: '30.9' }).limit, 30);
  assert.equal(resolveNotificationListQuery({ limit: '9999' }).limit, MAX_LIST_LIMIT);
});

test('cursor and date bounds parse ISO strings and reject everything else', () => {
  const query = resolveNotificationListQuery({
    before: '2026-09-01T10:00:00.000Z',
    since: '2026-08-01',
    until: 'not a date'
  });
  assert.equal(query.before?.toISOString(), '2026-09-01T10:00:00.000Z');
  assert.equal(query.since?.toISOString(), '2026-08-01T00:00:00.000Z');
  assert.equal(query.until, null);
  assert.equal(resolveNotificationListQuery({ before: 42 }).before, null);
});

test('types accept csv or arrays, dedupe, and drop unknown names', () => {
  assert.deepEqual(resolveNotificationListQuery({}).types, null);
  assert.deepEqual(resolveNotificationListQuery({ types: 'comment, reply,comment,bogus' }).types, ['comment', 'reply']);
  assert.deepEqual(resolveNotificationListQuery({ types: ['mention', 7, 'action-run'] }).types, ['mention', 'action-run']);
  // only unknown names → an explicit empty set, not "no restriction"
  assert.deepEqual(resolveNotificationListQuery({ types: 'bogus' }).types, []);
});

test('category expands to its types and intersects with an explicit type list', () => {
  assert.deepEqual(resolveNotificationListQuery({ category: 'system' }).types, ['action-run']);
  assert.deepEqual(resolveNotificationListQuery({ category: 'feed' }).types, ['post-from-followed', 'post-from-friend']);
  assert.deepEqual(resolveNotificationListQuery({ category: 'engagement', types: 'comment,new-follower' }).types, ['comment']);
  assert.deepEqual(resolveNotificationListQuery({ category: 'nope' }).types, []);
});

test('unread and search are normalised', () => {
  assert.equal(resolveNotificationListQuery({}).unread, false);
  assert.equal(resolveNotificationListQuery({ unread: '1' }).unread, true);
  assert.equal(resolveNotificationListQuery({ unread: 'true' }).unread, true);
  assert.equal(resolveNotificationListQuery({ unread: 'yes' }).unread, false);
  assert.equal(resolveNotificationListQuery({ q: '   ' }).q, null);
  assert.equal(resolveNotificationListQuery({ q: '  rick   deckard ' }).q, 'rick deckard');
  assert.equal(resolveNotificationListQuery({ q: 'x'.repeat(500) }).q?.length, MAX_SEARCH_CHARS);
});

test('search text is matched literally — regex metacharacters are escaped', () => {
  assert.equal(escapeRegex('a.b*c(d)[e]{f}|g?h^$\\'), 'a\\.b\\*c\\(d\\)\\[e\\]\\{f\\}\\|g\\?h\\^\\$\\\\');
  const filters = buildNotificationListFilters('u1', prefsOn, resolveNotificationListQuery({ q: '(.*)' }));
  assert.ok(filters);
  assert.deepEqual(
    filters.base.$or,
    NOTIFICATION_SEARCH_FIELDS.map((field) => ({ [field]: { $regex: '\\(\\.\\*\\)', $options: 'i' } }))
  );
});

test('the push master off means nothing can match', () => {
  const prefs = normalizeNotificationPrefs({ masters: { push: false } });
  assert.equal(buildNotificationListFilters('u1', prefs, resolveNotificationListQuery({})), null);
});

test('disabled types are excluded, explicit types are intersected with the enabled set', () => {
  const prefs = normalizeNotificationPrefs({ reaction: false, 'action-run': false });
  const plain = buildNotificationListFilters('u1', prefs, resolveNotificationListQuery({}));
  assert.deepEqual(plain?.base, { thingtime: 'notification', ownerId: 'u1', 'crystal.type': { $nin: ['reaction', 'action-run'] } });

  const explicit = buildNotificationListFilters('u1', prefs, resolveNotificationListQuery({ types: 'reaction,comment' }));
  assert.deepEqual(explicit?.base['crystal.type'], { $in: ['comment'] });

  // everything asked for is switched off → empty page, never a leak
  assert.equal(buildNotificationListFilters('u1', prefs, resolveNotificationListQuery({ category: 'system' })), null);
  assert.equal(buildNotificationListFilters('u1', prefsOn, resolveNotificationListQuery({ types: 'bogus' })), null);
});

test('unread, date bounds and the cursor compose into base + page filters', () => {
  const query = resolveNotificationListQuery({
    unread: '1',
    since: '2026-08-01T00:00:00.000Z',
    until: '2026-08-31T23:59:59.999Z',
    before: '2026-08-15T12:00:00.000Z'
  });
  const filters = buildNotificationListFilters('u1', prefsOn, query);
  assert.ok(filters);
  assert.equal(filters.base.readAt, null);
  assert.deepEqual(filters.base.createdAt, { $gte: query.since, $lte: query.until });
  // the cursor only narrows the page — the total still counts the whole range
  assert.deepEqual(filters.page.createdAt, { $gte: query.since, $lte: query.until, $lt: query.before });
  assert.equal('crystal.type' in filters.base, false);
});
