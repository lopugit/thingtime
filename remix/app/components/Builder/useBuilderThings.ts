import React from 'react';
import { sourceFailure } from './sourceFailure';

export type BuilderThing = { id: string; crystal: Record<string, any>; updatedAt?: string };
type BuilderKind = 'webpage' | 'component';
type ListThings = (args: { thingtime: BuilderKind; limit: number; cursor?: string }, options: { signal: AbortSignal }) => Promise<any>;
type BuilderThingsState = {
	rows: BuilderThing[];
	loaded: boolean;
	loading: boolean;
	error: string | null;
	nextCursor: string | null;
};

// Include capability negotiation and JSON parsing in the deadline, even when
// a request implementation does not settle promptly after its signal aborts.
export async function requestBuilderThingsPage(
	list: ListThings,
	kind: BuilderKind,
	cursor: string | undefined,
	parent: AbortSignal,
	timeoutMs = 30_000
): Promise<{ rows: BuilderThing[]; nextCursor: string | null }> {
	parent.throwIfAborted();
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout>;
	let onAbort: () => void;
	const stopped = new Promise<never>((_, reject) => {
		onAbort = () => {
			controller.abort(parent.reason);
			reject(parent.reason);
		};
		parent.addEventListener('abort', onAbort, { once: true });
		timer = setTimeout(() => {
			const error = new Error('Loading your Builder content timed out. Please try again.');
			reject(error);
			controller.abort(error);
		}, timeoutMs);
	});
	try {
		const response = await Promise.race([
			Promise.resolve().then(() => {
				controller.signal.throwIfAborted();
				return list({ thingtime: kind, limit: 50, cursor }, { signal: controller.signal });
			}),
			stopped
		]);
		if (response?.ok !== true || !Array.isArray(response.things)) throw response || new Error('Invalid Builder response');
		const nextCursor = typeof response.nextCursor === 'string' && response.nextCursor ? response.nextCursor : null;
		if (nextCursor && nextCursor === cursor) throw new Error('Builder pagination did not advance');
		return { rows: response.things, nextCursor };
	} finally {
		clearTimeout(timer!);
		parent.removeEventListener('abort', onAbort!);
	}
}

export const mergeBuilderThings = (existing: BuilderThing[], incoming: BuilderThing[]) =>
	Array.from(new Map([...existing, ...incoming].map((row) => [row.id, row])).values());

// The containing list is keyed by account and database. Each kind has its own
// request, cursor and error, so one slow list never hides the other list.
export function useBuilderThings(list: ListThings, kind: BuilderKind, revision: number, enabled: boolean) {
	const listRef = React.useRef(list);
	listRef.current = list;
	const requestRef = React.useRef<{ controller: AbortController; cursor?: string } | null>(null);
	const [state, setState] = React.useState<BuilderThingsState>({ rows: [], loaded: false, loading: enabled, error: null, nextCursor: null });
	const load = React.useCallback(
		async (cursor?: string) => {
			if (!enabled) return;
			requestRef.current?.controller.abort();
			const request = { controller: new AbortController(), cursor };
			requestRef.current = request;
			setState((previous) => ({ ...previous, loading: true, error: null }));
			try {
				const page = await requestBuilderThingsPage(listRef.current, kind, cursor, request.controller.signal);
				if (request.controller.signal.aborted || requestRef.current !== request) return;
				setState((previous) => ({
					rows: mergeBuilderThings(cursor ? previous.rows : [], page.rows),
					nextCursor: page.nextCursor,
					loaded: true,
					loading: false,
					error: null
				}));
			} catch (error) {
				if (request.controller.signal.aborted || requestRef.current !== request) return;
				const clear = sourceFailure(error).clear;
				if (clear) request.cursor = undefined;
				setState((previous) => ({
					...previous,
					...(clear ? { rows: [], loaded: false, nextCursor: null } : {}),
					loading: false,
					error: `Could not load your ${kind === 'webpage' ? 'pages' : 'components'}. Please try again.`
				}));
			}
		},
		[enabled, kind]
	);

	React.useEffect(() => {
		void load();
		return () => {
			requestRef.current?.controller.abort();
		};
	}, [load, revision]);

	return {
		...state,
		retry: () => load(requestRef.current?.cursor),
		loadMore: () => {
			if (state.nextCursor && !state.loading) void load(state.nextCursor);
		}
	};
}
