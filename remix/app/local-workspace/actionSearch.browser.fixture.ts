// Independent readback for the native task UI; no fixture writes or remote data.
import { LocalThings } from './things';
import { WorkspaceDatabase } from './storage';
import { parseTransfer, serializeTransfer, validateTransfer } from '../utils/thingTransfer/format';
export async function proof() {
 const db = new WorkspaceDatabase(indexedDB);
 try {
  const things = new LocalThings(db, {kind:'anonymous'}, {assertCurrent(){},onInvalidate:()=>()=>{}});
  const rows = (await things.snapshot()).filter(row => row.thingtime.some(kind => ['data','schema','action','component','webpage'].includes(kind)));
  const bundle = await things.export(rows.map(row => row.id)), json = serializeTransfer(bundle.manifest);
  validateTransfer(parseTransfer(json));
  return {json, data:rows.filter(row=>row.thingtime.includes('data')).map(row=>({id:row.id,crystal:row.crystal}))};
 } finally { await db.close(); }
}
