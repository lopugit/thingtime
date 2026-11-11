/** Internal provider identity only. Labels do not prove two repositories share
 * a profile/store. No native imports, store opening, credentials or selectors. */
const providers = new WeakMap<object, object>();
export class HomeRepositoryScopeError extends Error {
 readonly code = 'HOME_REPOSITORY_SCOPE';
 constructor() { super('Home repositories do not share a registered provider'); this.name = 'HomeRepositoryScopeError'; }
}
const object = (value: unknown): value is object => value !== null && typeof value === 'object';
export function registerHomeRepositoryProvider(repository: object, provider: object): void {
 if (!object(repository) || !object(provider)) throw new HomeRepositoryScopeError();
 const previous = providers.get(repository);
 if (previous && previous !== provider) throw new HomeRepositoryScopeError();
 providers.set(repository, provider);
}
export function assertSameHomeRepositoryProvider(a: object, b: object): void {
 if (!object(a) || !object(b)) throw new HomeRepositoryScopeError();
 const provider = providers.get(a);
 if (!provider || provider !== providers.get(b)) throw new HomeRepositoryScopeError();
}
