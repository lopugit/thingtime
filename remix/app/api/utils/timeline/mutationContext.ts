import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

type MutationContext = Readonly<{ actorId: string; source: 'action' | 'ai'; operationId: string }>;
const contexts = new AsyncLocalStorage<MutationContext | null>();

/** Server-only provenance, established by an executor, never by a request
 * header, tool input or authored program. It grants no permission. Nested
 * work by the same actor keeps the initiating source and operation identity;
 * every affected Thing still gets its own immutable event and operation link. */
export function withTimelineMutationContext<T>(actorId: string | null, source: MutationContext['source'], work: () => T): T {
	const current = contexts.getStore();
	const context = !actorId ? null : current?.actorId === actorId ? current
		: Object.freeze({ actorId, source, operationId: randomUUID() });
	return contexts.run(context, work);
}

/** A writer must supply its authenticated actor. An unrelated account's
 * nested work cannot inherit the initiating operation's attribution. */
export function timelineMutationContext(actorId: string): MutationContext | null {
	const context = contexts.getStore();
	return context?.actorId === actorId ? context : null;
}
