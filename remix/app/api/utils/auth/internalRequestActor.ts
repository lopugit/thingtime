import type { PublicUser } from './users';

// Only code holding the exact Request object can bind an internal principal.
// No header, URL, serialized field, async ambient context or network request
// can create or inherit one. The callback revalidates the original session.
const actors = new WeakMap<Request, () => Promise<PublicUser | null>>();
export const internalRequestActor = (request: Request) => actors.get(request);
export async function withInternalRequestActor<T>(request: Request, actor: () => Promise<PublicUser | null>, work: () => Promise<T>): Promise<T> {
	actors.set(request, actor);
	try { return await work(); }
	finally { actors.delete(request); }
}
