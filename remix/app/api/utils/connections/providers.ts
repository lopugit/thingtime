import { createHash } from 'node:crypto';

// Third-party feed providers — the adapter registry behind
// /api/v1/connections/*. Each provider resolves a connect form into a stable
// external account identity and pulls a normalized feed page for it. All
// providers here are keyless (public content APIs / RSS), so every one is
// live-testable with zero configuration; OAuth2 providers (Facebook,
// Instagram, X, …) join this registry config-gated by env credentials and
// report configured:false until those are present.

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

export type ExternalFeedItem = {
  // stable per provider — the dedupe/idempotency key for external-post things
  externalId: string;
  url: string | null;
  title: string | null;
  text: string;
  images: string[];
  author: { name: string | null; handle: string | null; avatarUrl: string | null; url: string | null };
  publishedAt: Date | null;
  stats: { likes?: number; comments?: number; shares?: number; score?: number } | null;
};

export type ResolvedExternalAccount = {
  // stable identity WITHIN the provider (two Thingtime users connecting the
  // same identity converge on one external-account thing)
  providerAccountId: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  profileUrl: string | null;
  // non-secret provider parameters (subreddits, instance host, …) — secrets
  // (OAuth tokens) never go here; they belong in the account's secure blob
  config: Record<string, string>;
};

export type ConnectField = {
  key: string;
  label: string;
  placeholder?: string;
  help?: string;
  required?: boolean;
};

export type ConnectionProvider = {
  id: string;
  name: string;
  icon: string;
  auth: 'none' | 'oauth2';
  // 'public': the feed is public content — external posts get a tt:all acl.
  // 'personal': the feed is the account's private algorithm — posts are
  // acl-granted per linked Thingtime user only.
  contentVisibility: 'public' | 'personal';
  about: string;
  configured: () => boolean;
  fields: ConnectField[];
  resolveAccount: (fields: Record<string, string>) => Promise<{ ok: true; account: ResolvedExternalAccount } | Fail>;
  fetchFeed: (
    account: { providerAccountId: string; config: Record<string, string> },
    opts: { limit: number }
  ) => Promise<{ ok: true; items: ExternalFeedItem[] } | Fail>;
};

export const FEED_FETCH_LIMIT = 30;
const FETCH_TIMEOUT_MS = 8000;
const MAX_TEXT_CHARS = 4000;
const MAX_TITLE_CHARS = 300;
const MAX_IMAGES = 5;
const USER_AGENT = 'thingtime-connections/1.0 (+https://thingtime.com)';

const sha1of = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 24);

// --- text/html hygiene ------------------------------------------------------

const decodeEntities = (value: string): string =>
  value
    .replace(/&#(\d+);/g, (_, num) => {
      const code = Number(num);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    })
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

export const stripHtml = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return decodeEntities(
    value
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const boundedText = (value: unknown, max: number): string => stripHtml(value).slice(0, max);

const httpsImage = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const url = decodeEntities(value.trim());
  return /^https:\/\/[^\s"'<>]+$/.test(url) && url.length <= 1500 ? url : null;
};

const boundedImages = (values: unknown[]): string[] => {
  const images: string[] = [];
  for (const value of values) {
    const url = httpsImage(value);
    if (url && !images.includes(url)) images.push(url);
    if (images.length >= MAX_IMAGES) break;
  }
  return images;
};

const dateOrNull = (value: unknown): Date | null => {
  const parsed = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
};

// --- bounded fetch helpers --------------------------------------------------

const fetchText = async (url: string, accept: string): Promise<{ ok: true; text: string } | Fail> => {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: accept },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow'
    });
    if (!resp.ok) return fail(502, `The provider answered ${resp.status} for ${new URL(url).host}`);
    const text = await resp.text();
    if (text.length > 3_000_000) return fail(502, 'The provider response was too large to process');
    return { ok: true, text };
  } catch (err: any) {
    const reason = err?.name === 'TimeoutError' ? 'timed out' : 'could not be reached';
    return fail(502, `The provider ${reason} (${new URL(url).host})`);
  }
};

const fetchJson = async (url: string): Promise<{ ok: true; data: any } | Fail> => {
  const result = await fetchText(url, 'application/json');
  if (result.ok === false) return result;
  try {
    return { ok: true, data: JSON.parse(result.text) };
  } catch {
    return fail(502, 'The provider returned malformed JSON');
  }
};

