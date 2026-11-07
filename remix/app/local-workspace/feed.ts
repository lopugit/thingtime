import type { PublicPost } from '../components/Feed/feedTypes';
import { THING_AUDIENCES } from '../components/Sharing/audienceCore';
import { searchLocalThings } from './structuredSearch';
import { WorkspaceError } from './storage';

export const DEVICE_FEED_CURSOR = 'device-feed:';
export const isDeviceFeedCursor = (cursor: unknown): cursor is string => typeof cursor === 'string' && cursor.startsWith(DEVICE_FEED_CURSOR);
export const deviceFeedRequested = (args: Record<string, unknown>) => args.device === true || isDeviceFeedCursor(args.cursor);
export const transientFeedFailure = (error: any) => error instanceof TypeError || ['TimeoutError', 'NetworkError'].includes(error?.name)
 || Number(error?.status) >= 500 || [408, 429].includes(Number(error?.status));
const invalid = (message: string): never => { throw new WorkspaceError('INVALID_DEVICE_FEED', message); };
const onlineRequired = (): never => { throw new WorkspaceError('DEVICE_FEED_ONLINE_REQUIRED', 'This feed needs an online connection. Choose On this device with Latest, New, or a local feed brain to browse saved posts.', 409); };
const fields = new Set(['device', 'cursor', 'limit', 'algorithm', 'types', 'circles', 'tag', 'from', 'to', 'scope', 'anon', 'localTag', 'lat', 'lng', 'radiusKm']);

/** Display already-authorized projections from exactly one workspace. This
 * never discovers memberships, grants access, or claims a complete remote feed.
 * Local profiles rank each chronological page, matching the online adapter. */
export async function deviceFeedPage(posts: PublicPost[], args: Record<string, unknown>, scopeKey: string, localAlgorithm: string | null = null) {
 for (const [key, value] of Object.entries(args)) if (value !== undefined && !fields.has(key)) invalid(`The device feed does not support the ${key} filter.`);
 const algorithm = args.algorithm ?? 'latest';
 if (algorithm !== 'latest' && algorithm !== 'new' && algorithm !== localAlgorithm) onlineRequired();
 if ((args.scope != null && args.scope !== 'all') || args.lat != null || args.lng != null || args.radiusKm != null || args.localTag) onlineRequired();
 const list = (value: unknown, allowed: readonly string[], label: string) => {
  if (value == null) return [];
  const values = typeof value === 'string' ? value.split(',').filter(Boolean) : value;
  if (!Array.isArray(values) || values.some(item => typeof item !== 'string' || !allowed.includes(item))) invalid(`Choose valid ${label} filters.`);
  return [...new Set(values as string[])].sort();
 };
 const types = list(args.types, ['text', 'image', 'marketplace', 'thingtime'], 'post type'), circles = list(args.circles, THING_AUDIENCES, 'audience');
 if (args.tag != null && typeof args.tag !== 'string') invalid('Choose a valid tag.');
 const tag = String(args.tag || '').trim().toLowerCase().replace(/^#/, '');
 const date = (value: unknown) => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) invalid('Choose a valid feed date.');
  return new Date(value as string).toISOString();
 };
 const from = date(args.from), to = date(args.to);
 if (from && to && from > to) invalid('The start date must be before the end date.');
 if (args.cursor && !isDeviceFeedCursor(args.cursor)) invalid('Reload the feed to browse device posts; an online cursor cannot be used offline.');
 const selected = posts.filter(post => post.thingtime.includes('post') && !post.thingtime.includes('comment')
  && (!types.length || types.includes(post.type)) && (!circles.length || circles.includes(post.visibility))
  && (!tag || post.tags?.some(value => value.toLowerCase() === tag))
  && (!from || post.createdAt >= from) && (!to || post.createdAt <= to));
 const byId = new Map(selected.map(post => [post.id, post]));
 const rows = [...byId.values()].map(post => ({ id: post.id, thingtime: ['post'], crystal: {}, createdAt: post.createdAt, updatedAt: post.createdAt, revision: 0 }));
 const page = await searchLocalThings(rows, { cursor: args.cursor ? (args.cursor as string).slice(DEVICE_FEED_CURSOR.length) : undefined, limit: args.limit ?? 20 },
  JSON.stringify([scopeKey, 'feed', algorithm, types, circles, tag, from, to]));
 return { ok: true, posts: page.things.map(row => byId.get(row.id)!), nextCursor: page.nextCursor ? DEVICE_FEED_CURSOR + page.nextCursor : null,
  ranked: false, localWorkspace: true, source: 'device' as const, incomplete: true };
}
