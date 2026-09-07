import { GENERIC_SITE_DESCRIPTION, escapeHtml } from '../meta/socialMeta';
import { getThingsCollection } from '../mongodb/collections';
import {
  canViewInherited,
  postMatch,
  toPublicPosts,
  visibilityQueryFor,
  withMatch,
  type Fail,
  type PublicPost,
  type ThingDoc
} from './things';
import { subspaceFeedClauses } from '../subspaces/gate';

// Atom feed — the engine behind GET /api/v1/things/rss.
//
// The feed is a guest surface (RSS readers never authenticate), so the whole
// pipeline runs as the anonymous null viewer: candidates are PUBLIC (tt:all)
// posts only, each winner is re-checked with the exact per-doc acl walk
// (canViewInherited) exactly like trending.ts, and projections come from the
// same batched toPublicPosts pass — with a null viewer, so no viewer-specific
// field (viewerReactions, poll viewerVote) can ever leak into the XML.

// Page size of the feed — "latest ~50 public posts".
const RSS_LIMIT = 50;
// Extra candidates fetched so exact acl evaluation (exclusions like
// -tt:user/<id>) can drop docs without shorting the feed (trending's pattern).
const RSS_ACL_BUFFER = 10;

const SITE_NAME = 'Thingtime';
const ENTRY_TITLE_MAX = 100;

// XML 1.0 validity: the only C0 controls allowed are TAB/LF/CR; C1 controls,
// DEL, and the FFFE/FFFF non-characters are never valid in any context.
// Strip them before escaping so user text can never render the feed
// unparseable.
const stripInvalidXmlChars = (value: string): string =>
  // eslint-disable-next-line no-control-regex
  value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFE\uFFFF]/g, '');

// Single choke point: EVERY dynamic value (user text, permalinks, timestamps)
// passes through here on its way into the document. Escaping reuses the
// og-meta escapeHtml (socialMeta.ts) — & < > " ' cover both XML text nodes
// and double/single-quoted attribute values.
const xml = (value: unknown): string =>
  escapeHtml(stripInvalidXmlChars(typeof value === 'string' ? value : value == null ? '' : String(value)));

// Titles are a single line: collapse author-entered newlines/whitespace runs
// (mirrors socialMeta cleanText, minus the control-char strip xml() already
// does at the choke point).
const singleLine = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

// Truncate by code points (mirrors socialMeta truncate): a UTF-16 slice could
// bisect a surrogate pair at the cap and emit an invalid lone surrogate.
const truncate = (value: string, max: number): string => {
  const codePoints = Array.from(value);
  return codePoints.length <= max ? value : `${codePoints.slice(0, max - 1).join('').trimEnd()}…`;
};

// Atom timestamps must be RFC 3339; createdAt already leaves toPublicPosts as
// an ISO string, but a malformed date must degrade instead of throwing.
const isoOf = (value: string, fallback: string): string => {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
};

const entryOf = (origin: string, post: PublicPost, fallbackIso: string): string => {
  const handle = post.author?.username ? `@${singleLine(post.author.username)}` : 'someone';
  const question = singleLine(post.thing?.question);
  const text = post.text && typeof post.text === 'string' ? post.text : '';
  // Polls carry their question under crystal.thing; plain posts carry text.
  const titleText = singleLine(text) || question;
  const title = titleText ? `${handle}: ${truncate(titleText, ENTRY_TITLE_MAX)}` : `${handle} on ${SITE_NAME}`;
  const content = stripInvalidXmlChars(text).trim() || (question ? `Poll: ${question}` : title);
  const permalink = `${origin}/post/${encodeURIComponent(post.id)}`;
  const updated = isoOf(post.createdAt, fallbackIso);
  return [
    '  <entry>',
    `    <title>${xml(title)}</title>`,
    `    <id>${xml(permalink)}</id>`,
    `    <link rel="alternate" type="text/html" href="${xml(permalink)}"/>`,
    `    <published>${xml(updated)}</published>`,
    `    <updated>${xml(updated)}</updated>`,
    `    <author><name>${xml(handle)}</name></author>`,
    `    <content type="text">${xml(content)}</content>`,
    '  </entry>'
  ].join('\n');
};

export const buildPublicPostsAtomFeed = async (origin: string): Promise<{ ok: true; xml: string } | Fail> => {
  const things = await getThingsCollection();

  // public circle only — the anonymous null viewer makes visibilityQueryFor
  // emit exactly the coarse public superset clause (same match as trending,
  // minus the 7-day window: the feed is "latest", not "hot").
  // subspace fences: removed posts and private-subspace posts never syndicate
  const match = withMatch(postMatch(), visibilityQueryFor(null, ['public']), ...subspaceFeedClauses(null));
  const candidates = (await things
    .find(match as any)
    .sort({ createdAt: -1, shareId: 1 })
    .limit(RSS_LIMIT + RSS_ACL_BUFFER)
    .toArray()) as any as ThingDoc[];

  // exact acl evaluation as the anonymous viewer — the DB match was only a
  // superset, so exclusions and edits since the scan drop out here
  const visible: ThingDoc[] = [];
  for (const doc of candidates) {
    if (visible.length >= RSS_LIMIT) break;
    if (await canViewInherited(doc, null)) visible.push(doc);
  }

  const posts = await toPublicPosts(visible, null);

  const nowIso = new Date().toISOString();
  const feedUrl = `${origin}/api/v1/things/rss`;
  // Atom requires feed-level <updated>: the newest entry, or "now" when the
  // feed is empty.
  const updated = posts.length ? isoOf(posts[0].createdAt, nowIso) : nowIso;

  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${xml(SITE_NAME)}</title>`,
    `  <subtitle>${xml(GENERIC_SITE_DESCRIPTION)}</subtitle>`,
    `  <id>${xml(feedUrl)}</id>`,
    `  <link rel="self" type="application/atom+xml" href="${xml(feedUrl)}"/>`,
    `  <link rel="alternate" type="text/html" href="${xml(`${origin}/`)}"/>`,
    `  <updated>${xml(updated)}</updated>`,
    ...posts.map((post) => entryOf(origin, post, nowIso)),
    '</feed>',
    ''
  ];

  return { ok: true, xml: lines.join('\n') };
};