// A hostname input like "mastodon.social" — no scheme, no path, no userinfo.
const sanitizeHost = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  return /^[a-z0-9][a-z0-9.-]{1,200}\.[a-z]{2,}$/.test(host) ? host : null;
};

// --- minimal RSS/Atom parsing (well-formed feeds; no new dependencies) ------

const tagContent = (xml: string, tag: string): string | null => {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!match) return null;
  const inner = match[1].trim();
  const cdata = inner.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return (cdata ? cdata[1] : inner).trim();
};

const tagAttr = (xml: string, tag: string, attr: string): string | null => {
  const match = xml.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"[^>]*/?>`, 'i'));
  return match ? decodeEntities(match[1]) : null;
};

const blocksOf = (xml: string, tag: string): string[] => {
  const blocks: string[] = [];
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) && blocks.length < FEED_FETCH_LIMIT * 2) {
    blocks.push(match[1]);
  }
  return blocks;
};

type ParsedFeed = { title: string; link: string | null; items: ExternalFeedItem[] };

export const parseRssOrAtom = (xml: string): ParsedFeed | null => {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const items: ExternalFeedItem[] = [];
  if (isAtom) {
    const headEnd = xml.search(/<entry[\s>]/i);
    const head = headEnd === -1 ? xml : xml.slice(0, headEnd);
    const feedTitle = boundedText(tagContent(head, 'title') || '', MAX_TITLE_CHARS);
    const feedLink = tagAttr(head, 'link[^>]*rel="alternate"', 'href') || tagAttr(head, 'link', 'href');
    for (const entry of blocksOf(xml, 'entry')) {
      const id = tagContent(entry, 'id') || tagAttr(entry, 'link', 'href') || '';
      if (!id) continue;
      const title = boundedText(tagContent(entry, 'title') || '', MAX_TITLE_CHARS);
      const body = tagContent(entry, 'media:description') || tagContent(entry, 'content') || tagContent(entry, 'summary') || '';
      const thumb = tagAttr(entry, 'media:thumbnail', 'url');
      items.push({
        externalId: id.slice(0, 500),
        url: tagAttr(entry, 'link', 'href'),
        title: title || null,
        text: boundedText(body, MAX_TEXT_CHARS),
        images: boundedImages([thumb]),
        author: { name: boundedText(tagContent(entry, 'name') || '', 120) || null, handle: null, avatarUrl: null, url: null },
        publishedAt: dateOrNull(tagContent(entry, 'published') || tagContent(entry, 'updated')),
        stats: null
      });
    }
    return { title: feedTitle, link: feedLink, items };
  }
  if (!/<rss[\s>]|<channel[\s>]/i.test(xml)) return null;
  const headEnd = xml.search(/<item[\s>]/i);
  const head = headEnd === -1 ? xml : xml.slice(0, headEnd);
  const feedTitle = boundedText(tagContent(head, 'title') || '', MAX_TITLE_CHARS);
  const feedLink = tagContent(head, 'link');
  for (const item of blocksOf(xml, 'item')) {
    const link = tagContent(item, 'link');
    const guid = tagContent(item, 'guid') || link || '';
    if (!guid) continue;
    const enclosure = tagAttr(item, 'enclosure[^>]*type="image\\/[^"]*"', 'url') || tagAttr(item, 'media:content', 'url');
    items.push({
      externalId: guid.slice(0, 500),
      url: link ? decodeEntities(link).slice(0, 1500) : null,
      title: boundedText(tagContent(item, 'title') || '', MAX_TITLE_CHARS) || null,
      text: boundedText(tagContent(item, 'content:encoded') || tagContent(item, 'description') || '', MAX_TEXT_CHARS),
      images: boundedImages([enclosure, tagAttr(item, 'media:thumbnail', 'url')]),
      author: { name: boundedText(tagContent(item, 'dc:creator') || tagContent(item, 'author') || '', 120) || null, handle: null, avatarUrl: null, url: null },
      publishedAt: dateOrNull(tagContent(item, 'pubDate') || tagContent(item, 'dc:date')),
      stats: null
    });
  }
  return { title: feedTitle, link: feedLink ? decodeEntities(feedLink) : null, items };
};

// --- demo provider ----------------------------------------------------------
// A deterministic synthetic "personal algorithm" — the full personalized-feed
// path (connect → sync → acl-gated posts → comments/reactions → AI filters)
// is E2E-testable with zero network and zero secrets. New posts "arrive" as
// hours pass; content rotates through moods so filter rules have matches.

