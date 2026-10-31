import React from 'react';
import { useApi } from '../hooks/useApi';
import { useTimelineSession, timelineAccessFailure } from './TimelineProvider';
import { parseTimelineEntry, timelineScopeKey, type TimelineEvent } from './contract';
import { COMPONENT_BINDING_PREFIX, MAX_COMPONENT_BINDINGS, capturedComponentBindings, webpageComponentRefs } from './componentBindings';

/** Immutable selected-version dependencies: local first, one remote batch only
 * for a cache miss. Remote loading never substitutes today's definitions. */
export function useCapturedComponents(event: TimelineEvent | null, blocks: unknown, pendingLocal = false) {
	const session = useTimelineSession();
	const connection = session.connection;
	const api = useApi();
	const refs = React.useRef({ api, session });
	refs.current = { api, session };
	const wanted = webpageComponentRefs(blocks);
	const identity =
		connection && event && event.ownerId === connection.scope.ownerId ? JSON.stringify([timelineScopeKey(connection.scope), event.id]) : '';
	const [state, setState] = React.useState<{ identity: string; events: TimelineEvent[]; error: string; loading: boolean }>({
		identity: '',
		events: [],
		error: '',
		loading: false
	});
	const [tick, retry] = React.useReducer((n) => n + 1, 0);
	React.useEffect(() => {
		if (!identity || !event || !connection) return;
		const controller = new AbortController();
		const update = (events: TimelineEvent[], error = '', loading = false) => {
			if (!controller.signal.aborted) setState({ identity, events, error, loading });
		};
		void (async () => {
			let found: TimelineEvent[] = [];
			try {
				const dependencies = event.dependencies.filter((item) => item.thingId.startsWith(COMPONENT_BINDING_PREFIX));
				if (dependencies.length > MAX_COMPONENT_BINDINGS) throw new Error('Too many captured components.');
				found = (await connection.store.entries(dependencies.map((item) => item.eventId))).map((row) => row.event);
				capturedComponentBindings(event, found, blocks);
				update(found, '', found.length !== dependencies.length);
				if (found.length === dependencies.length || pendingLocal) return;
				const response = await refs.current.api.v1.timeline.componentBindings(connection.scope, event.id, { signal: controller.signal });
				if (controller.signal.aborted) return;
				if (
					response?.ok !== true ||
					response.eventId !== event.id ||
					!Array.isArray(response.entries) ||
					response.entries.length !== dependencies.length
				)
					throw new Error('Could not load the recorded components.');
				const entries = response.entries.map(parseTimelineEntry);
				capturedComponentBindings(
					event,
					entries.map((entry: any) => entry.event),
					blocks
				);
				await connection.store.accept(entries);
				update(entries.map((entry: any) => entry.event));
			} catch (error: any) {
				if (controller.signal.aborted) return;
				if (timelineAccessFailure(error)) {
					update([]);
					await refs.current.session.redact(error);
					return;
				}
				update(found, error?.error || error?.message || 'Could not load recorded components.');
			}
		})();
		return () => controller.abort();
		// Content edits may change required refs while retaining the same dependency set.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [identity, connection, pendingLocal, tick]);
	const current = state.identity === identity ? state : { events: [], error: '', loading: !!identity };
	let result = { components: {}, missing: wanted } as ReturnType<typeof capturedComponentBindings>;
	try {
		if (identity && event) result = capturedComponentBindings(event, current.events, blocks);
	} catch {
		/* Async read reports validation errors. */
	}
	return { ...result, events: current.events, loading: current.loading, error: current.error, retry };
}
