import React from 'react';
import { Button, Flex, Spinner, Text } from '@chakra-ui/react';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { ThingtimeApiError } from '~/hooks/apiFailure';
import { useApi } from '~/hooks/useApi';
import { useDataPlane } from '~/hooks/useDataPlane';
import { BROWSER_ACTION_EXPANDED_LIMITS } from '~/schemas/browserActions';
import {
	nextWebpageActivationBoundary, webpageActivationKey, webpageActivationQuery,
	WEBPAGE_ACTIVATION_REQUIREMENTS, type ResolvedWebpageActivation as ActivationBinding
} from '~/schemas/webpageActivation';
import { loadWebpageClient } from './useWebpage';
import { useWebpageRuntime } from './webpageRuntime';

type State = { identity: object; binding: string; key: string; phase: 'running' | 'error' | 'done'; attempts: number; scheduleChanged?: boolean };

export function RefreshWebpageActivationSchedule({ refresh }: { refresh: () => void }) {
	const { last } = useWebpageRuntime();
	const refreshed = React.useRef<typeof last>(null);
	React.useEffect(() => {
		if (!last?.ok || refreshed.current === last) return;
		refreshed.current = last;
		refresh();
	}, [last, refresh]);
	React.useEffect(() => {
		const visible = () => { if (document.visibilityState !== 'hidden') refresh(); };
		const restored = (event: PageTransitionEvent) => { if (event.persisted) visible(); };
		document.addEventListener('visibilitychange', visible);
		window.addEventListener('pageshow', restored);
		return () => {
			document.removeEventListener('visibilitychange', visible);
			window.removeEventListener('pageshow', restored);
		};
	}, [refresh]);
	return null;
}

