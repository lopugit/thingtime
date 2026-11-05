// Read-only canonical proof for the opt-in native site/global editor scenario.
import { LocalThings } from './things';
import { WorkspaceDatabase } from './storage';
import { parseTransfer, serializeTransfer, validateTransfer } from '../utils/thingTransfer/format';

const db = new WorkspaceDatabase(indexedDB);
const things = new LocalThings(db, { kind: 'anonymous' }, { assertCurrent() {}, onInvalidate: () => () => {} });
export async function proof() {
 const all = await things.snapshot();
 const pages = all.filter(row => row.thingtime.includes('webpage'));
 const exported = await things.export(pages.map(row => row.id));
 const json = serializeTransfer(exported.manifest);
 validateTransfer(parseTransfer(json));
 const files = [];
 for (const file of exported.manifest.files) {
  const value = exported.files.get(file.id);
  if (!value) throw new Error('Exported file dependency has no bytes');
  const bytes = value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  files.push({ id: file.id, size: bytes.length, hash: Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('') });
 }
 return { pages, files, json };
}
