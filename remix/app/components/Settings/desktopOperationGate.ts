/** Native work may finish after a renderer authority switch. Only its own
 * generation may release the busy state; the new workspace starts idle. */
export function createDesktopOperationGate() {
  let scope: string | null = null;
  let active: symbol | null = null;
  return {
    setScope(next: string) { if (scope !== next) { scope = next; active = null; } },
    get busy() { return active !== null; },
    begin(expected: string) { if (scope !== expected || active) return null; active = Symbol(); return active; },
    finish(token: symbol) { if (active !== token) return false; active = null; return true; }
  };
}
