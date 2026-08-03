// Custom emojis: one thing per emoji, image inline as a base64 data URI (the
// avatar-storage pattern — no binary infrastructure exists or is needed).
// Scope is a community (targetId set) or personal (targetId null); reactions
// reference emojis by id (`custom:<shareId>`), so a rename never orphans a
// reaction and cross-scope readers can always resolve the image by id.
//
// The image is validated as a data-URI STRING but stored as a BinData blob:
// the wildcard text index tokenizes every string field, and hundreds of
// ~700K-char base64 strings would silently bloat it (the same reasoning that
// keeps user secure state binary). Readers decode on the way out.
import { Binary } from 'mongodb';
import { getThingsCollection } from '../mongodb/collections';
import {
  EMOJI_DATA_URI_PATTERN,
  EMOJI_NAME_PATTERN,
  MAX_EMOJI_DATA_URI_CHARS,
  MAX_EMOJIS_PER_SCOPE
} from '~/schemas/registry';
import type { Fail} from './shared';
import { communityRoleOf, emojiScopeKey, fail, findThingByKind, newThingDoc, ROLE_RANK } from './shared';

export type PublicCustomEmoji = {
  id: string;
  name: string;
  image: string;
  animated: boolean;
  scope: 'community' | 'personal';
  communityId: string | null;
  createdBy: string;
  createdAt: string;
};

const packEmojiImage = (dataUri: string) => new Binary(Buffer.from(dataUri, 'utf8'));

// Decodes stored images (BinData now, plain string for any early doc).
export const emojiImageToString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof (value as any).buffer !== 'undefined') {
    try {
      return Buffer.from((value as Binary).buffer).toString('utf8');
    } catch {
      return '';
    }
  }
  return '';
};

const toPublicEmoji = (doc: any): PublicCustomEmoji => ({
  id: doc.shareId,
  name: doc.crystal?.name,
  image: emojiImageToString(doc.crystal?.image),
  animated: !!doc.crystal?.animated,
  scope: doc.targetId ? 'community' : 'personal',
  communityId: doc.targetId ? String(doc.targetId) : null,
  createdBy: String(doc.ownerId),
  createdAt: new Date(doc.createdAt).toISOString()
});

export type UploadEmojiResult = Fail | { ok: true; emoji: PublicCustomEmoji };

export const uploadEmoji = async (
  viewerId: string,
  input: { name?: unknown; image?: unknown; communityId?: unknown }
): Promise<UploadEmojiResult> => {
  const name = typeof input.name === 'string' ? input.name.trim().toLowerCase().replace(/^:+|:+$/g, '') : '';
  if (!EMOJI_NAME_PATTERN.test(name)) {
    return fail(400, 'Emoji names are 2-32 chars of lowercase letters, digits, - or _');
  }
  const image = typeof input.image === 'string' ? input.image.trim() : '';
  if (image.length > MAX_EMOJI_DATA_URI_CHARS) {
    return fail(400, `That image is too chunky — cap is ~${Math.round((MAX_EMOJI_DATA_URI_CHARS * 3) / 4 / 1024)}KB`);
  }
  if (!EMOJI_DATA_URI_PATTERN.test(image)) {
    return fail(400, 'Pass the image as a data:image/gif|webp|png|apng|jpeg;base64 URI');
  }
  let communityId: string | null = null;
  if (typeof input.communityId === 'string' && input.communityId.trim()) {
    const community = await findThingByKind('community', input.communityId.trim());
    if (!community) return fail(404, 'Community not found');
    // Slack's default: every member may grow the emoji set
    const role = await communityRoleOf(community.shareId, viewerId);
    if (!role) return fail(403, 'Join the community before adding emojis to it');
    communityId = community.shareId;
  }
  const scope = communityId || `user:${viewerId}`;
  const things = await getThingsCollection();
  const scopeFilter: any = communityId
    ? { thingtime: 'custom-emoji', targetId: communityId }
    : { thingtime: 'custom-emoji', targetId: null, ownerId: viewerId };
  const count = await things.countDocuments(scopeFilter);
  if (count >= MAX_EMOJIS_PER_SCOPE) return fail(400, `Emoji cap reached (${MAX_EMOJIS_PER_SCOPE}) — retire some first`);
  const animated = /^data:image\/(gif|apng)/i.test(image);
  const emoji = newThingDoc('custom-emoji', {
    ownerId: viewerId,
    targetId: communityId,
    crystal: { name, emojiKey: emojiScopeKey(scope, name), image: packEmojiImage(image), animated }
  });
  try {
    await things.insertOne(emoji as any);
  } catch (err: any) {
    if (err?.code === 11000) return fail(409, `:${name}: is already taken here`);
    throw err;
  }
  return { ok: true, emoji: { ...toPublicEmoji(emoji), image } };
};

