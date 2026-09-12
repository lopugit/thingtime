import { findViewableThing, listThings, toPublicThings, isFail, fail, type Viewer, type ThingDoc, type PublicThing } from './things';
import { resolveSharedComposition, type SharedComposition } from '../actions/sharedComposition';
import { rewriteComposition } from '../actions/forkCompositionCore';
import { compositionAttachmentIds } from '../actions/compositionMediaCore';
import { listForkBoundMedia } from '../actions/forkBoundMedia';
import { describeAttachmentTransfer } from '../attachments/attachments';
import { canForkThing } from '../../../components/Sharing/forkThingCore';
import { isProtectedThingtime } from '../../../schemas/registry';
import { collectTransfer } from '../../../utils/thingTransfer/collect';
import { transferAnnotations, TRANSFER_LIMITS, type TransferThing, type JsonValue } from '../../../utils/thingTransfer/format';
import type { TransferPlan } from '../../../utils/thingTransfer/plan';
import { readTransferTheme } from './themeTransfer';
import { readTransferAlgorithm } from './algorithmTransfer';
import { readTransferRecording } from './recordingTransfer';
import { isTransferRecording } from '../../../utils/thingTransfer/recording';
import { isTransferEmoji } from '../../../utils/thingTransfer/emoji';
import { readTransferEmoji, type TransferEmojiSource } from './emojiTransfer';
import { readOwnedChatArchive, type OwnedChatArchive } from './chatArchiveReadTransfer';
import { validateChatArchiveRecords } from '../../../utils/thingTransfer/chatArchive';
import { readLiveChatArchiveTransfer } from './liveChatArchiveTransfer';

const defaults = { read: findViewableThing, readArchive: readOwnedChatArchive, readLiveArchive: readLiveChatArchiveTransfer, readTheme: readTransferTheme, readAlgorithm: readTransferAlgorithm, readRecording: readTransferRecording, readEmoji: readTransferEmoji, list: listThings, resolve: resolveSharedComposition, project: toPublicThings, bound: listForkBoundMedia, describe: describeAttachmentTransfer };

const content = (thing: PublicThing): TransferThing => ({
  id: thing.id, thingtime: thing.thingtime, crystal: thing.crystal,
  ...(thing.extended === undefined ? {} : { extended: thing.extended as JsonValue }),
  ...(thing.tags === undefined ? {} : { tags: thing.tags }),
  ...(thing.folderId ? { folderId: thing.folderId } : {}),
  ...(thing.targetId ? { targetId: thing.targetId } : {})
});