const DEMO_TOPICS = [
  { mood: 'happy', title: 'Community garden doubles its harvest', text: 'Volunteers celebrated a record season — twice the vegetables of last year, all donated to the local food bank. 🥕' },
  { mood: 'sad', title: 'Beloved local bookstore closes after 40 years', text: 'Readers mourned as the little shop on Main St announced its final day. The owner said rising rents left no other choice.' },
  { mood: 'happy', title: 'Rescue dog learns to surf, wins hearts', text: 'A three-legged rescue pup caught its first wave this weekend and the whole beach cheered.' },
  { mood: 'sad', title: 'Storm damages historic pier, repairs uncertain', text: 'Overnight winds tore through the century-old boardwalk. Engineers called the damage heartbreaking and severe.' },
  { mood: 'neutral', title: 'City tests new bike lane layout downtown', text: 'The trial reshuffles two blocks of parking; feedback is open until the end of the month.' },
  { mood: 'happy', title: 'Local teen wins international science fair', text: 'Her low-cost water filter design took first prize and a university scholarship.' },
  { mood: 'sad', title: 'Wildfire smoke returns to the valley', text: 'Air quality warnings are back as distant fires send another tragic plume across the region.' },
  { mood: 'neutral', title: 'Farmers market moves to the riverside lot', text: 'Same vendors, new views — the Saturday market relocates starting next week.' },
  { mood: 'happy', title: 'Stray cat elected honorary station master', text: 'Commuters delighted as the fluffy regular got a tiny hat and an official plaque.' },
  { mood: 'neutral', title: 'Library extends late hours for exam season', text: 'Study rooms stay open till midnight through the end of the month.' }
];

const demoProvider: ConnectionProvider = {
  id: 'demo',
  name: 'Demo Feed',
  icon: '🧪',
  auth: 'none',
  contentVisibility: 'personal',
  about: 'A synthetic personalized feed for trying connections end to end — no external account needed.',
  configured: () => true,
  fields: [
    { key: 'handle', label: 'Demo handle', placeholder: 'my-demo', help: 'Any name — it seeds your personal demo algorithm.', required: true }
  ],
  resolveAccount: async (fields) => {
    const handle = (fields.handle || 'demo').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'demo';
    return {
      ok: true,
      account: {
        providerAccountId: handle,
        displayName: `Demo · ${handle}`,
        handle,
        avatarUrl: null,
        profileUrl: null,
        config: { handle }
      }
    };
  },
  fetchFeed: async (account, opts) => {
    const handle = account.config.handle || account.providerAccountId;
    // one new post per hour per handle, deterministic content — reruns of the
    // same hour upsert the same externalIds (idempotent sync by construction)
    const hourIndex = Math.floor(Date.now() / 3_600_000);
    const items: ExternalFeedItem[] = [];
    for (let i = 0; i < Math.min(opts.limit, 20); i++) {
      const slot = hourIndex - i;
      const seed = Number.parseInt(sha1of(`${handle}:${slot}`).slice(0, 8), 16);
      const topic = DEMO_TOPICS[seed % DEMO_TOPICS.length];
      items.push({
        externalId: `demo-${handle}-${slot}`,
        url: null,
        title: topic.title,
        text: `${topic.text}\n\n(Demo algorithm pick #${slot % 1000} for @${handle}.)`,
        images: [],
        author: { name: 'Demo Algorithm', handle: `algo-${handle}`, avatarUrl: null, url: null },
        publishedAt: new Date(slot * 3_600_000),
        stats: { likes: seed % 250, comments: seed % 40, shares: seed % 15 }
      });
    }
    return { ok: true, items };
  }
};

// --- rss --------------------------------------------------------------------

