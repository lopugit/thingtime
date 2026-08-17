import { createHash } from 'node:crypto';

import { generateAiCompletion, hasLopuAiProviderConfigured } from '../lopu/musing';
import { getHomeThingsCollection, getThingsCollection } from '../mongodb/collections';
import type { PublicPost } from '../things/things';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';

// AI feed filters — user-defined rules layered over connected third-party
// feeds ("warn for sad news, with a Show button"). Two protected kinds:
//
//   • `feed-filter` — the user's rule: a natural-language prompt plus an
//     action ('warn' veils the post behind a Show button, 'hide' drops it).
//     HOME-pinned operational preference (storageClass 'control', owner-acl),
//     managed only through /api/v1/connections/filters.
//   • `feed-filter-verdict` — one cached classification per (filter revision,
//     post): deterministic `ext-verdict-…` shareId, so each post is classified
//     once per filter revision, not once per viewer per page load. The filter
//     revision key hashes the prompt, so editing a filter re-classifies.
//
// Classification prefers the shared LLM plumbing (musing.ts — the only module
// allowed to construct AI clients, provider waterfall + graceful no-key
// degradation) in one batched call per filter per page; without any AI key it
// falls back to a deterministic keyword heuristic so the feature (and its
// tests) always works.

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

export const FEED_FILTER_KIND = 'feed-filter';
export const FEED_FILTER_VERDICT_KIND = 'feed-filter-verdict';

const MAX_FILTERS_PER_USER = 20;
const MAX_NAME_CHARS = 80;
const MAX_PROMPT_CHARS = 500;
const CLASSIFY_BATCH = 20;
const CLASSIFY_TEXT_CHARS = 600;

export type FeedFilterAction = 'warn' | 'hide';

export type PublicFeedFilter = {
  id: string;
  name: string;
  prompt: string;
  action: FeedFilterAction;
  enabled: boolean;
  createdAt: string | null;
};

export type FeedFilterMatch = {
  filterId: string;
  name: string;
  action: FeedFilterAction;
  reason: string;
  source: 'claude' | 'openai' | 'heuristic';
};

const sha48 = (parts: string[]): string => {
  const hash = createHash('sha256');
  parts.forEach((part, index) => {
    if (index) hash.update('\0');
    hash.update(part);
  });
  return hash.digest('hex').slice(0, 48);
};

const feedFilterShareId = (): string => `ext-filter-${sha48([String(Date.now()), String(Math.random())])}`;

// verdicts key on the filter REVISION (id + prompt hash) so prompt edits
// invalidate the cache naturally
const filterRevisionKey = (filter: { id: string; prompt: string }): string => sha48([filter.id, filter.prompt]);
export const verdictShareId = (revisionKey: string, postId: string): string => `ext-verdict-${sha48([revisionKey, postId])}`;

const toPublicFilter = (doc: any): PublicFeedFilter => ({
  id: String(doc?.shareId || ''),
  name: String(doc?.crystal?.name || ''),
  prompt: String(doc?.crystal?.prompt || ''),
  action: doc?.crystal?.action === 'hide' ? 'hide' : 'warn',
  enabled: doc?.crystal?.enabled !== false,
  createdAt: doc?.createdAt instanceof Date ? doc.createdAt.toISOString() : null
});

// --- CRUD -------------------------------------------------------------------

export const listFeedFilters = async (userId: string): Promise<{ ok: true; filters: PublicFeedFilter[] }> => {
  const home = await getHomeThingsCollection();
  const docs = await home.find({ thingtime: FEED_FILTER_KIND, ownerId: userId }).sort({ createdAt: 1 }).toArray();
  return { ok: true, filters: docs.map(toPublicFilter) };
};

