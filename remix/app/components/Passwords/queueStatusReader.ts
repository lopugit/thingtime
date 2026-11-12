/** A queue read is local evidence only; an empty queue does not establish remote freshness. */
export type QueueStatusSnapshot<T> = { value: T | null; failed: boolean };

/** Keep the last known queue through transient failures and fence both successful
 * reads and errors when a newer read or a retired identity supersedes them. */
export function createQueueStatusReader<T>(read: () => Promise<T>, publish: (snapshot: QueueStatusSnapshot<T>) => void) {
 let active = true, sequence = 0;
 let snapshot: QueueStatusSnapshot<T> = { value: null, failed: false };
 return {
  async refresh() {
   const version = ++sequence;
   try {
    const value = await read();
    if (active && version === sequence) { snapshot = { value, failed: false }; publish(snapshot); }
    return value;
   } catch (error) {
    if (active && version === sequence) { snapshot = { ...snapshot, failed: true }; publish(snapshot); }
    throw error;
   }
  },
  retire() { active = false; sequence++; }
 };
}
