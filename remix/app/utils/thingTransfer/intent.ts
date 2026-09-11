/** Tab-memory only. Clipboard/archive text never carries authority to move.
 * Root account changes revoke both saved intent and in-flight copy tickets. */
export const createTransferIntent = () => {
  type Intent = Readonly<{ ownerId: string; digest: string; ids: readonly string[] }>;
  let ownerId: string | undefined;
  let epoch = 0;
  let intent: Intent | null = null;
  return {
    account(next: string | undefined) {
      if (next !== ownerId) { ownerId = next; epoch++; intent = null; }
    },
    ticket(owner: string | undefined) { return owner && owner === ownerId ? { ownerId: owner, epoch } : null; },
    record(ticket: { ownerId: string; epoch: number } | null, digest: string, ids: string[]) {
      if (!ticket || ticket.ownerId !== ownerId || ticket.epoch !== epoch) return false;
      intent = Object.freeze({ ownerId: ticket.ownerId, digest, ids: Object.freeze([...new Set(ids)]) });
      return true;
    },
    peek(owner: string | undefined) { return owner && owner === ownerId ? intent : null; },
    match(owner: string | undefined, digest: string) {
      return owner && owner === ownerId && intent?.digest === digest ? intent : null;
    },
    settle(expected: Intent, succeeded: readonly string[]) {
      if (intent !== expected) return;
      const removed = new Set(succeeded);
      const ids = intent.ids.filter(id => !removed.has(id));
      intent = ids.length ? Object.freeze({ ...intent, ids: Object.freeze(ids) }) : null;
    },
    clear() { intent = null; epoch++; }
  };
};

export const transferIntent = createTransferIntent();
