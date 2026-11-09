import React from 'react';
import { Button, Flex, Spinner, Text } from '@chakra-ui/react';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { useApi } from '~/hooks/useApi';
import { useDataPlane } from '~/hooks/useDataPlane';
import { BROWSER_ACTION_EXPANDED_LIMITS } from '~/schemas/browserActions';
import {
	nextWebpageActivationBoundary, webpageActivationKey, webpageActivationQuery,
	WEBPAGE_ACTIVATION_REQUIREMENTS, type WebpageActivation as ActivationBinding
} from '~/schemas/webpageActivation';
import { useWebpageRuntime } from './webpageRuntime';

type State = { identity: object; binding: string; key: string; phase: 'running' | 'error' | 'done'; attempts: number };

export function WebpageActivation({ binding, revision }: { binding: ActivationBinding; revision: string }) {
	const runtime = useWebpageRuntime();
	const dataPlane = useDataPlane();
	const api = useApi();
	const bindingKey = JSON.stringify(binding);
	const [visibleState, setVisibleState] = React.useState<State | null>(null);
	const runState = React.useRef<State | null>(null);
	const attempted = React.useRef<{ identity: object; binding: string; keys: Set<string> } | null>(null);
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
		const begin = (manual = false) => {
			if (!stillCurrent() || document.visibilityState === 'hidden') return;
			const { binding, revision, api, runtime } = current.current;
			const key = webpageActivationKey(binding);
			const stored = runState.current;
			const before = stored?.identity === identity && stored.binding === bindingKey && stored.key === key ? stored : null;
			// StrictMode, focus, read refresh and an older completion cannot
			// create another run. The only same-key retry is explicit.
			if (manual ? !before || before.phase !== 'error' || before.attempts >= 2 : attemptedKeys.has(key)) return;
			if (stored?.identity === identity && stored.binding === bindingKey && stored.phase === 'running') return;
			const state: State = { identity, binding: bindingKey, key, phase: 'running', attempts: (before?.attempts ?? 0) + 1 };
			attemptedKeys.add(key);
			runState.current = state;
			setVisibleState(state);
			const active = () => stillCurrent() && runState.current === state;
			const finish = (phase: State['phase']) => {
				if (!active()) return;
				const next = { ...state, phase };
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
						activationPageRevision: revision, activationOnceKey: key
					}, { signal });
					if (!active()) return;
					if (result?.status !== 'ok') { finish('error'); return; }
					if (webpageActivationKey(binding) === key) {
						// This captured setter cannot affect a different navigation
						// generation; it also ignores manually selected query keys.
						runtime.applyActivationQuery(webpageActivationQuery(binding, result.result));
						// Refresh reads once after the activation; they cannot re-arm it.
						current.current.runtime.refresh();
					}
					finish('done');
				} catch {
					finish('error');
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
	}, [identity, pageId, bindingKey, dataPlane, runtime.viewer.signedIn, runtime.sharedRun]);

	const state = visibleState?.identity === identity && visibleState.binding === bindingKey ? visibleState : null;
	if (!state || state.phase === 'done') return null;
	return (
		<Flex align="center" gap={2} px={3} py={1} wrap="wrap">
			{state.phase === 'running' ? (
				<span role="status" aria-label="Preparing this page"><Spinner size="xs" aria-hidden sx={{ '@media (prefers-reduced-motion: reduce)': { animation: 'none' } }} /></span>
			) : (
				<>
					<Text role="status" fontSize="sm">Couldn’t run the page setup.</Text>
					{state.attempts < 2 && <Button size="xs" variant="ghost" onClick={() => retry.current?.()}>Retry</Button>}
				</>
			)}
		</Flex>
	);
}