export function WebpageActivation({ binding, revision, scheduleRevision, refreshSchedule }: {
	binding: ActivationBinding; revision: string; scheduleRevision?: string; refreshSchedule?: () => void
}) {
	const runtime = useWebpageRuntime();
	const dataPlane = useDataPlane();
	const api = useApi();
	const bindingKey = JSON.stringify([binding, revision, scheduleRevision]);
	const [visibleState, setVisibleState] = React.useState<State | null>(null);
	const runState = React.useRef<State | null>(null);
	const attempted = React.useRef<{ identity: object; binding: string; keys: Set<string> } | null>(null);
	const recoveredSchedule = React.useRef<object | null>(null);
	const current = React.useRef({ runtime, binding, bindingKey, api, revision });
	current.current = { runtime, binding, bindingKey, api, revision };
	const retry = React.useRef<(() => void) | undefined>(undefined);
	const { identity, pageId } = runtime;

	React.useEffect(() => {
		if (!pageId || !dataPlane || !runtime.viewer.signedIn || runtime.sharedRun) return;
		if (attempted.current?.identity !== identity || attempted.current.binding !== bindingKey)
			attempted.current = { identity, binding: bindingKey, keys: new Set() };
		const attemptedKeys = attempted.current.keys;
		const interrupted = runState.current;
		if (interrupted?.identity === identity && interrupted.binding === bindingKey && interrupted.phase === 'error')
			setVisibleState(interrupted);
		const controller = new AbortController();
		const origin = window.location.origin;
		let timer = 0;
		const stillCurrent = () => !controller.signal.aborted && current.current.runtime.identity === identity &&
			current.current.bindingKey === bindingKey && window.location.origin === origin;
		const begin = (manual = false, reconciled = false) => {
			if (!stillCurrent() || document.visibilityState === 'hidden') return;
			const { binding, revision, api, runtime } = current.current;
			const key = webpageActivationKey(binding);
			const stored = runState.current;
			const before = stored?.identity === identity && stored.binding === bindingKey && stored.key === key ? stored : null;
			// StrictMode, focus, read refresh and an older completion cannot
			// create another run. The only same-key retry is explicit.
			if (manual ? !before || before.phase !== 'error' || before.attempts >= 2 : attemptedKeys.has(key)) return;
			if (stored?.identity === identity && stored.binding === bindingKey && stored.phase === 'running') return;
			if (manual && before && refreshSchedule && !reconciled) {
				const checking: State = { ...before, phase: 'running' };
				runState.current = checking;
				setVisibleState(checking);
				const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
				void loadWebpageClient({ kind: 'id', id: pageId }, signal).then(fresh => {
					if (!stillCurrent() || runState.current !== checking) return;
					const sameSchedule = fresh.status === 'ready' && fresh.data.page?.id === pageId &&
						fresh.data.page.updatedAt === revision && fresh.data.activationSchedule?.revision === scheduleRevision &&
						fresh.data.activationSchedule?.cutoffTime === binding.cutoffTime;
					const next = { ...before, attempts: sameSchedule && !before.scheduleChanged ? before.attempts : before.attempts + 1 };
					runState.current = next;
					setVisibleState(next);
					if (sameSchedule && !before.scheduleChanged) {
						if (webpageActivationKey(binding) === key) begin(true, true);
						else schedule();
					} else if (!sameSchedule && fresh.status !== 'error') refreshSchedule();
				});
				return;
			}
			const state: State = { identity, binding: bindingKey, key, phase: 'running', attempts: (before?.attempts ?? 0) + 1 };
			attemptedKeys.add(key);
			runState.current = state;
			setVisibleState(state);
			const active = () => stillCurrent() && runState.current === state;
			const finish = (phase: State['phase'], scheduleChanged = false) => {
				if (!active()) return;
				const next = { ...state, phase, scheduleChanged };
				runState.current = next;
				setVisibleState(next);
			};
			void (async () => {
				try {
					const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(BROWSER_ACTION_EXPANDED_LIMITS.timeoutMs + 20_000)]);
					for (const [feature, version] of Object.entries(WEBPAGE_ACTIVATION_REQUIREMENTS)) {
						await requireThingtimeCapability(feature, version, origin, { fetch, currentOrigin: () => window.location.origin, signal });
						if (!active()) return;
					}
					const result = await api.v1.actions.run({
						source: 'activation', action: binding.action, activationPageId: pageId,
						activationPageRevision: revision, activationScheduleRevision: scheduleRevision, activationOnceKey: key
					}, { signal });
					if (!active()) return;
					if (result?.status !== 'ok') {
						finish('error', result?.reason === 'activation-schedule-changed');
						return;
					}
					if (webpageActivationKey(binding) === key) {
						// This captured setter cannot affect a different navigation
						// generation; it also ignores manually selected query keys.
						runtime.applyActivationQuery(webpageActivationQuery(binding, result.result));
						// Refresh reads once after the activation; they cannot re-arm it.
						current.current.runtime.refresh();
					}
					finish('done');
				} catch (error) {
					const scheduleChanged = error instanceof ThingtimeApiError && error.status === 409 && error.reason === 'activation-schedule-changed';
					const recover = active() && scheduleChanged && refreshSchedule && recoveredSchedule.current !== identity;
					finish('error', scheduleChanged);
					if (recover) {
						recoveredSchedule.current = identity;
						// The server refused the stale revision before executing. A
						// newly resolved revision can arm a run with current inputs.
						refreshSchedule();
					}
				} finally {
					if (stillCurrent() && webpageActivationKey(binding) !== key) schedule();
				}
			})();
		};
		const schedule = () => {
			window.clearTimeout(timer);
			if (!stillCurrent()) return;
			begin();
			const time = Date.now();
			const next = nextWebpageActivationBoundary(current.current.binding, time);
			if (next !== null) timer = window.setTimeout(schedule, Math.max(1000, next - time + 50));
		};
		// Wait one task so a discarded StrictMode mount can't launch a write.
		timer = window.setTimeout(schedule, 0);
		retry.current = () => begin(true);
		document.addEventListener('visibilitychange', schedule);
		window.addEventListener('pageshow', schedule);
		return () => {
			controller.abort();
			window.clearTimeout(timer);
			document.removeEventListener('visibilitychange', schedule);
			window.removeEventListener('pageshow', schedule);
			retry.current = undefined;
			const pending = runState.current;
			if (pending?.identity === identity && pending.binding === bindingKey && pending.phase === 'running') {
				// An interrupted call may have committed. Never automatically
				// replay it in this opening; a retry uses the same civil key.
				runState.current = { ...pending, phase: 'error' };
			}
		};
	}, [identity, pageId, bindingKey, scheduleRevision, refreshSchedule, dataPlane, runtime.viewer.signedIn, runtime.sharedRun]);

	const state = visibleState?.identity === identity && visibleState.binding === bindingKey ? visibleState : null;
	if (!state || state.phase === 'done') return null;
	return (
		<Flex align="center" gap={2} px={3} py={1} wrap="wrap">
			{state.phase === 'running' ? (
				<span role="status" aria-label="Preparing this page"><Spinner size="xs" aria-hidden sx={{ '@media (prefers-reduced-motion: reduce)': { animation: 'none' } }} /></span>
			) : (
				<>
					<Text role="status" fontSize="sm">{state.scheduleChanged ? 'The page schedule changed. Refresh it to continue.' : 'Couldn’t run the page setup.'}</Text>
					{state.attempts < 2 && <Button size="xs" variant="ghost" onClick={() => retry.current?.()}>Retry</Button>}
				</>
			)}
		</Flex>
	);
}
