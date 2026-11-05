import type { LocalThing } from './things';
const fold = (text: string) => text.normalize('NFKC').toLowerCase();

/** Search authored values, not JSON field names or local bookkeeping. The
 * workspace's record/byte quotas bound this scan; values were validated on write. */
export function localSearchText(row: LocalThing) {
 const pending: unknown[] = [row.crystal, row.tags || []], text: string[] = [];
 while (pending.length) {
  const value = pending.pop();
  if (typeof value === 'string') text.push(value);
  else if (Array.isArray(value)) for (const entry of value) pending.push(entry);
  else if (value && typeof value === 'object') for (const entry of Object.values(value)) pending.push(entry);
 }
 return fold(text.join('\n'));
}
