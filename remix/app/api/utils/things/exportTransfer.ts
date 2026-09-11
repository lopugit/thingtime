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

const defaults = { read: findViewableThing, list: listThings, resolve: resolveSharedComposition, project: toPublicThings, bound: listForkBoundMedia, describe: describeAttachmentTransfer };

const content = (thing: PublicThing): TransferThing => ({
  id: thing.id, thingtime: thing.thingtime, crystal: thing.crystal,
  ...(thing.extended === undefined ? {} : { extended: thing.extended as JsonValue }),
  ...(thing.tags === undefined ? {} : { tags: thing.tags }),
  ...(thing.folderId ? { folderId: thing.folderId } : {}),
  ...(thing.targetId ? { targetId: thing.targetId } : {})
});

export const exportTransferPlan = async (viewer: Viewer, input: {
  ids?: unknown; includeChildren?: unknown; includeDependencies?: unknown; includeFiles?: unknown; includeLinks?: unknown;
}, signal?: AbortSignal, overrides: Partial<typeof defaults> = {}) => {
  const deps = { ...defaults, ...overrides };
  if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > TRANSFER_LIMITS.things || input.ids.some((id) => typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id))) return fail(400, 'Choose valid Thing IDs to export');
  for (const key of ['includeChildren', 'includeDependencies', 'includeFiles', 'includeLinks'] as const) if (input[key] !== undefined && typeof input[key] !== 'boolean') return fail(400, 'Invalid export option');
  const docs = new Map<string, TransferThing>();
  const stored = new Map<string, ThingDoc>();
  const compositions = new Map<string, SharedComposition>();
  const authorizedRoots = new Map<string, string>();
  const deadline = Date.now() + 120_000;
  const check = () => { signal?.throwIfAborted(); if (Date.now() > deadline) throw new Error('Export timed out'); };
  try {
    const bundle = await collectTransfer(input.ids as string[], {
      read: async (id) => {
        check();
        if (docs.has(id)) return docs.get(id)!;
        const doc = await deps.read(id, viewer);
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
        const result = await deps.list(viewer, { folder, cursor, limit: 100 });
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
    if (input.includeFiles !== false || input.includeLinks !== false) {
      const includedIds = new Set(plan.things.map((thing) => thing.id));
      const targets = new Map<string, { targetId: string; sharedRoot?: string }>();
      for (const file of await deps.bound(plan.things.map((thing) => stored.get(thing.id)!))) {
        targets.set(file.id, { targetId: file.targetId, sharedRoot: authorizedRoots.get(file.targetId) });
      }
      for (const thing of plan.things) {
        const root = authorizedRoots.get(thing.id);
        const composition = root && compositions.get(root);
        const original = stored.get(thing.id)!;
        for (const args of composition ? composition.contexts.get(thing.id) || [undefined] : [undefined]) {
          for (const id of compositionAttachmentIds(thing.thingtime, original.crystal, {
            args,
            component: (ref) => composition ? composition.references.get(`${thing.id}:component:${ref}`)?.crystal : undefined
          })) if (!targets.has(id)) targets.set(id, { targetId: thing.id, sharedRoot: root });
        }
      }
      if (targets.size > TRANSFER_LIMITS.files) throw new Error('This export has too many files');
      let bytes = 0;
      for (const [id, target] of targets) {
        check();
        if (!includedIds.has(target.targetId)) throw new Error('An attachment target is missing');
        const result = await deps.describe({ ...viewer, sharedRoot: target.sharedRoot }, id);
        if (isFail(result)) throw result;
        if (result.linked ? input.includeLinks === false : input.includeFiles === false) continue;
        (plan.attachmentOrder ||= []).push(id);
        if (result.linked) {
          const attachment = result.attachment;
          if (!attachment.url || attachment.nsfw || attachment.pending) throw new Error('Linked media cannot be exported');
          (plan.links ||= []).push({ id, targetId: target.targetId, url: attachment.url, mediaKind: attachment.mediaKind, ...transferAnnotations(attachment) });
          continue;
        }
        bytes += result.attachment.size;
        if (bytes > TRANSFER_LIMITS.fileBytes) throw new Error('This export exceeds the file byte limit');
        plan.files.push({ id, ...target, name: result.attachment.name, mime: result.attachment.contentType, bytes: result.attachment.size, ...transferAnnotations(result.attachment) });
      }
    }
    check();
    if (new TextEncoder().encode(JSON.stringify(plan)).byteLength > TRANSFER_LIMITS.manifestBytes) throw new Error('This export is too large');
    return { ok: true as const, plan };
  } catch (error) { return isFail(error) ? error : fail(422, error instanceof Error ? error.message : 'Export failed'); }
};