export const saveFeedFilter = async (
  user: { id: string },
  input: { id?: unknown; name?: unknown; prompt?: unknown; action?: unknown; enabled?: unknown }
): Promise<{ ok: true; filter: PublicFeedFilter } | Fail> => {
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, MAX_NAME_CHARS) : '';
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim().slice(0, MAX_PROMPT_CHARS) : '';
  const action: FeedFilterAction = input.action === 'hide' ? 'hide' : 'warn';
  const enabled = input.enabled !== false;
  const home = await getHomeThingsCollection();

  if (input.id !== undefined && input.id !== null) {
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    const existing: any = id ? await home.findOne({ shareId: id, thingtime: FEED_FILTER_KIND, ownerId: user.id }) : null;
    if (!existing) return fail(404, 'Filter not found');
    const update: Record<string, any> = { 'crystal.enabled': enabled, 'crystal.action': action, updatedAt: new Date() };
    if (name) update['crystal.name'] = name;
    if (prompt) update['crystal.prompt'] = prompt;
    await home.updateOne({ shareId: id, thingtime: FEED_FILTER_KIND, ownerId: user.id }, { $set: update });
    const doc = await home.findOne({ shareId: id, thingtime: FEED_FILTER_KIND, ownerId: user.id });
    return { ok: true, filter: toPublicFilter(doc) };
  }

  if (!name) return fail(400, 'name is required');
  if (!prompt) return fail(400, 'prompt is required — describe what the filter should catch');
  const count = await home.countDocuments({ thingtime: FEED_FILTER_KIND, ownerId: user.id });
  if (count >= MAX_FILTERS_PER_USER) return fail(400, `You can hold at most ${MAX_FILTERS_PER_USER} filters`);

  const now = new Date();
  const doc = {
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
    shareId: feedFilterShareId(),
    thingtime: [FEED_FILTER_KIND],
    crystal: { name, prompt, action, enabled },
    ownerId: user.id,
    acl: [ACL_OWNER],
    storageClass: 'control',
    targetId: null,
    tags: [],
    createdAt: now,
    updatedAt: now
  };
  await home.insertOne(doc as any);
  return { ok: true, filter: toPublicFilter(doc) };
};

export const deleteFeedFilter = async (user: { id: string }, input: { id?: unknown }): Promise<{ ok: true; removed: boolean } | Fail> => {
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  if (!id) return fail(400, 'id is required');
  const home = await getHomeThingsCollection();
  const result = await home.deleteOne({ shareId: id, thingtime: FEED_FILTER_KIND, ownerId: user.id });
  if (!result.deletedCount) return fail(404, 'Filter not found');
  return { ok: true, removed: true };
};

// --- classification ---------------------------------------------------------

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'are', 'was', 'were', 'will', 'would', 'should',
  'could', 'about', 'into', 'over', 'under', 'when', 'where', 'what', 'which', 'who', 'whom', 'whose', 'why', 'how',
  'warn', 'hide', 'show', 'post', 'posts', 'feed', 'feeds', 'content', 'anything', 'something', 'news', 'me', 'my',
  'a', 'an', 'of', 'to', 'in', 'on', 'is', 'it', 'as', 'by', 'or', 'be', 'if', 'any', 'all', 'not', 'no', 'like'
]);

// tiny built-in expansions so common filter intents catch obvious matches
// without AI; the LLM path supersedes this whenever a provider is configured
const HEURISTIC_EXPANSIONS: Record<string, string[]> = {
  sad: ['sad', 'mourn', 'grief', 'tragic', 'tragedy', 'heartbreak', 'dies', 'died', 'death', 'closes', 'damage', 'disaster', 'wildfire', 'storm'],
  sport: ['sport', 'sports', 'football', 'soccer', 'basketball', 'tennis', 'cricket', 'match', 'league'],
  politic: ['politic', 'politics', 'election', 'senate', 'parliament', 'congress', 'minister', 'president'],
  crypto: ['crypto', 'bitcoin', 'ethereum', 'blockchain', 'token', 'coin']
};

const heuristicTokens = (prompt: string): string[] => {
  const words = prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
  const tokens = new Set<string>();
  for (const word of words) {
    tokens.add(word);
    for (const [root, expansion] of Object.entries(HEURISTIC_EXPANSIONS)) {
      if (word.startsWith(root)) expansion.forEach((token) => tokens.add(token));
    }
  }
  return [...tokens];
};

const heuristicVerdict = (prompt: string, text: string): { matched: boolean; reason: string } => {
  const haystack = text.toLowerCase();
  for (const token of heuristicTokens(prompt)) {
    if (haystack.includes(token)) return { matched: true, reason: `mentions “${token}”` };
  }
  return { matched: false, reason: '' };
};

const CLASSIFIER_SYSTEM =
  'You are a strict feed content classifier. The user gives one filter rule and a JSON list of posts. ' +
  'Decide for each post whether it MATCHES the rule. Reply with ONLY a JSON array like ' +
  '[{"id":"...","matched":true,"reason":"..."}] — one entry per post, reasons under 12 words, no other text.';