const rssProvider: ConnectionProvider = {
  id: 'rss',
  name: 'RSS / Atom',
  icon: '📰',
  auth: 'none',
  contentVisibility: 'public',
  about: 'Follow any site that publishes an RSS or Atom feed.',
  configured: () => true,
  fields: [{ key: 'feedUrl', label: 'Feed URL', placeholder: 'https://example.com/feed.xml', required: true }],
  resolveAccount: async (fields) => {
    const raw = (fields.feedUrl || '').trim();
    if (!/^https:\/\/[^\s]+$/i.test(raw) || raw.length > 1500) return fail(400, 'feedUrl must be an https:// URL');
    const fetched = await fetchText(raw, 'application/rss+xml, application/atom+xml, application/xml, text/xml');
    if (fetched.ok === false) return fetched;
    const feed = parseRssOrAtom(fetched.text);
    if (!feed) return fail(400, 'That URL does not look like an RSS or Atom feed');
    const host = new URL(raw).host;
    return {
      ok: true,
      account: {
        providerAccountId: raw.toLowerCase(),
        displayName: feed.title || host,
        handle: host,
        avatarUrl: null,
        profileUrl: feed.link,
        config: { feedUrl: raw }
      }
    };
  },
  fetchFeed: async (account, opts) => {
    const fetched = await fetchText(account.config.feedUrl, 'application/rss+xml, application/atom+xml, application/xml, text/xml');
    if (fetched.ok === false) return fetched;
    const feed = parseRssOrAtom(fetched.text);
    if (!feed) return fail(502, 'The feed could not be parsed');
    return { ok: true, items: feed.items.slice(0, opts.limit) };
  }
};

// --- reddit -----------------------------------------------------------------

