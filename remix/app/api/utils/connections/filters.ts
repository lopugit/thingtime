import { generateAiCompletion, hasLopuAiProviderConfigured } from '../lopu/musing';
import { getHomeThingsCollection, getThingsCollection } from '../mongodb/collections';
import { enforceQuotaRateLimit } from '../rateLimit/enforce';
import type { PublicPost } from '../things/things';
import { fail, sha48, type Fail } from './shared';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';

// AI feed filters — user-defined rules layered over connected third-party
// feeds ("warn for sad news, with a Show button"). Two protected kinds:
//
//   • `feed-filter` — the user's rule: a natural-language prompt plus an
//     action ('warn' veils the post behind a Show button, 'hide' drops it).
//     HOME-pinned operational preference (storageClass 'control', owner-acl),
//     managed only through /api/v1/connections/filters.
//   • `feed-filter-verdict` — one cached classification per (filter revision,
//     post revision): deterministic `ext-verdict-…` shareId, so each post is
//     classified once per revision pair, not once per viewer per page load.
//     BOTH sides of that pair are content-derived — the key hashes the filter's
//     prompt and the post's text — so editing a filter re-classifies its posts,
//     and a post whose provider re-syncs it with new text is re-judged instead
//     of inheriting the verdict for the text it replaced.
//
// Classification prefers the shared LLM plumbing (musing.ts — the only module
// allowed to construct AI clients, provider waterfall + graceful no-key
// degradation) in one batched call per filter per page; without any AI key it
// falls back to a deterministic keyword heuristic so the feature (and its
// tests) always works.

export const FEED_FILTER_KIND = 'feed-filter';
export const FEED_FILTER_VERDICT_KIND = 'feed-filter-verdict';

const MAX_FILTERS_PER_USER = 20;
const MAX_NAME_CHARS = 80;
const MAX_PROMPT_CHARS = 500;
// batch size × per-verdict JSON must fit CLASSIFY_MAX_TOKENS with headroom —
// a truncated completion loses the closing bracket and the whole batch
const CLASSIFY_BATCH = 12;
const CLASSIFY_MAX_TOKENS = 3000;
const CLASSIFY_TEXT_CHARS = 600;
// bounded parallelism across filters' independent LLM calls
const CLASSIFY_CONCURRENCY = 4;
// How much AI one feed read may spend. Without these, a cold page costs
// ceil(posts/CLASSIFY_BATCH) × enabled-filters provider calls INLINE, before
// the response: at the documented caps (20 filters × a 50-post page) that is
// 100 completions of up to MUSING_MAX_OUTPUT_TOKENS each, ~25 of them
// sequential, on an endpoint whose bucket allows 120 reads/min. The other AI
// caller in the codebase (the musing) spends at most ONE completion per
// request and still gates it behind an explicit 10/hour quota, so this path
// must bound itself too. Overflow is NOT an error: it degrades to the same
// deterministic heuristic used when no key is configured, and — because
// heuristic verdicts are never cached while AI is available — the next read
// retries the real classification. So a page with more work than one request
// may spend simply converges over a few reads instead of blocking one long
// request, and the cache makes that convergence monotonic.
const CLASSIFY_MAX_AI_CALLS = 12;
// Wall clock is the second bound, because the call cap alone still trusts the
// provider to return: 12 calls that each hang is still a hung feed. The
// deadline is absolute and shared by every filter on the request, and it is
// enforced in BOTH places it can be lost — reserveAiCall refuses to start a
// call once it has passed, and the remaining budget is handed to
// generateAiCompletion, which abandons a stream that overruns it. Only the
// second one bounds a call already in flight: the provider SDKs fall back to
// their own 10-minute default, and `fluid: true` means the platform will wait.
// Overrunning is not an error — the batch degrades to the heuristic below and,
// being uncached, is retried for real on the next read.
const CLASSIFY_DEADLINE_MS = 20_000;
// The third bound, and the only one that survives the caller making a NEW
// request. CLASSIFY_MAX_AI_CALLS and CLASSIFY_DEADLINE_MS are both per-request,
// so on their own they cap the fan-out of one read and nothing else: the feed
// sits on `connections.read` (120/min), which multiplies out to 120 × 12 =
// 1,440 provider completions a minute from one signed-in account, on the shared
// ANTHROPIC_API_KEY/OPENAI_API_KEY.
//
// The verdict cache does not close that, because the caller controls it.
// Re-reading the same page is free, but `saveFeedFilter` reaps a filter's
// cached verdicts whenever its prompt changes (60 writes/min on
// `connections.write`), so alternating edit → read misses the cache every time
// and re-buys the whole page at full price.
//
// So this path gets what the codebase already gives its other AI caller: an
// explicit ACCOUNT allowance on top of the endpoint bucket (the musing spends
// one completion per request and still passes consumeLopuMusingQuota, 10/hour).
// enforceQuotaRateLimit keys on the user id alone, so rotating sessions,
// devices or IPs cannot reset it, and it fails closed when the limiter is down
// — the safe direction here, since the whole point is to not spend money we
// cannot account for.
//
// Sized for the documented caps rather than the median: a 50-post page against
// 20 filters is ~100 completions of genuinely new work, and 600/hour buys ~40
// such cold pages — far more feed than a person reads in an hour, while cutting
// the adversarial ceiling by ~140×. Exhaustion is NOT an error, exactly like
// overflowing the per-request cap: the batch degrades to the deterministic
// heuristic below and stays uncached, so the real classification is retried on
// the next read once the window rolls.
const CLASSIFY_HOURLY_AI_CALLS = 600;

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

