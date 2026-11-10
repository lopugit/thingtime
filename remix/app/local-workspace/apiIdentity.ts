/** Keep UI callback identities stable within one workspace. Each slot owns a
 * separate remote forwarding cell: replacing the identity cannot retarget an
 * old callback at the next account's API implementation. */
export class WorkspaceApiIdentity<T extends Record<string, any>> {
 private cached?: { key: string; update: (remote: T) => void; value: T };
 resolve(key: string, remote: T, adapt: (remote: T) => T): T {
  if (this.cached?.key === key) { this.cached.update(remote); return this.cached.value; }
  let current = remote;
  const at = (path: string[]) => path.reduce((value, key) => value[key], current as any);
  const forward = (value: any, path: string[] = []): any => {
   if (typeof value === 'function') return (...args: any[]) => at(path)(...args);
   if (value && typeof value === 'object' && !Array.isArray(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, forward(child, [...path, key])]));
   return value;
  };
  const value = adapt(forward(remote));
  this.cached = { key, update: next => { current = next; }, value };
  return value;
 }
}