const redditProvider: ConnectionProvider = {
  id: 'reddit',
  name: 'Reddit',
  icon: '👽',
  auth: 'none',
  contentVisibility: 'public',
  about: 'Follow one or more subreddits (public feeds — no Reddit login needed).',
  configured: () => true,
  fields: [
    { key: 'subreddits', label: 'Subreddits', placeholder: 'worldnews+technology', help: 'One or more subreddit names joined with + or commas.', required: true },
    { key: 'sort', label: 'Sort', placeholder: 'hot', help: 'hot, new, top, or rising (default hot).' }
  ],
  resolveAccount: async (fields) => {
    const subs = (fields.subreddits || '')
      .split(/[+,\s]+/)
      .map((sub) => sub.trim().replace(/^r\//i, '').toLowerCase())
      .filter((sub) => /^[a-z0-9_]{2,50}$/.test(sub))
      .slice(0, 10);
    if (!subs.length) return fail(400, 'subreddits must name at least one subreddit');
    const sort = ['hot', 'new', 'top', 'rising'].includes((fields.sort || '').trim().toLowerCase()) ? (fields.sort || '').trim().toLowerCase() : 'hot';
    const joined = subs.join('+');
    return {
      ok: true,
      account: {
        providerAccountId: `${joined}:${sort}`,
        displayName: `r/${joined}`,
        handle: `r/${joined}`,
        avatarUrl: null,
        profileUrl: `https://www.reddit.com/r/${joined}/`,
        config: { subreddits: joined, sort }
      }
    };
  },
  fetchFeed: async (account, opts) => {
    // Reddit's public .json endpoints 403 non-browser clients, but the Atom
    // .rss twins of the same listings stay open — parse those instead.
    const { subreddits, sort } = account.config;
    const url = `https://www.reddit.com/r/${subreddits}/${sort || 'hot'}.rss?limit=${Math.min(opts.limit, 50)}`;
    const fetched = await fetchText(url, 'application/atom+xml, application/xml');
    if (fetched.ok === false) return fetched;
    const feed = parseRssOrAtom(fetched.text);
    if (!feed) return fail(502, 'The subreddit feed could not be parsed');
    return { ok: true, items: feed.items.slice(0, opts.limit) };
  }
};

// --- hacker news ------------------------------------------------------------

const hackerNewsProvider: ConnectionProvider = {
  id: 'hackernews',
  name: 'Hacker News',
  icon: '🟠',
  auth: 'none',
  contentVisibility: 'public',
  about: 'Top, new, or best stories from Hacker News.',
  configured: () => true,
  fields: [{ key: 'feed', label: 'Story list', placeholder: 'top', help: 'top, new, or best (default top).' }],
  resolveAccount: async (fields) => {
    const feed = ['top', 'new', 'best'].includes((fields.feed || '').trim().toLowerCase()) ? (fields.feed || '').trim().toLowerCase() : 'top';
    return {
      ok: true,
      account: {
        providerAccountId: feed,
        displayName: `Hacker News · ${feed}`,
        handle: `hn/${feed}`,
        avatarUrl: null,
        profileUrl: 'https://news.ycombinator.com/',
        config: { feed }
      }
    };
  },
  fetchFeed: async (account, opts) => {
    const list = await fetchJson(`https://hacker-news.firebaseio.com/v0/${account.config.feed || 'top'}stories.json`);
    if (list.ok === false) return list;
    const ids = (Array.isArray(list.data) ? list.data : []).slice(0, Math.min(opts.limit, 25));
    const stories = await Promise.all(ids.map((id: number) => fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)));
    const items: ExternalFeedItem[] = [];
    for (const story of stories) {
      if (story.ok === false || !story.data?.id) continue;
      const data = story.data;
      items.push({
        externalId: `hn-${data.id}`,
        url: typeof data.url === 'string' ? data.url.slice(0, 1500) : `https://news.ycombinator.com/item?id=${data.id}`,
        title: boundedText(data.title, MAX_TITLE_CHARS) || null,
        text: boundedText(data.text || '', MAX_TEXT_CHARS),
        images: [],
        author: {
          name: typeof data.by === 'string' ? data.by : null,
          handle: typeof data.by === 'string' ? data.by : null,
          avatarUrl: null,
          url: typeof data.by === 'string' ? `https://news.ycombinator.com/user?id=${data.by}` : null
        },
        publishedAt: typeof data.time === 'number' ? new Date(data.time * 1000) : null,
        stats: { score: data.score, comments: data.descendants }
      });
    }
    return { ok: true, items };
  }
};

// --- youtube ----------------------------------------------------------------

const youtubeProvider: ConnectionProvider = {
  id: 'youtube',
  name: 'YouTube',
  icon: '📺',
  auth: 'none',
  contentVisibility: 'public',
  about: "Follow a channel's uploads via its public feed (channel ID starts with UC…).",
  configured: () => true,
  fields: [
    { key: 'channelId', label: 'Channel ID', placeholder: 'UCXuqSBlHAE6Xw-yeJA0Tunw', help: 'The UC… id from the channel URL or its About page.', required: true }
  ],
  resolveAccount: async (fields) => {
    const channelId = (fields.channelId || '').trim();
    if (!/^UC[A-Za-z0-9_-]{10,60}$/.test(channelId)) return fail(400, 'channelId must be a YouTube channel id starting with UC');
    const fetched = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, 'application/atom+xml, application/xml');
    if (fetched.ok === false) return fetched;
    const feed = parseRssOrAtom(fetched.text);
    if (!feed) return fail(502, 'YouTube did not return a channel feed for that id');
    return {
      ok: true,
      account: {
        providerAccountId: channelId,
        displayName: feed.title || channelId,
        handle: feed.title || channelId,
        avatarUrl: null,
        profileUrl: `https://www.youtube.com/channel/${channelId}`,
        config: { channelId }
      }
    };
  },
  fetchFeed: async (account, opts) => {
    const fetched = await fetchText(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${account.config.channelId}`,
      'application/atom+xml, application/xml'
    );
    if (fetched.ok === false) return fetched;
    const feed = parseRssOrAtom(fetched.text);
    if (!feed) return fail(502, 'The channel feed could not be parsed');
    return { ok: true, items: feed.items.slice(0, opts.limit) };
  }
};

// --- mastodon ---------------------------------------------------------------

const mastodonProvider: ConnectionProvider = {
  id: 'mastodon',
  name: 'Mastodon',
  icon: '🐘',
  auth: 'none',
  contentVisibility: 'public',
  about: "An instance's local timeline, or one account's posts, from any Mastodon server.",
  configured: () => true,
  fields: [
    { key: 'instance', label: 'Instance', placeholder: 'mastodon.social', required: true },
    { key: 'account', label: 'Account (optional)', placeholder: 'Gargron', help: 'Leave empty to follow the instance-wide local timeline.' }
  ],
  resolveAccount: async (fields) => {
    const instance = sanitizeHost(fields.instance);
    if (!instance) return fail(400, 'instance must be a hostname like mastodon.social');
    const acct = (fields.account || '').trim().replace(/^@/, '');
    if (!acct) {
      return {
        ok: true,
        account: {
          providerAccountId: `${instance}:local`,
          displayName: `${instance} · local timeline`,
          handle: instance,
          avatarUrl: null,
          profileUrl: `https://${instance}/public/local`,
          config: { instance, accountId: '', account: '' }
        }
      };
    }
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(acct)) return fail(400, 'account must be a Mastodon username on that instance');
    const looked = await fetchJson(`https://${instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(acct)}`);
    if (looked.ok === false) return looked;
    if (!looked.data?.id) return fail(404, `@${acct} was not found on ${instance}`);
    return {
      ok: true,
      account: {
        providerAccountId: `${instance}:@${String(looked.data.acct || acct).toLowerCase()}`,
        displayName: boundedText(looked.data.display_name, 120) || `@${acct}`,
        handle: `@${looked.data.acct || acct}@${instance}`,
        avatarUrl: httpsImage(looked.data.avatar),
        profileUrl: typeof looked.data.url === 'string' ? looked.data.url.slice(0, 1500) : `https://${instance}/@${acct}`,
        config: { instance, accountId: String(looked.data.id), account: acct }
      }
    };
  },
  fetchFeed: async (account, opts) => {
    const { instance, accountId } = account.config;
    const limit = Math.min(opts.limit, 40);
    const url = accountId
      ? `https://${instance}/api/v1/accounts/${accountId}/statuses?limit=${limit}&exclude_replies=true`
      : `https://${instance}/api/v1/timelines/public?local=true&limit=${limit}`;
    const fetched = await fetchJson(url);
    if (fetched.ok === false) return fetched;
    const statuses = Array.isArray(fetched.data) ? fetched.data : [];
    const items: ExternalFeedItem[] = [];
    for (const status of statuses) {
      if (!status?.id) continue;
      const src = status.reblog || status;
      items.push({
        externalId: `${instance}-${status.id}`,
        url: typeof src.url === 'string' ? src.url.slice(0, 1500) : null,
        title: null,
        text: boundedText(src.content || '', MAX_TEXT_CHARS),
        images: boundedImages((src.media_attachments || []).map((media: any) => media?.preview_url || media?.url)),
        author: {
          name: boundedText(src.account?.display_name, 120) || null,
          handle: src.account?.acct ? `@${src.account.acct}` : null,
          avatarUrl: httpsImage(src.account?.avatar),
          url: typeof src.account?.url === 'string' ? src.account.url.slice(0, 1500) : null
        },
        publishedAt: dateOrNull(src.created_at),
        stats: { likes: src.favourites_count, comments: src.replies_count, shares: src.reblogs_count }
      });
      if (items.length >= opts.limit) break;
    }
    return { ok: true, items };
  }
};

