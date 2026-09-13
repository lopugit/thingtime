import { describeAttachmentTransfer } from '../attachments/attachments';
import { orderAttachmentDocsByStoredSort } from '../attachments/attachmentCore';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { resolveProfiles, type Viewer } from './things';
import { readLiveChatArchiveSource } from './liveChatArchiveRead';
import { normalizeLiveChatArchive } from './liveChatArchiveNormalize';
import { attachmentContentPath } from '../../../utils/attachmentContentUrl';
import { withExportDeadline } from '../../../utils/thingTransfer/exportDeadline';
import { TRANSFER_LIMITS } from '../../../utils/thingTransfer/format';
import type { LiveChatArchiveSnapshot } from './liveChatArchiveCore';
import type { OwnedChatArchive } from './chatArchiveReadTransfer';
import { readLiveChatArchiveEmojis } from './liveChatArchiveEmojiTransfer';
import type { TransferEmojiSource } from './emojiTransfer';
import { randomUUID } from 'node:crypto';
import { downloadArchiveAvatar } from './archiveAvatarDownload';

const defaults = { read: readLiveChatArchiveSource, profiles: resolveProfiles,
  describe: describeAttachmentTransfer, custom: isCustomMongoEndpointActive, emojis: readLiveChatArchiveEmojis,
  avatar: downloadArchiveAvatar };
const reject = (): never => { throw new Error('Complete chat media is unavailable'); };

/** Public profile projections contain either an exact first-party attachment
 * path or an external/legacy image. This adapter never fetches arbitrary URLs
 * and never converts a lookalike URL into first-party attachment authority. */
export const managedArchiveAvatarId = (url: string): string => {
  const prefix = '/api/v1/attachments/content?';
  if (!url.startsWith(prefix)) return reject();
  const id = new URLSearchParams(url.slice(prefix.length)).get('id');
  if (!id || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) || attachmentContentPath(id) !== url) return reject();
  return id;
};

/** First-party server adapter; the caller supplies its authenticated user scope,
 * never a field read from portable input. No write, messaging, invitation or
 * notification operations. Attachment metadata and later byte downloads each
 * pass the canonical attachment service's CURRENT read/moderation gates. */
export const readLiveChatArchiveTransfer = async (viewer: Viewer, id: string, firstPartyUserId: string | undefined,
  parent?: AbortSignal, overrides: Partial<typeof defaults> = {}): Promise<(OwnedChatArchive & { transferEmojis?: TransferEmojiSource[] }) | null> => {
  const deps = { ...defaults, ...overrides };
  if (!firstPartyUserId || viewer?.id !== firstPartyUserId || viewer.pat || deps.custom()) return null;
  return withExportDeadline(async signal => {
    const check = () => signal.throwIfAborted();
    check();
    const source = await deps.read(firstPartyUserId, id);
    check();
    if (!source) return null;
    if (source.chat.shareId !== id || !(source.chat.updatedAt instanceof Date) || !Number.isFinite(source.chat.updatedAt.getTime())) reject();
    const profiles = await deps.profiles(source.members.map(row => row.ownerId));
    check();
    const targets: { id: string; targetId: string; avatar: boolean; linked: boolean }[] =
      orderAttachmentDocsByStoredSort(source.attachments as { shareId: string; targetId: string; attachmentLinked?: boolean; attachmentSortIndex?: unknown }[]).map(row => ({ id: row.shareId, targetId: row.targetId,
        avatar: false, linked: row.attachmentLinked === true }));
    const avatars = new Map<string, string>();
    const inlineAvatarFiles: NonNullable<OwnedChatArchive['inlineAvatarFiles']> = [];
    let avatarBytes = 0;
    for (const member of source.members) {
      const profile = profiles.get(member.ownerId);
      if (!profile || profile.id !== member.ownerId) reject();
      if (!profile!.avatarUrl) continue;
      if (/^https:\/\//i.test(profile!.avatarUrl)) {
        const image = await deps.avatar(profile!.avatarUrl, signal);
        check();
        avatarBytes += image.bytes.length;
        if (!image.bytes.length || image.bytes.length > 2 * 1024 * 1024 || avatarBytes > TRANSFER_LIMITS.fileBytes ||
          !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(image.mime)) reject();
        const avatarId = `avatar-file:${randomUUID()}`;
        avatars.set(member.ownerId, avatarId);
        inlineAvatarFiles.push({ id: avatarId, targetId: member.shareId, name: 'historical-avatar',
          mime: image.mime, bytes: image.bytes.length, inlineBase64: Buffer.from(image.bytes).toString('base64') });
        continue;
      }
      const avatarId = managedArchiveAvatarId(profile!.avatarUrl);
      avatars.set(member.ownerId, avatarId);
      targets.push({ id: avatarId, targetId: member.shareId, avatar: true, linked: false });
    }
    if (targets.length + inlineAvatarFiles.length > TRANSFER_LIMITS.files || new Set([...targets, ...inlineAvatarFiles].map(row => row.id)).size !== targets.length + inlineAvatarFiles.length) reject();
    const files: LiveChatArchiveSnapshot['files'] = inlineAvatarFiles.map(({ id, targetId, mime, bytes }) => ({ id, targetId, mime, bytes }));
    const links: LiveChatArchiveSnapshot['links'] = [];
    let bytes = avatarBytes;
    for (const target of targets) {
      check();
      const result = await deps.describe(viewer, target.id, { includeFiles: true, includeLinks: true });
      check();
      if (!result.ok || ('excluded' in result && result.excluded)) reject();
      if (!result.ok || !('attachment' in result)) return reject();
      const file = result.attachment;
      if (file.id !== target.id || result.linked !== target.linked) reject();
      if (target.avatar && (result.linked || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.contentType) || file.size <= 0)) reject();
      if (result.linked) {
        if (!file.url || file.nsfw || file.pending) reject();
        links.push({ id: target.id, targetId: target.targetId });
      } else {
        if (!Number.isSafeInteger(file.size) || file.size < 0) reject();
        bytes += file.size;
        if (bytes > TRANSFER_LIMITS.fileBytes) reject();
        files.push({ id: target.id, targetId: target.targetId, mime: file.contentType, bytes: file.size });
      }
    }
    const archive = normalizeLiveChatArchive(source, firstPartyUserId, profiles, { files, links, avatars }, { aiHistory: true });
    check();
    const transferEmojis = await deps.emojis(archive.emojiIds);
    check();
    if (transferEmojis.length !== archive.emojiIds.length || new Set(transferEmojis.map(row => row.thing.id)).size !== archive.emojiIds.length ||
      transferEmojis.some(row => !archive.emojiIds.includes(row.thing.id))) reject();
    return { ...archive, transferEmojis, inlineAvatarFiles,
      attachmentTargets: [...targets, ...inlineAvatarFiles].map(({ id, targetId }) => ({ id, targetId })),
      updatedAt: source.chat.updatedAt.toISOString() };
  }, parent);
};
