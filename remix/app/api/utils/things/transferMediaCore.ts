import type { TransferThing } from '../../../utils/thingTransfer/format';
import { compositionReferences } from '../actions/sharedCompositionCore';
import { compositionAttachmentIds } from '../actions/compositionMediaCore';
import { bindCopiedTemplateMedia, rewriteCopiedAttachmentReferences } from '../actions/forkMediaCore';

/** Portable transfers contain canonical IDs, not live audience/lookup state.
 * Reconstruct only persisted component instances from the supplied content.
 * This never fetches an external reference or treats a mapping as authority.
 */
export const rewriteTransferMedia = (things: TransferThing[], copies: ReadonlyMap<string, string>) => {
  const docs = new Map(things.map((thing) => [thing.id, thing]));
  const crystals = new Map(things.map((thing) => [thing.id, rewriteCopiedAttachmentReferences(thing.crystal, copies)]));
  if (!copies.size) return crystals;
  const contexts = new Map<string, Map<string, Record<string, unknown> | undefined>>();
  for (const thing of things) if (thing.thingtime.includes('component')) contexts.set(thing.id, new Map([['default', undefined]]));
  let count = 0;
  for (const thing of things) {
    for (const ref of compositionReferences(thing.thingtime, thing.crystal)) {
      if (ref.kind !== 'component' || !docs.get(ref.ref)?.thingtime.includes('component')) continue;
      const args = ref.args && rewriteCopiedAttachmentReferences(ref.args, copies, { attachmentIds: true });
      const key = JSON.stringify(args) || 'default';
      const values = contexts.get(ref.ref)!;
      if (!values.has(key)) {
        if (++count > 512) throw new Error('The transfer has too many persisted component instances');
        values.set(key, args);
      }
    }
  }
  const mediaFor = (thing: TransferThing) => {
    const found = new Set<string>();
    for (const args of contexts.get(thing.id)?.values() || [undefined]) {
      for (const id of compositionAttachmentIds(thing.thingtime, crystals.get(thing.id)!, {
        args, component: (ref) => docs.get(ref)?.thingtime.includes('component') ? crystals.get(ref) : undefined
      })) found.add(id);
    }
    return found;
  };
  for (const thing of things) if (thing.thingtime.includes('component')) {
    crystals.set(thing.id, bindCopiedTemplateMedia(crystals.get(thing.id)!, copies, mediaFor(thing)));
  }
  // A complete file copy must not keep rendering any replaced source ID.
  // Run before creating Things so an unsupported template cannot leave a shell.
  for (const thing of things) for (const id of mediaFor(thing)) {
    if (copies.has(id)) throw new Error('A templated file reference could not be imported independently');
  }
  return crystals;
};
