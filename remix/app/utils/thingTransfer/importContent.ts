import { rewriteComposition } from '../../api/utils/actions/forkCompositionCore';
import type { ThingTransfer, TransferThing } from './format';

/** Structural/provenance dependencies must precede their consumers. Executable
 * Action cycles are legal because all new identities are allocated first. */
export const orderTransferImports = (manifest: ThingTransfer): TransferThing[] => {
 const remaining = new Map(manifest.things.map(thing => [thing.id, thing]));
 const ordered: TransferThing[] = [];
 while (remaining.size) {
  const next = [...remaining.values()].find(thing => ![thing.folderId, thing.targetId,
   ...(thing.thingtime.includes('data') && typeof thing.crystal.schemaId === 'string' ? [thing.crystal.schemaId] : [])
  ].some(id => id && remaining.has(id)));
  if (!next) throw new Error('Circular folder, target, or schema provenance in the import');
  ordered.push(next); remaining.delete(next.id);
 }
 return ordered;
};

/** Independent private copies retain content, never a source's site placement
 * or definition-key identity. Shared by account server/device import writers. */
export function importedThingCrystal(thing: TransferThing, crystal: Record<string, any>, ids: ReadonlyMap<string, string>, suffix: string) {
 const copy = rewriteComposition(thing.thingtime, crystal, (_kind, id) => ids.get(id) || id);
 for (const key of ['componentKey', 'actionKey', 'pageKey']) if (typeof copy[key] === 'string') copy[key] = `${copy[key].slice(0, 48)}-${suffix}`;
 if (thing.thingtime.includes('schema') && typeof copy.name === 'string') copy.name = `${copy.name.slice(0, 48)}-${suffix}`;
 if (thing.thingtime.includes('webpage')) delete copy.siteRoute;
 if (thing.thingtime.includes('post')) { delete copy.subspaceId; delete copy.flairId; }
 return copy;
}