// --- bluesky ----------------------------------------------------------------

const blueskyProvider: ConnectionProvider = {
  id: 'bluesky',
  name: 'Bluesky',
  icon: '🦋',
  auth: 'none',
  contentVisibility: 'public',
  about: "An account's posts via the public Bluesky AppView API.",
  configured: () => true,
  fields: [{ key: 'handle', label: 'Handle', placeholder: 'jay.bsky.team', required: true }],
  resolveAccount: async (fields) => {
    const handle = (fields.handle || '').trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9.-]{2,200}$/.test(handle)) return fail(400, 'handle must be a Bluesky handle like name.bsky.social');
    const profile = await fetchJson(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`);
    if (profile.ok === false) return profile;
    if (!profile.data?.did) return fail(404, `@${handle} was not found on Bluesky`);
    return {
      ok: true,
      account: {
        providerAccountId: String(profile.data.did),
        displayName: boundedText(profile.data.displayName, 120) || `@${handle}`,
        handle: `@${handle}`,
        avatarUrl: httpsImage(profile.data.avatar),
        profileUrl: `https://bsky.app/profile/${handle}`,
        config: { handle, did: String(profile.data.did) }
      }
    };
  },
  fetchFeed: async (account, opts) => {
    const actor = account.config.did || account.config.handle;
    const fetched = await fetchJson(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}&limit=${Math.min(opts.limit, 50)}&filter=posts_no_replies`
    );
    if (fetched.ok === false) return fetched;
    const entries = Array.isArray(fetched.data?.feed) ? fetched.data.feed : [];
    const items: ExternalFeedItem[] = [];
    for (const entry of entries) {
      const post = entry?.post;
      if (!post?.uri) continue;
      const embedImages = (post.embed?.images || post.record?.embed?.images || []).map((image: any) => image?.fullsize || image?.thumb);
      const rkey = String(post.uri).split('/').pop();
      items.push({
        externalId: String(post.uri).slice(0, 500),
        url: post.author?.handle && rkey ? `https://bsky.app/profile/${post.author.handle}/post/${rkey}` : null,
        title: null,
        text: boundedText(post.record?.text || '', MAX_TEXT_CHARS),
        images: boundedImages(embedImages),
        author: {
          name: boundedText(post.author?.displayName, 120) || null,
          handle: post.author?.handle ? `@${post.author.handle}` : null,
          avatarUrl: httpsImage(post.author?.avatar),
          url: post.author?.handle ? `https://bsky.app/profile/${post.author.handle}` : null
        },
        publishedAt: dateOrNull(post.record?.createdAt || post.indexedAt),
        stats: { likes: post.likeCount, comments: post.replyCount, shares: post.repostCount }
      });
      if (items.length >= opts.limit) break;
    }
    return { ok: true, items };
  }
};

