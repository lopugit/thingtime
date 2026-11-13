import { createHash, randomUUID } from 'node:crypto';
import { COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry';
import { StorageMutationError } from '../storage/storageCore';
import { insertAccountedThings, deleteAccountedThings, updateAccountedThings } from '../storage/accountedThings';
export const SUBSPACE_DEFINITION_KIND = 'subspace-definition';
export const DEFINITION_FIELDS = ['rules', 'flairs', 'userFlairs', 'removalReasons'] as const;
type Field = typeof DEFINITION_FIELDS[number];
const BATCH = 100;
const entryId = (root: string, generation: string, field: Field, key: string) => 'subspace-definition-' + createHash('sha256').update(JSON.stringify([root,generation,field,key])).digest('hex');
const changed = () => new StorageMutationError(409,'storage_conflict','Subspace definitions changed while loading — retry the page');
const currentRoot = async (things: any, doc: any, session?: any) => !!await things.findOne({
  shareId: doc.shareId, ownerId: doc.ownerId, thingtime: 'subspace',
  definitionGeneration: doc.definitionGeneration === undefined ? { $exists: false } : doc.definitionGeneration
}, { ...(session ? { session } : {}), projection: { _id: 1 } });

/** Metadata-only authorization paths can resolve one selected flair by its
 * stable id instead of loading an entire community's definition lists. */
export async function findSubspaceDefinition(things: any, doc: any, field: Field, id: string, session?: any) {
  const row = doc?.definitionGeneration ? await things.findOne({shareId:entryId(doc.shareId,doc.definitionGeneration,field,id),thingtime:SUBSPACE_DEFINITION_KIND,targetId:doc.shareId,ownerId:doc.ownerId},session ? {session} : {}) : null;
  if (!(await currentRoot(things,doc,session))) throw changed();
  if (!doc?.definitionGeneration) return (doc?.crystal?.[field] || []).find((value: any) => value.id === id) || null;
  return row?.crystal?.value || null;
}

/** Complete compatibility projection, bounded database work per page of roots.
 * A present generation is authoritative even when every list is empty. */
export async function hydrateSubspaceDefinitions(things: any, docs: any[], session?: any, fields: readonly Field[] = DEFINITION_FIELDS): Promise<any[]> {
  const result = docs.map(doc => doc?.definitionGeneration ? {...doc,crystal:{...doc.crystal,...Object.fromEntries(fields.map(field=>[field,[]]))}} : doc);
  const byId = new Map(result.filter(doc=>doc?.definitionGeneration).map(doc=>[doc.shareId,doc]));
  const roots = [...byId.values()];
  for (let offset=0;offset<roots.length;offset+=BATCH) {
    const rows = things.find({thingtime:SUBSPACE_DEFINITION_KIND,'crystal.field':{$in:fields},$or:roots.slice(offset,offset+BATCH).map(doc=>({targetId:doc.shareId,ownerId:doc.ownerId,'crystal.generation':doc.definitionGeneration}))}, {...(session?{session}:{}),projection:{targetId:1,crystal:1}}).batchSize(BATCH);
    const ordered: any[] = [];
    for await (const row of rows) ordered.push(row);
    ordered.sort((a,b)=>a.crystal.position-b.crystal.position);
    for (const row of ordered) {
      const root = byId.get(row.targetId), field = row.crystal?.field;
      if (root && (DEFINITION_FIELDS as readonly string[]).includes(field)) root.crystal[field].push(row.crystal.value);
    }
  }
  for (const doc of byId.values()) {
    for (const field of fields) {
      const expected = doc.definitionCounts?.[field];
      if (!Number.isSafeInteger(expected) || expected < 0 || doc.crystal[field].length !== expected)
        throw changed();
    }
    if (!(await currentRoot(things,doc,session))) throw changed();
  }
  return result;
}

/** Inside the root's accounted content transaction. The generation switch,
 * old row refund, new row charge and removal of legacy arrays are atomic. */
export async function replaceSubspaceDefinitions(things: any, doc: any, patch: Record<string, any>, session: any) {
  const [complete] = await hydrateSubspaceDefinitions(things,[doc],session);
  const generation = randomUUID(), now = new Date();
  await deleteAccountedThings(things,{thingtime:SUBSPACE_DEFINITION_KIND,targetId:doc.shareId,ownerId:doc.ownerId},{session});
  let batch: any[] = [];
  const counts: Record<string,number> = {};
  const flush = async () => { if(batch.length) { await insertAccountedThings(things,batch,{session}); batch=[]; } };
  for (const field of DEFINITION_FIELDS) {
    const values = patch[`crystal.${field}`] ?? complete.crystal?.[field] ?? [];
    counts[field] = values.length;
    for (let position=0;position<values.length;position++) {
      const value = values[position];
      batch.push({shareId:entryId(doc.shareId,generation,field,field==='rules'?String(position):value.id),schemaVersion:COLLECTION_SCHEMA_VERSIONS.things,
        thingtime:[SUBSPACE_DEFINITION_KIND],ownerId:doc.ownerId,targetId:doc.shareId,parentId:doc.shareId,acl:['tt:user'],tags:[],extended:null,
        crystal:{generation,field,position,value},createdAt:now,updatedAt:now});
      if(batch.length===BATCH) await flush();
    }
  }
  await flush();
  return {set:{definitionGeneration:generation,definitionCounts:counts},unset:Object.fromEntries(DEFINITION_FIELDS.map(field=>[`crystal.${field}`,'']))};
}
export const deleteSubspaceDefinitions = (things:any,id:string,ownerId:string,session:any) => deleteAccountedThings(things,{thingtime:SUBSPACE_DEFINITION_KIND,targetId:id,ownerId},{session});
export const transferSubspaceDefinitions = (things:any,id:string,ownerId:string,nextOwner:string,session:any) => updateAccountedThings(things,{thingtime:SUBSPACE_DEFINITION_KIND,targetId:id,ownerId},{$set:{ownerId:nextOwner,updatedAt:new Date()}},{session});