export type ListEmojisResult = Fail | { ok: true; emojis: PublicCustomEmoji[] };

// Emojis usable in a given context: the community's set (resolved either
// directly or via a chat) plus the viewer's personal set. Members-only — the
// images are the payload, so the door matches the reaction door.
//
// `ids` is the resolution path for reaction chips: message payloads carry
// only { name, animated } per referenced emoji, and clients fetch images
// once by id (unguessable uuids that only ever travel inside chats the
// caller could already read) and cache them.
export const listEmojis = async (
  viewerId: string,
  input: { communityId?: unknown; chatId?: unknown; ids?: unknown }
): Promise<ListEmojisResult> => {
  if (Array.isArray(input.ids) && input.ids.length) {
    const ids = (input.ids as unknown[])
      .filter((id): id is string => typeof id === 'string' && !!id.trim())
      .map((id) => id.trim())
      .slice(0, 100);
    const things = await getThingsCollection();
    const docs = await things.find({ thingtime: 'custom-emoji', shareId: { $in: ids } } as any).toArray();
    return { ok: true, emojis: docs.map(toPublicEmoji) };
  }
  let communityId: string | null = null;
  if (typeof input.chatId === 'string' && input.chatId.trim()) {
    const chat = await findThingByKind('chat', input.chatId.trim());
    if (!chat) return fail(404, 'Chat not found');
    communityId = chat.crystal?.communityId || null;
  } else if (typeof input.communityId === 'string' && input.communityId.trim()) {
    communityId = input.communityId.trim();
  }
  if (communityId) {
    const role = await communityRoleOf(communityId, viewerId);
    if (!role) return fail(403, 'You are not a member of this community');
  }
  const things = await getThingsCollection();
  const filters: any[] = [{ thingtime: 'custom-emoji', targetId: null, ownerId: viewerId }];
  if (communityId) filters.push({ thingtime: 'custom-emoji', targetId: communityId });
  const docs = await things
    .find({ $or: filters } as any)
    .sort({ createdAt: 1, shareId: 1 })
    .limit(MAX_EMOJIS_PER_SCOPE * 2)
    .toArray();
  return { ok: true, emojis: docs.map(toPublicEmoji) };
};

export type DeleteEmojiResult = Fail | { ok: true };

export const deleteEmoji = async (viewerId: string, input: { id?: unknown }): Promise<DeleteEmojiResult> => {
  if (typeof input.id !== 'string' || !input.id.trim()) return fail(400, 'Emoji id required');
  const emoji = await findThingByKind('custom-emoji', input.id.trim());
  if (!emoji) return fail(404, 'Emoji not found');
  let allowed = String(emoji.ownerId) === viewerId;
  if (!allowed && emoji.targetId) {
    const role = await communityRoleOf(String(emoji.targetId), viewerId);
    allowed = !!role && ROLE_RANK[role] >= ROLE_RANK.admin;
  }
  if (!allowed) return fail(403, 'Only the uploader or a community admin can retire an emoji');
  const things = await getThingsCollection();
  await things.deleteOne({ shareId: emoji.shareId } as any);
  // existing `custom:<id>` reactions keep their chips; readers render a
  // placeholder once the id stops resolving — deliberate, like deleted users
  return { ok: true };
};