// --- lemmy ------------------------------------------------------------------

const lemmyProvider: ConnectionProvider = {
  id: 'lemmy',
  name: 'Lemmy',
  icon: '🐭',
  auth: 'none',
  contentVisibility: 'public',
  about: "An instance's front page, or one community, from any Lemmy server.",
  configured: () => true,
  fields: [
    { key: 'instance', label: 'Instance', placeholder: 'lemmy.world', required: true },
    { key: 'community', label: 'Community (optional)', placeholder: 'technology', help: 'Leave empty for the instance front page.' }
  ],
  resolveAccount: async (fields) => {
    const instance = sanitizeHost(fields.instance);
    if (!instance) return fail(400, 'instance must be a hostname like lemmy.world');
    const community = (fields.community || '').trim().toLowerCase().replace(/^!/, '');
    if (community && !/^[a-z0-9_]{2,80}$/.test(community)) return fail(400, 'community must be a Lemmy community name');
    const probe = await fetchJson(
      community
        ? `https://${instance}/api/v3/community?name=${encodeURIComponent(community)}`
        : `https://${instance}/api/v3/site`
    );
    if (probe.ok === false) return probe;
    const title = community
      ? boundedText(probe.data?.community_view?.community?.title, 120) || `!${community}`
      : boundedText(probe.data?.site_view?.site?.name, 120) || instance;
    return {
      ok: true,
      account: {
        providerAccountId: community ? `${instance}:!${community}` : `${instance}:front`,
        displayName: `${title} · ${instance}`,
        handle: community ? `!${community}@${instance}` : instance,
        avatarUrl: httpsImage(community ? probe.data?.community_view?.community?.icon : probe.data?.site_view?.site?.icon),
        profileUrl: community ? `https://${instance}/c/${community}` : `https://${instance}/`,
        config: { instance, community }
      }
    };
  },
  fetchFeed: async (account, opts) => {
    const { instance, community } = account.config;
    const url = `https://${instance}/api/v3/post/list?limit=${Math.min(opts.limit, 40)}&sort=Hot${community ? `&community_name=${encodeURIComponent(community)}` : ''}`;
    const fetched = await fetchJson(url);
    if (fetched.ok === false) return fetched;
    const posts = Array.isArray(fetched.data?.posts) ? fetched.data.posts : [];
    const items: ExternalFeedItem[] = [];
    for (const view of posts) {
      const post = view?.post;
      if (!post?.id) continue;
      items.push({
        externalId: `${instance}-${post.id}`,
        url: typeof post.ap_id === 'string' ? post.ap_id.slice(0, 1500) : null,
        title: boundedText(post.name, MAX_TITLE_CHARS) || null,
        text: boundedText(post.body || '', MAX_TEXT_CHARS),
        images: boundedImages([post.thumbnail_url, post.url]),
        author: {
          name: boundedText(view.creator?.name, 120) || null,
          handle: view.creator?.name ? `@${view.creator.name}@${instance}` : null,
          avatarUrl: httpsImage(view.creator?.avatar),
          url: typeof view.creator?.actor_id === 'string' ? view.creator.actor_id.slice(0, 1500) : null
        },
        publishedAt: dateOrNull(post.published),
        stats: { score: view.counts?.score, comments: view.counts?.comments }
      });
      if (items.length >= opts.limit) break;
    }
    return { ok: true, items };
  }
};

// --- github -----------------------------------------------------------------