const feedFilterShareId = (): string => `ext-filter-${sha48([String(Date.now()), String(Math.random())])}`;

// verdicts key on the filter REVISION (id + prompt hash) so prompt edits
// invalidate the cache naturally
const filterRevisionKey = (filter: { id: string; prompt: string }): string => sha48([filter.id, filter.prompt]);

// The text a verdict was reached on, normalized identically wherever the
// verdict id is derived and wherever the classifier is handed its input — the
// two must never drift, or a post caches under one key and is looked up under
// another.
const classifiedText = (post: { text?: unknown }): string => `${post.text || ''}`;

// Verdicts key on the CONTENT that was classified, not just the post id.
// External posts are current-state upserts: `crystal.text` is rewritten by
// every sync ("latest fetch wins by design", connections.ts), so the same post
// id legitimately carries different text later — an edited Mastodon status or
// Reddit post, an RSS item re-served under the same guid. Keyed on the id
// alone, the FIRST verdict is served forever (the cache doc is $setOnInsert,
// so a re-sync never refreshes it either): a `hide` rule silently stops
// applying to the edit, and a hostile feed can serve benign text on the sync
// that gets classified and the real content afterwards — filter evasion that
// needs no prompt injection at all.
//
// This does not weaken the cache. composePostText is a pure function of the
// item's title/body/url, and the volatile fields (stats, timestamps) live in
// extended.external rather than crystal.text — so unchanged content hashes to
// the same key and repeat reads stay free. Only a genuine edit costs one
// re-classification, which is exactly the work the edit created.
export const verdictShareId = (revisionKey: string, postId: string, text: string): string =>
  `ext-verdict-${sha48([revisionKey, postId, text])}`;

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
    // partial update: only fields the caller actually sent change — the UI's
    // {id, enabled} toggle must never rewrite action, and an action edit must
    // never re-enable a paused filter
    const update: Record<string, any> = { updatedAt: new Date() };
    if (typeof input.enabled === 'boolean') update['crystal.enabled'] = input.enabled;
    if (input.action === 'warn' || input.action === 'hide') update['crystal.action'] = input.action;
    if (name) update['crystal.name'] = name;
    if (prompt) update['crystal.prompt'] = prompt;
    await home.updateOne({ shareId: id, thingtime: FEED_FILTER_KIND, ownerId: user.id }, { $set: update });
    // a changed prompt re-keys the revision — reap the old revision's cached
    // verdicts so they can't linger as orphans
    if (prompt && prompt !== String(existing?.crystal?.prompt || '')) {
      const things = await getThingsCollection();
      await things.deleteMany({ thingtime: FEED_FILTER_VERDICT_KIND, 'crystal.filterId': id });
    }
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
  // reap the filter's cached verdicts — nothing can ever read them again
  const things = await getThingsCollection();
  await things.deleteMany({ thingtime: FEED_FILTER_VERDICT_KIND, 'crystal.filterId': id });
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
  posts: { id: string; text: string }[],
  deadlineAt: number
): Promise<{ byId: Map<string, { matched: boolean; reason: string }>; source: 'claude' | 'openai' } | null> => {
  const user =
    `Filter rule: ${prompt}\n\nPosts:\n` +
    JSON.stringify(posts.map((post) => ({ id: post.id, text: post.text.slice(0, CLASSIFY_TEXT_CHARS) })));
  // The request's remaining wall clock, handed to the provider call itself —
  // reserveAiCall's deadline check can only gate calls it has not started yet.
  const completion = await generateAiCompletion({
    system: CLASSIFIER_SYSTEM,
    user,
    maxTokens: CLASSIFY_MAX_TOKENS,
    timeoutMs: Math.max(1, deadlineAt - Date.now())
  });
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
  const aiConfigured = hasLopuAiProviderConfigured();
  // One AI budget shared by every filter on this request (see the constants).
  // The slot is reserved BEFORE awaiting so CLASSIFY_CONCURRENCY in-flight
  // calls can't collectively overshoot the cap.
  const deadlineAt = Date.now() + CLASSIFY_DEADLINE_MS;
  let aiCallsLeft = CLASSIFY_MAX_AI_CALLS;
  // Sticky once the account allowance is gone: without it every remaining batch
  // on this page would take another round-trip to the limiter collection just to
  // be told the same thing.
  let accountBudgetSpent = false;
  const reserveAiCall = async (): Promise<boolean> => {
    if (!aiConfigured || aiCallsLeft <= 0 || accountBudgetSpent || Date.now() >= deadlineAt) return false;
    // Claim the per-request slot SYNCHRONOUSLY, before the await below — the
    // CLASSIFY_CONCURRENCY filters run interleaved, and a check that yielded
    // first would let them all read the same aiCallsLeft and overshoot the cap.
    aiCallsLeft -= 1;
    const account = await enforceQuotaRateLimit('connections.classify', userId, CLASSIFY_HOURLY_AI_CALLS);
    if (!account.allowed) {
      accountBudgetSpent = true;
      return false;
    }
    return true;
  };
  const pushMatch = (postId: string, match: FeedFilterMatch) => {
    const list = matchesByPostId.get(postId) || [];
    list.push(match);
    matchesByPostId.set(postId, list);
  };

  // ONE cached-verdict read for every (filter, post) pair — verdict ids are
  // deterministic, so all filters batch into a single indexed $in
  const perFilter = enabled.map((filter) => {
    const revisionKey = filterRevisionKey(filter);
    return {
      filter,
      revisionKey,
      verdictIds: new Map(posts.map((post) => [verdictShareId(revisionKey, post.id, classifiedText(post)), post] as const))
    };
  });
  const allVerdictIds = perFilter.flatMap((entry) => [...entry.verdictIds.keys()]);
  const cached: any[] = await things.find({ shareId: { $in: allVerdictIds }, thingtime: FEED_FILTER_VERDICT_KIND }).toArray();
  const cachedByShareId = new Map(cached.map((doc) => [String(doc.shareId), doc]));

  const classifyFilter = async ({ filter, revisionKey, verdictIds }: (typeof perFilter)[number]) => {
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
        pending.push({ id: post.id, text: classifiedText(post), verdictId });
      }
    }

    for (let start = 0; start < pending.length; start += CLASSIFY_BATCH) {
      const batch = pending.slice(start, start + CLASSIFY_BATCH);
      let verdicts: Map<string, { matched: boolean; reason: string }> | null = null;
      let source: 'claude' | 'openai' | 'heuristic' = 'heuristic';
      if (await reserveAiCall()) {
        const ai = await aiVerdicts(filter.prompt, batch, deadlineAt);
        if (ai) {
          verdicts = ai.byId;
          source = ai.source;
        }
      }
      const now = new Date();
      const writes: any[] = [];
      for (const entry of batch) {
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
        // cache policy: heuristic verdicts persist only when no AI provider
        // is configured — with AI available, a transient failure/truncation
        // (or this request running out of its AI budget) must degrade THIS
        // response, never poison the cache. This is also what makes the budget
        // safe: unspent work stays uncached, so the next read retries it for
        // real and each read caches a little more until the page is fully
        // classified.
        if (entrySource === 'heuristic' && aiConfigured) continue;
        writes.push({
          updateOne: {
            filter: { shareId: entry.verdictId, thingtime: FEED_FILTER_VERDICT_KIND },
            update: {
              $setOnInsert: {
                schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
                shareId: entry.verdictId,
                thingtime: [FEED_FILTER_VERDICT_KIND],
                crystal: { revisionKey, filterId: filter.id, postId: entry.id, matched: verdict.matched, reason: verdict.reason, source: entrySource },
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
        });
      }
      if (writes.length) {
        try {
          await things.bulkWrite(writes as any, { ordered: false });
        } catch (err: any) {
          const writeErrors = Array.isArray(err?.writeErrors) ? err.writeErrors : null;
          const benign = writeErrors ? writeErrors.every((error: any) => error?.code === 11000) : err?.code === 11000;
          if (!benign) throw err;
        }
      }
    }
  };

  // filters classify independently — run them with bounded parallelism so a
  // cold page costs ~one LLM round instead of one per filter
  for (let start = 0; start < perFilter.length; start += CLASSIFY_CONCURRENCY) {
    await Promise.all(perFilter.slice(start, start + CLASSIFY_CONCURRENCY).map(classifyFilter));
  }

  return { matchesByPostId, filters };
};