export const exportTransferPlan = async (viewer: Viewer, input: {
  ids?: unknown; includeChildren?: unknown; includeDependencies?: unknown; includeFiles?: unknown; includeLinks?: unknown;
}, signal?: AbortSignal, overrides: Partial<typeof defaults> = {}, context: { archiveOwnerId?: string; liveChatOwnerId?: string } = {}) => {
  const deps = { ...defaults, ...overrides };
  if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > TRANSFER_LIMITS.things || input.ids.some((id) => typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id))) return fail(400, 'Choose valid Thing IDs to export');
  for (const key of ['includeChildren', 'includeDependencies', 'includeFiles', 'includeLinks'] as const) if (input[key] !== undefined && typeof input[key] !== 'boolean') return fail(400, 'Invalid export option');
  const docs = new Map<string, TransferThing>();
  const stored = new Map<string, ThingDoc>();
  const compositions = new Map<string, SharedComposition>();
  const authorizedRoots = new Map<string, string>();
  const emojiSources = new Map<string, TransferEmojiSource>();
  const archives = new Map<string, OwnedChatArchive>();
  const liveEmojiSources = new Map<string, Map<string, TransferEmojiSource>>();
  let archiveRows = 0;
  const deadline = Date.now() + 120_000;
  const check = () => { signal?.throwIfAborted(); if (Date.now() > deadline) throw new Error('Export timed out'); };
  try {
    const bundle = await collectTransfer(input.ids as string[], {
      read: async (id) => {
        check();
        if (docs.has(id)) return docs.get(id)!;
        const doc = await deps.read(id, viewer);
        // This authority is supplied only by the first-party route, never by
        // portable input or a shared-link/PAT viewer. Child rows are not roots.
        if ((!doc || (doc.thingtime.length === 1 && doc.thingtime[0] === 'chat-archive')) &&
          context.archiveOwnerId && context.archiveOwnerId === viewer?.id && !viewer.pat) {
          const archive = await deps.readArchive(context.archiveOwnerId, id).catch(() => { throw new Error('Archive history is unavailable'); });
          if (archive) {
            if (archive.group.root.id !== id) throw new Error('Archive history is unavailable');
            archiveRows += 1 + archive.group.participants.length + archive.group.messages.length + archive.group.reactions.length;
            if (archiveRows > TRANSFER_LIMITS.things) throw new Error('This archive export exceeds the transfer limit');
            archives.set(id, structuredClone(archive));
            docs.set(id, structuredClone(archive.group.root));
            return docs.get(id)!;
          }
        }
        if ((!doc || (doc.thingtime.length === 1 && doc.thingtime[0] === 'chat')) &&
          context.liveChatOwnerId && context.liveChatOwnerId === viewer?.id && !viewer.pat) {
          const archive = await deps.readLiveArchive(viewer, id, context.liveChatOwnerId, signal)
            .catch(() => { throw new Error('Complete chat history or media is unavailable for export'); });
          if (archive) {
            if (archive.group.root.id !== id) throw new Error('Chat history is unavailable');
            liveEmojiSources.set(id, new Map((archive.transferEmojis || []).map(source => [source.thing.id, source])));
            archiveRows += 1 + archive.group.participants.length + archive.group.messages.length + archive.group.reactions.length;
            if (archiveRows > TRANSFER_LIMITS.things) throw new Error('This archive export exceeds the transfer limit');
            archives.set(id, structuredClone(archive));
            docs.set(id, structuredClone(archive.group.root));
            return docs.get(id)!;
          }
        }
        if (doc?.thingtime.includes('custom-emoji')) {
          const emoji = await deps.readEmoji(viewer?.id, id);
          if (emoji) { emojiSources.set(id, emoji); docs.set(id, emoji.thing); return emoji.thing; }
          if (doc?.thingtime.includes('custom-emoji')) throw fail(404, 'Thing not found');
        }
        if (!doc || doc.thingtime.includes('theme') || doc.thingtime.includes('feed-algorithm') || doc.thingtime.includes('attachment')) {
          const dedicated = (!doc || doc.thingtime.includes('theme') ? await deps.readTheme(viewer?.id, id) : null) ||
            (!doc || doc.thingtime.includes('feed-algorithm') ? await deps.readAlgorithm(viewer?.id, id) : null) ||
            (!doc || doc.thingtime.includes('attachment') ? await deps.readRecording(viewer?.id, id) : null);
          if (dedicated) { docs.set(id, dedicated); return dedicated; }
          if (!doc) {
            const emoji = await deps.readEmoji(viewer?.id, id);
            if (emoji) { emojiSources.set(id, emoji); docs.set(id, emoji.thing); return emoji.thing; }
          }
          throw fail(404, 'Thing not found');
        }
        if (!doc) throw fail(404, 'Thing not found');
        const thing = (await deps.project([doc], viewer))[0];
        if (isProtectedThingtime(thing.thingtime)) throw new Error('This managed Thing needs its dedicated export workflow');
        docs.set(id, content(thing));
        stored.set(id, doc);
        if (canForkThing(thing) && (input.includeDependencies !== false || input.includeFiles !== false)) {
          const composition = await deps.resolve(viewer, id, { contentRoot: true });
          if (isFail(composition)) throw composition;
          if (input.includeDependencies !== false && [...composition.requiredReferences].some((ref) => !composition.references.has(ref))) throw new Error('A referenced dependency is unavailable; repair its sharing before exporting');
          compositions.set(id, composition);
          const included = input.includeDependencies === false ? [composition.root] : [...composition.docs.values()];
          if (new Set([...docs.keys(), ...included.map((doc) => doc.shareId)]).size > TRANSFER_LIMITS.things) throw new Error('This export has too many Things');
          for (const projected of await deps.project(included, viewer)) {
            const portable = content(projected);
            if (input.includeDependencies !== false) portable.crystal = rewriteComposition(portable.thingtime, portable.crystal,
              (kind, ref) => composition.references.get(`${portable.id}:${kind}:${ref}`)?.shareId || ref,
              composition.contexts.get(portable.id));
            // A shared dependency can appear through several authorized roots.
            // Do not let a later context silently change its portable meaning.
            const previous = docs.get(portable.id);
            if (previous && portable.id !== id && JSON.stringify(previous.crystal) !== JSON.stringify(portable.crystal)) throw new Error('A dependency has conflicting saved contexts; export these roots separately');
            docs.set(portable.id, portable);
            stored.set(portable.id, composition.docs.get(portable.id)!);
            authorizedRoots.set(portable.id, id);
          }
        }
        return docs.get(id)!;
      },
      children: async (folder, cursor) => {
        check();
        const result = await deps.list(viewer, { folder, cursor, limit: 100 }, null, context);
        if (isFail(result)) throw result;
        return { ids: result.things.map((thing) => thing.id), cursor: result.nextCursor };
      },
      dependencies: async (thing) => {
        const composition = compositions.get(thing.id);
        return composition ? [...composition.docs.keys()] : [];
      },
      files: async function* () { yield* []; /* Bytes follow this authorized plan. */ }
    }, { includeChildren: input.includeChildren !== false, includeDependencies: input.includeDependencies !== false, includeFiles: false, signal });
    const plan: TransferPlan = { roots: bundle.manifest.roots, things: bundle.manifest.things, files: [] };
    // History is an atomic part of its root, not an optional dependency or
    // folder descendant. Never make a successful but incomplete archive copy.
    const included = new Map(plan.things.map(thing => [thing.id, thing]));
    const archiveTargets = new Map<string, string>();
    for (const archive of archives.values()) {
      const { participants, messages, reactions } = archive.group;
      for (const row of [...participants, ...messages, ...reactions]) {
        if (included.has(row.id)) throw new Error('Archive history has conflicting IDs');
        included.set(row.id, row);
      }
      for (const id of archive.emojiIds) {
        check();
        let source = emojiSources.get(id);
        if (!source) {
          source = liveEmojiSources.get(archive.group.root.id)?.get(id) || await deps.readEmoji(viewer?.id, id) || undefined;
          if (!source || source.thing.id !== id || included.has(id)) throw new Error('An archive emoji is unavailable');
          emojiSources.set(id, source);
          included.set(id, structuredClone(source.thing));
        }
      }
      for (const target of archive.attachmentTargets) {
        if (archiveTargets.has(target.id)) throw new Error('Archive media has conflicting IDs');
        archiveTargets.set(target.id, target.targetId);
      }
      if (included.size > TRANSFER_LIMITS.things || archiveTargets.size > TRANSFER_LIMITS.files) throw new Error('This archive export exceeds the transfer limit');
    }
    plan.things = [...included.values()];
    for (const thing of plan.things) if (thing.folderId && !included.has(thing.folderId)) delete thing.folderId;
    const recordings = plan.things.filter(isTransferRecording);
    const emojis = plan.things.filter(isTransferEmoji);
    if (recordings.length && input.includeFiles === false) throw new Error('Recordings require their file bytes; download a ZIP with files included');
    if (emojis.length && input.includeFiles === false) throw new Error('Custom emojis require their image bytes; download a ZIP with files included');
    if (input.includeFiles !== false || input.includeLinks !== false) {
      const includedIds = new Set(plan.things.map((thing) => thing.id));
      const targets = new Map<string, { targetId: string; sharedRoot?: string }>();
      for (const file of await deps.bound(plan.things.flatMap((thing) => stored.has(thing.id) ? [stored.get(thing.id)!] : []))) {
        targets.set(file.id, { targetId: file.targetId, sharedRoot: authorizedRoots.get(file.targetId) });
      }
      for (const [id, targetId] of archiveTargets) {
        if (targets.has(id) || includedIds.has(id)) throw new Error('Archive media has conflicting IDs');
        targets.set(id, { targetId });
      }
      for (const thing of plan.things) {
        const root = authorizedRoots.get(thing.id);
        const composition = root && compositions.get(root);
        const original = stored.get(thing.id)!;
        if (!original) continue; // Dedicated themes have tokens, never gallery attachments.
        for (const args of composition ? composition.contexts.get(thing.id) || [undefined] : [undefined]) {
          for (const id of compositionAttachmentIds(thing.thingtime, original.crystal, {
            args,
            component: (ref) => composition ? composition.references.get(`${thing.id}:component:${ref}`)?.crystal : undefined
          })) if (!targets.has(id)) targets.set(id, { targetId: thing.id, sharedRoot: root });
        }
      }
      if (targets.size > TRANSFER_LIMITS.files) throw new Error('This export has too many files');
      // A recording can also be embedded in another included Thing. Its own
      // root owns the one byte entry; import remaps both forms of reference.
      for (const recording of recordings) targets.set(recording.id, { targetId: recording.id });
      for (const emoji of emojis) {
        const source = emojiSources.get(emoji.id)!;
        if (source.attachmentId) {
          targets.set(source.attachmentId, { targetId: emoji.id });
          emoji.crystal.emojiFileId = source.attachmentId;
        }
      }
      if (targets.size > TRANSFER_LIMITS.files) throw new Error('This export has too many files');
      const reservedIds = new Set([...includedIds, ...targets.keys()]);
      const recordingIds = new Set(recordings.map(thing => thing.id));
      let bytes = 0;
      for (const [id, target] of targets) {
        check();
        if (!includedIds.has(target.targetId)) throw new Error('An attachment target is missing');
        const result = await deps.describe({ ...viewer, sharedRoot: target.sharedRoot }, id, {
          includeFiles: input.includeFiles !== false, includeLinks: input.includeLinks !== false
        });
        if (isFail(result)) throw result;
        if ('excluded' in result && result.excluded) continue;
        if (emojiSources.has(target.targetId) && (result.linked || result.attachment.size <= 0 ||
          result.attachment.size > 512 * 1024 || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(result.attachment.contentType))) {
          throw new Error('Custom emojis require a stored image up to 512 KiB');
        }
        if (result.linked ? input.includeLinks === false : input.includeFiles === false) continue;
        let portableId = id;
        if (recordingIds.has(id)) {
          if (result.linked) throw new Error('A recording must contain stored file bytes');
          let index = 0;
          do { portableId = `recording-file:${index++}`; } while (reservedIds.has(portableId));
          reservedIds.add(portableId);
          plan.things.find(thing => thing.id === id)!.crystal = { recordingFileId: portableId };
        }
        (plan.attachmentOrder ||= []).push(portableId);
        if (result.linked) {
          const attachment = result.attachment;
          if (!attachment.url || attachment.nsfw || attachment.pending) throw new Error('Linked media cannot be exported');
          (plan.links ||= []).push({ id, targetId: target.targetId, url: attachment.url, mediaKind: attachment.mediaKind, ...transferAnnotations(attachment) });
          continue;
        }
        bytes += result.attachment.size;
        if (bytes > TRANSFER_LIMITS.fileBytes) throw new Error('This export exceeds the file byte limit');
        plan.files.push({ id: portableId, ...(portableId !== id ? { sourceId: id } : {}), ...target, name: result.attachment.name, mime: result.attachment.contentType, bytes: result.attachment.size, ...transferAnnotations(result.attachment) });
      }
      for (const emoji of emojis) {
        const image = emojiSources.get(emoji.id)!.inlineImage;
        if (!image) continue;
        if (plan.files.length + (plan.links?.length || 0) >= TRANSFER_LIMITS.files || bytes + image.bytes > TRANSFER_LIMITS.fileBytes) throw new Error('This export exceeds the file limit');
        let index = 0, id: string;
        do { id = `emoji-file:${index++}`; } while (reservedIds.has(id));
        reservedIds.add(id); bytes += image.bytes;
        emoji.crystal.emojiFileId = id;
        plan.files.push({ id, targetId: emoji.id, name: image.name, mime: image.mime, bytes: image.bytes, inlineBase64: image.base64 });
        (plan.attachmentOrder ||= []).push(id);
      }
    }
    const exportedMedia = new Map([...plan.files, ...(plan.links || [])].map(file => [file.id, file.targetId]));
    for (const [id, targetId] of archiveTargets) {
      if (exportedMedia.get(id) !== targetId) {
        throw new Error('Archives require all their media; include files and links');
      }
    }
    validateChatArchiveRecords(plan);
    check();
    if (new TextEncoder().encode(JSON.stringify(plan)).byteLength > TRANSFER_LIMITS.manifestBytes) throw new Error('This export is too large');
    return { ok: true as const, plan };
  } catch (error) { return isFail(error) ? error : fail(422, error instanceof Error ? error.message : 'Export failed'); }
};