const githubEventSummary = (event: any): string => {
  const repo = event?.repo?.name || 'a repository';
  const payload = event?.payload || {};
  switch (event?.type) {
    case 'PushEvent': {
      const count = Array.isArray(payload.commits) ? payload.commits.length : 0;
      const first = payload.commits?.[0]?.message ? `: “${stripHtml(payload.commits[0].message).slice(0, 140)}”` : '';
      return `pushed ${count || 'new'} commit${count === 1 ? '' : 's'} to ${repo}${first}`;
    }
    case 'PullRequestEvent':
      return `${payload.action || 'updated'} a pull request in ${repo}: ${stripHtml(payload.pull_request?.title || '').slice(0, 140)}`;
    case 'IssuesEvent':
      return `${payload.action || 'updated'} an issue in ${repo}: ${stripHtml(payload.issue?.title || '').slice(0, 140)}`;
    case 'IssueCommentEvent':
      return `commented on ${repo}: ${stripHtml(payload.comment?.body || '').slice(0, 140)}`;
    case 'WatchEvent':
      return `starred ${repo}`;
    case 'ForkEvent':
      return `forked ${repo}`;
    case 'CreateEvent':
      return `created ${payload.ref_type || 'something'} ${payload.ref || ''} in ${repo}`.trim();
    case 'ReleaseEvent':
      return `released ${stripHtml(payload.release?.name || payload.release?.tag_name || '').slice(0, 80)} in ${repo}`;
    default:
      return `${String(event?.type || 'activity').replace(/Event$/, '')} in ${repo}`;
  }
};

const githubProvider: ConnectionProvider = {
  id: 'github',
  name: 'GitHub',
  icon: '🐙',
  auth: 'none',
  contentVisibility: 'public',
  about: "A user's public activity feed (pushes, PRs, issues, stars).",
  configured: () => true,
  fields: [{ key: 'username', label: 'Username', placeholder: 'torvalds', required: true }],
  resolveAccount: async (fields) => {
    const username = (fields.username || '').trim();
    if (!/^[A-Za-z0-9-]{1,60}$/.test(username)) return fail(400, 'username must be a GitHub username');
    const profile = await fetchJson(`https://api.github.com/users/${encodeURIComponent(username)}`);
    if (profile.ok === false) return profile;
    if (!profile.data?.login) return fail(404, `GitHub user ${username} was not found`);
    return {
      ok: true,
      account: {
        providerAccountId: String(profile.data.login).toLowerCase(),
        displayName: boundedText(profile.data.name, 120) || String(profile.data.login),
        handle: `@${profile.data.login}`,
        avatarUrl: httpsImage(profile.data.avatar_url),
        profileUrl: `https://github.com/${profile.data.login}`,
        config: { username: String(profile.data.login) }
      }
    };
  },
  fetchFeed: async (account, opts) => {
    const username = account.config.username;
    const fetched = await fetchJson(`https://api.github.com/users/${encodeURIComponent(username)}/events/public?per_page=${Math.min(opts.limit, 30)}`);
    if (fetched.ok === false) return fetched;
    const events = Array.isArray(fetched.data) ? fetched.data : [];
    const items: ExternalFeedItem[] = [];
    for (const event of events) {
      if (!event?.id) continue;
      items.push({
        externalId: `gh-${event.id}`,
        url: event.repo?.name ? `https://github.com/${event.repo.name}` : null,
        title: null,
        text: `@${username} ${githubEventSummary(event)}`,
        images: [],
        author: {
          name: username,
          handle: `@${username}`,
          avatarUrl: httpsImage(event.actor?.avatar_url),
          url: `https://github.com/${username}`
        },
        publishedAt: dateOrNull(event.created_at),
        stats: null
      });
      if (items.length >= opts.limit) break;
    }
    return { ok: true, items };
  }
};

// --- registry ---------------------------------------------------------------

export const CONNECTION_PROVIDERS: ConnectionProvider[] = [
  demoProvider,
  rssProvider,
  redditProvider,
  hackerNewsProvider,
  youtubeProvider,
  mastodonProvider,
  blueskyProvider,
  lemmyProvider,
  githubProvider
];

export const connectionProviderById = (id: unknown): ConnectionProvider | null =>
  typeof id === 'string' ? CONNECTION_PROVIDERS.find((provider) => provider.id === id.trim().toLowerCase()) || null : null;

// The public projection the providers list endpoint returns.
export const publicProviders = () =>
  CONNECTION_PROVIDERS.map((provider) => ({
    id: provider.id,
    name: provider.name,
    icon: provider.icon,
    auth: provider.auth,
    contentVisibility: provider.contentVisibility,
    about: provider.about,
    configured: provider.configured(),
    fields: provider.fields
  }));