const aiVerdicts = async (
  prompt: string,
  posts: { id: string; text: string }[]
): Promise<{ byId: Map<string, { matched: boolean; reason: string }>; source: 'claude' | 'openai' } | null> => {
  const user =
    `Filter rule: ${prompt}\n\nPosts:\n` +
    JSON.stringify(posts.map((post) => ({ id: post.id, text: post.text.slice(0, CLASSIFY_TEXT_CHARS) })));
  const completion = await generateAiCompletion({ system: CLASSIFIER_SYSTEM, user, maxTokens: 1500 });
  if (!completion) return null;
  const jsonMatch = completion.text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return null;
  try {
    const rows = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(rows)) return null;
    const byId = new Map<string, { matched: boolean; reason: string }>();
    for (const row of rows) {
      if (row && typeof row.id === 'string') {
        byId.set(row.id, { matched: row.matched === true, reason: typeof row.reason === 'string' ? row.reason.slice(0, 200) : '' });
      }
    }
    return byId.size ? { byId, source: completion.source } : null;
  } catch {
    return null;
  }
};

// Classify a page of posts against the user's enabled filters, serving cached
// verdicts where present and persisting fresh ones. Returns matches per post.
export const applyFeedFilters = async (
  userId: string,
  posts: PublicPost[]
): Promise<{ matchesByPostId: Map<string, FeedFilterMatch[]>; filters: PublicFeedFilter[] }> => {
  const matchesByPostId = new Map<string, FeedFilterMatch[]>();
  const { filters } = await listFeedFilters(userId);
  const enabled = filters.filter((filter) => filter.enabled && filter.prompt);
  if (!enabled.length || !posts.length) return { matchesByPostId, filters };

  const things = await getThingsCollection();
  const pushMatch = (postId: string, match: FeedFilterMatch) => {
    const list = matchesByPostId.get(postId) || [];
    list.push(match);
    matchesByPostId.set(postId, list);
  };

  for (const filter of enabled) {
    const revisionKey = filterRevisionKey(filter);
    const verdictIds = new Map(posts.map((post) => [verdictShareId(revisionKey, post.id), post] as const));
    const cached: any[] = await things
      .find({ shareId: { $in: [...verdictIds.keys()] }, thingtime: FEED_FILTER_VERDICT_KIND })
      .toArray();
    const cachedByShareId = new Map(cached.map((doc) => [String(doc.shareId), doc]));

    const pending: { id: string; text: string; verdictId: string }[] = [];
    for (const [verdictId, post] of verdictIds) {
      const hit = cachedByShareId.get(verdictId);
      if (hit) {
        if (hit.crystal?.matched === true) {
          pushMatch(post.id, {
            filterId: filter.id,
            name: filter.name,
            action: filter.action,
            reason: String(hit.crystal?.reason || ''),
            source: hit.crystal?.source === 'claude' || hit.crystal?.source === 'openai' ? hit.crystal.source : 'heuristic'
          });
        }
      } else {
        pending.push({ id: post.id, text: `${post.text || ''}`, verdictId });
      }
    }

    // classify the uncached remainder in bounded batches
    for (let start = 0; start < pending.length; start += CLASSIFY_BATCH) {
      const batch = pending.slice(start, start + CLASSIFY_BATCH);
      let verdicts: Map<string, { matched: boolean; reason: string }> | null = null;
      let source: 'claude' | 'openai' | 'heuristic' = 'heuristic';
      if (hasLopuAiProviderConfigured()) {
        const ai = await aiVerdicts(filter.prompt, batch);
        if (ai) {
          verdicts = ai.byId;
          source = ai.source;
        }
      }
      const now = new Date();
      const writes = batch.map((entry) => {
        const verdict = verdicts?.get(entry.id) ?? heuristicVerdict(filter.prompt, entry.text);
        const entrySource = verdicts?.has(entry.id) ? source : 'heuristic';
        if (verdict.matched) {
          pushMatch(entry.id, {
            filterId: filter.id,
            name: filter.name,
            action: filter.action,
            reason: verdict.reason,
            source: entrySource
          });
        }
        return {
          updateOne: {
            filter: { shareId: entry.verdictId, thingtime: FEED_FILTER_VERDICT_KIND },
            update: {
              $setOnInsert: {
                schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
                shareId: entry.verdictId,
                thingtime: [FEED_FILTER_VERDICT_KIND],
                crystal: { revisionKey, postId: entry.id, matched: verdict.matched, reason: verdict.reason, source: entrySource },
                ownerId: 'system',
                acl: [],
                storageClass: 'control',
                targetId: null,
                tags: [],
                createdAt: now,
                updatedAt: now
              }
            },
            upsert: true
          }
        };
      });
      if (writes.length) {
        try {
          await things.bulkWrite(writes as any, { ordered: false });
        } catch (err: any) {
          if (err?.code !== 11000 && !err?.writeErrors?.every?.((error: any) => error?.code === 11000)) throw err;
        }
      }
    }
  }

  return { matchesByPostId, filters };
};
