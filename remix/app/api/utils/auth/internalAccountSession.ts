import { withInternalRequestActor } from './internalRequestActor';
import { resolveSessionUser } from './getCurrentUser';

/** Server-only references to an existing session, never credentials. The exact
 * Request object is the capability: headers/JSON cannot construct this binding.
 * The caller's transaction fence must also reserve its current job lease. */
export type InternalAccountSession = Readonly<{ ownerId: string; jti: string; origin: string }>;
type Binding = { reference: InternalAccountSession; fence(session: any): Promise<void> };
const bindings = new WeakMap<Request, Binding>();
export const internalAccountSession = (request: Request) => bindings.get(request);

export async function withInternalAccountSession<T>(request: Request, reference: InternalAccountSession,
	fence: Binding['fence'], work: () => Promise<T>): Promise<T> {
	if (bindings.has(request) || new URL(request.url).origin !== reference.origin ||
		request.headers.has('authorization') || request.headers.has('cookie')) throw Error('Invalid internal account request');
	bindings.set(request, { reference: Object.freeze({ ...reference }), fence });
	try {
		return await withInternalRequestActor(request,
			() => resolveSessionUser(reference.jti, reference.ownerId, null), work);
	} finally { bindings.delete(request); }
}
