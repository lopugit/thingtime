import { ComponentDataScope } from './ComponentSelect';
import { NativeControlsEnabled } from './NativeComponentControls';
import { sourceFailure } from './sourceFailure';
import { ComponentUploadEnabled } from './ComponentUpload';
import React from 'react';
import { useNavigate } from 'react-router';
import { useLopu } from '~/components/Lopu/useLopu';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { LOCAL_UI_ACTION, reduceLocalUi, localQueryHref } from '../Actions/localUiAction';
import { ActionResult, type ControlResult } from './ActionResult';
import { Box } from '@chakra-ui/react';

import { useApi } from '~/hooks/useApi';
import { DEFAULT_WEBPAGE_SOURCE_INTERVAL_MS, MAX_WEBPAGE_SOURCE_INTERVAL_MS, MIN_WEBPAGE_SOURCE_INTERVAL_MS } from '~/schemas/registry';
import { ChakraThingRenderer, isChakraThingNode, type ChakraThingNode } from '../Kinds/ChakraThingRenderer';
import { HtmlThingRenderer, type HtmlThingNode } from '../Kinds/HtmlThingRenderer';
import { defaultsFromArgs, resolveTemplate, sanitizeArgSpecs, type ComponentArgSpec } from '../ComponentsLibrary/componentTemplate';
import { useTtActionClicks, type TtActionConfirmHandler, type TtActionUnownedHandler } from '../Actions/useTtActionClicks';
import { clearSourceCache, readSourceCache, useWebpageRuntime, writeSourceCache } from './webpageRuntime';

// The ONE live-component path. A component thing renders live in exactly
// one way everywhere — inside a builder page (ComponentBlockView), on its own
// dedicated page (/components/:key, /thing/:id), in the demo library — so the
// trust decision, the runtime scope, the data binding, and the click wrapper
// cannot drift between surfaces:
//
// - useThingSource: the data binding. Runs `source.action` AS THE VIEWER
//   (delegated, owner-only — exactly a ttAction click with no click) on load,
//   after every control run on the page (runtime.version), and on an
//   interval when asked; exposes result / state / error / last / viewer /
//   query to the template. Identical sources on one page share ONE request
//   per version (runtime.load); the last result paints from localStorage
//   before the fetch lands (house rule: never a spinner when a last-known
//   value exists). Nothing runs off a trusted surface: `interactive` false
//   keeps it inert with state 'inert'; a signed-out viewer gets 'signed-out'.
// - LiveTemplate: the click wrapper. The resolved template is drawn through
//   the sanitising allowlist renderers, and ONLY when `interactive` is true
//   does onClickCapture read [data-tt-action] controls and run them as the
//   viewer (useTtActionClicks: sign-in gate, confirm gate, install-then-rerun,
//   form gathering, runtime reporting). A surface that passes interactive
//   false renders the exact same markup with no handler — never
//   pointer-events, which would kill legitimate preview interaction.
//
// A shared runtime also makes controls live without sign-in: its separate
// sharedRun path is server-authorized through the stored root, read-only and
// uncached. It never delegates the author's or visitor's account authority.
// Outside that runtime the existing ownership/curation ladder still applies.

export type ThingSourceBinding = {
	action: string;
	inputs?: Record<string, string | number | boolean>;
	refresh?: 'load' | 'manual' | 'interval';
	intervalMs?: number;
};

export type ThingSourceState = 'inert' | 'signed-out' | 'not-installed' | 'loading' | 'ok' | 'error';

export type ThingSourceScope = {
	result: unknown;
	state: ThingSourceState;
	error: string | null;
	last: unknown;
	viewer: unknown;
	query: Record<string, string>;
	installing: boolean;
	installAvailable: boolean;
	hasSource: boolean;
};

export const useThingSource = ({
	source,
	cacheId,
	argValues,
	interactive
}: {
	source: ThingSourceBinding | null | undefined;
	// namespaces the localStorage cache line under the runtime's pageId — a
	// block id inside a page, or the thing's own id on a dedicated page
	cacheId: string;
	argValues: Record<string, unknown>;
	interactive: boolean;
}): { scope: ThingSourceScope; refetch: () => void } => {
	const runtime = useWebpageRuntime();
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const sourceKey = JSON.stringify(source || null);
	const active = !!source && interactive;
	const canRun = runtime.viewer.signedIn || !!runtime.sharedRun;
	// inputs interpolate {arg} tokens against the args and {query.x} against
	// the URL — the same substitution the template itself gets
	const inputsKey = JSON.stringify({ i: source?.inputs || null, a: argValues, q: runtime.query });
	const inputs = React.useMemo(() => {
		if (!source?.inputs) return {};
		const resolved = resolveTemplate(source.inputs, { ...argValues, query: runtime.query });
		return resolved && typeof resolved === 'object' && !Array.isArray(resolved) ? (resolved as Record<string, unknown>) : {};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- inputsKey is the serialised form
	}, [inputsKey]);
	const binding = JSON.stringify([sourceKey, inputsKey, cacheId]);
	const initial = React.useMemo(
		() => ({
			identity: runtime.identity,
			binding,
			status: (!active ? 'inert' : !canRun ? 'signed-out' : 'loading') as ThingSourceState,
			result: active && canRun && !runtime.sharedRun ? readSourceCache(runtime.viewer.id, runtime.pageId, cacheId, binding) : undefined,
			error: null as string | null
		}),
		[runtime.identity, binding, active, canRun, runtime.sharedRun, runtime.viewer.id, runtime.pageId, cacheId]
	);
	const [storedState, setState] = React.useState(initial);
	// A new target must never render the preceding target's controls, even
	// during the render before the effect starts its replacement request.
	const state = storedState.identity === runtime.identity && storedState.binding === binding ? storedState : initial;
	const currentIdentity = React.useRef({ identity: runtime.identity, binding });
	currentIdentity.current = { identity: runtime.identity, binding };
	const manual = source?.refresh === 'manual';
	// 'interval' sources tick on their own clock (bounded by the gate) on top
	// of the runtime's version — a clock or live tally refreshes without a
	// click and without touching `last`
	const intervalMs =
		source?.refresh === 'interval'
			? Math.max(
					MIN_WEBPAGE_SOURCE_INTERVAL_MS,
					Math.min(MAX_WEBPAGE_SOURCE_INTERVAL_MS, Number(source.intervalMs) || DEFAULT_WEBPAGE_SOURCE_INTERVAL_MS)
			  )
			: 0;
	const [tick, setTick] = React.useState(0);
	React.useEffect(() => {
		if (!intervalMs || !interactive || !canRun) return;
		const handle = window.setInterval(() => setTick((current) => current + 1), intervalMs);
		return () => window.clearInterval(handle);
	}, [intervalMs, interactive, canRun]);
	const [local, setLocal] = React.useState(0);
	const runVersion = manual ? local : runtime.version + tick * 1_000_003 + local * 1_000_000_007;
	const signedIn = runtime.viewer.signedIn;
	const viewerId = runtime.viewer.id;
	const pageId = runtime.pageId;

	React.useEffect(() => {
		if (!source || !active || !canRun) {
			setState(initial);
			return;
		}
		let cancelled = false;
		// a seeded page the viewer has not installed keeps saying so across
		// refetches (an interval source ticks every few seconds — flipping the
		// Install card to "Loading…" on each tick unmounts the button under the
		// pointer); install itself re-resolves the page, so nothing is stale
		setState((current) => {
			if (current.identity !== runtime.identity || current.binding !== binding) return initial;
			return (current.result === undefined && current.status !== 'not-installed') || current.status === 'signed-out' || current.status === 'inert'
				? { ...current, status: 'loading' }
				: current;
		});
		const stale = () => cancelled || currentIdentity.current.identity !== runtime.identity || currentIdentity.current.binding !== binding;
		const fail = (error: unknown) => {
			const failure = sourceFailure(error, !!runtime.sharedRun);
			if (failure.clear) clearSourceCache(viewerId, pageId, cacheId);
			setState((current) => ({ ...current, status: failure.status, error: failure.error, ...(failure.clear ? { result: undefined } : {}) }));
		};

		(async () => {
			try {
				const shareKey = JSON.stringify({ a: source.action, i: inputs, t: tick, l: local });
				const response: any = await runtime.load(shareKey, () =>
					runtime.sharedRun
						? runtime.sharedRun(source.action, inputs)
						: apiRef.current.v1.actions.run({ action: source.action, inputs, source: 'component' })
				);
				if (stale()) return;
				if (response?.status === 'ok') {
					if (!runtime.sharedRun) {
						if (response.cache === 'no-store') clearSourceCache(viewerId, pageId, cacheId);
						else writeSourceCache(viewerId, pageId, cacheId, response.result ?? null, binding);
					}
					setState({ identity: runtime.identity, binding, status: 'ok', result: response.result ?? null, error: null });
				} else {
					fail(response);
				}
			} catch (error: unknown) {
				if (stale()) return;
				fail(error);
			}
		})();
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- sourceKey/inputsKey are the serialised forms; runVersion folds the runtime's refetch signal, the interval tick and manual refetches; runtime.load is version-keyed
	}, [
		active,
		signedIn,
		canRun,
		runtime.sharedRun,
		runtime.identity,
		runtime.load,
		viewerId,
		sourceKey,
		inputsKey,
		runVersion,
		pageId,
		cacheId,
		binding
	]);

	const scope = React.useMemo<ThingSourceScope>(
		() => ({
			result: active && canRun ? state.result : undefined,
			state: interactive ? state.status : 'inert',
			error: state.error,
			last: runtime.last,
			viewer: runtime.viewer,
			query: runtime.query,
			installing: runtime.installing,
			installAvailable: !!runtime.install,
			hasSource: !!source
		}),
		[state, runtime.last, runtime.viewer, runtime.query, runtime.installing, runtime.install, source, interactive, active, canRun]
	);
	const refetch = React.useCallback(() => setLocal((current) => current + 1), []);
	return { scope, refetch };
};

// The arg values a component renders with: descriptor defaults, then the
// thing's savedArgs, then per-surface overrides (a block's args, a tester's
// live values).
export const useComponentArgValues = (
	crystal: Record<string, unknown> | null | undefined,
	overrides: Record<string, unknown> | null | undefined
): { specs: ComponentArgSpec[]; argValues: Record<string, unknown> } => {
	const specs = React.useMemo(() => sanitizeArgSpecs(crystal?.args), [crystal?.args]);
	const valuesKey = JSON.stringify({ s: crystal?.savedArgs, o: overrides });
	const argValues = React.useMemo(
		() => ({
			...defaultsFromArgs(specs),
			...(crystal?.savedArgs && typeof crystal.savedArgs === 'object' ? (crystal.savedArgs as Record<string, unknown>) : {}),
			...(overrides || {})
		}),
		// eslint-disable-next-line react-hooks/exhaustive-deps -- valuesKey is the serialised form of savedArgs + overrides
		[specs, valuesKey]
	);
	return { specs, argValues };
};

// Resolve + draw + (optionally) arm. Keep every args/tester UI OUTSIDE this
// element: the click wrapper reads named fields from the control's closest
// <fieldset>, else from this whole element.
export const LiveTemplate = ({
	render,
	scope,
	resolved: alreadyResolved = false,
	interactive,
	onUnowned,
	confirm,
	onDoubleClickCapture,
	children
}: {
	render: unknown;
	resolved?: boolean;
	scope: Record<string, unknown>;
	interactive: boolean;
	onUnowned?: TtActionUnownedHandler;
	confirm?: TtActionConfirmHandler;
	onDoubleClickCapture?: (event: React.MouseEvent) => void;
	children?: React.ReactNode;
}) => {
	const runtime = useWebpageRuntime();
	const user = useCurrentUser();
	const navigate = useNavigate();
	const lopu = useLopu();
	const baseScope = Object.fromEntries(
		Object.entries(scope).filter(([key]) => !['result', 'state', 'error', 'last', 'viewer', 'query', 'installing', 'hasSource'].includes(key))
	);
	// Explicit navigation starts a new component draft; source refreshes do not.
	const identity = JSON.stringify([user?.id, runtime.pageId, runtime.query, render, baseScope]);
	const [local, setLocal] = React.useState<{ identity: string; values: Record<string, unknown>; outcome?: ControlResult }>({ identity, values: {} });
	const active = local.identity === identity ? local : { identity, values: {} };
	const onLocal = (input: Record<string, unknown>) => {
		if (input.op === 'query') {
			const href = localQueryHref(runtime.pageId, input.params);
			if (href) navigate(href);
			return;
		}
		if (input.op === 'copy' && typeof input.value === 'string' && input.value.length <= 5000) {
			if (!navigator.clipboard) {
				lopu({ title: 'Clipboard unavailable', description: 'Copy is available on secure pages.', status: 'info' });
				return;
			}
			navigator.clipboard
				?.writeText(input.value)
				.then(() => lopu({ title: 'Copied', status: 'success' }))
				.catch(() => lopu({ title: 'Could not copy', description: 'Your browser did not allow clipboard access.', status: 'error' }));
			return;
		}
		if (input.op === 'search' && typeof input.value === 'string') {
			navigate(`/search?q=${encodeURIComponent(input.value.slice(0, 500))}`);
			return;
		}
		setLocal((previous) => ({
			...(previous.identity === identity ? previous : { identity, values: {} }),
			values: reduceLocalUi(previous.identity === identity ? previous.values : {}, baseScope, input)
		}));
	};
	const onTtAction = useTtActionClicks({
		onUnowned,
		confirm,
		onLocal,
		onResult: (outcome) => setLocal((previous) => ({ ...(previous.identity === identity ? previous : { identity, values: {} }), outcome }))
	});
	const liveScope = { ...scope, ...active.values };
	const scopeKey = JSON.stringify(liveScope);
	const resolved = React.useMemo(
		() => (render ? (alreadyResolved ? render : resolveTemplate(render, liveScope)) : null),
		// eslint-disable-next-line react-hooks/exhaustive-deps -- scopeKey is the serialised scope
		[render, scopeKey, alreadyResolved]
	);
	if (!resolved) return null;
	return (
		<NativeControlsEnabled.Provider key={identity} value={interactive}>
			<ComponentDataScope.Provider value={liveScope}>
				<ComponentUploadEnabled.Provider value={interactive && !runtime.sharedRun}>
					<Box
						onClickCapture={
							interactive
								? (event) => {
										if (!(event.target as Element).closest?.('[data-tt-native-upload]')) onTtAction(event);
								  }
								: undefined
						}
						onChangeCapture={
							interactive
								? (event) => {
										const field = event.target as HTMLInputElement;
										if (field.getAttribute('data-tt-action') !== LOCAL_UI_ACTION) return;
										try {
											const input = JSON.parse(field.getAttribute('data-tt-action-inputs') || '{}');
											onLocal({
												...input,
												op: 'set',
												value:
													field.type === 'checkbox'
														? field.checked
														: field.type === 'number' || field.type === 'range'
														? Number(field.value)
														: field.value
											});
										} catch {}
								  }
								: undefined
						}
						onKeyDownCapture={
							interactive
								? (event) => {
										const field = event.target as HTMLInputElement;
										if (field.closest('[data-tt-native-control], [data-tt-native-upload]')) return;
										if (
											event.key !== 'Enter' ||
											event.nativeEvent.isComposing ||
											field.tagName !== 'INPUT' ||
											['checkbox', 'radio', 'range', 'button', 'file'].includes(field.type)
										)
											return;
										const group = field.closest('fieldset') || event.currentTarget;
										const submit = group.querySelector<HTMLButtonElement>('button[data-tt-action]:not(:disabled)');
										if (submit) {
											const action = submit.getAttribute('data-tt-action');
											const inputs = submit.getAttribute('data-tt-action-inputs') || '';
											if (action !== LOCAL_UI_ACTION || /"op":"search"/.test(inputs)) {
												event.preventDefault();
												submit.click();
											}
										}
								  }
								: undefined
						}
						onDoubleClickCapture={onDoubleClickCapture}
						width="100%"
						data-live={interactive ? 'true' : 'false'}
					>
						{isChakraThingNode(resolved) ? (
							<ChakraThingRenderer node={resolved as ChakraThingNode} />
						) : (
							<HtmlThingRenderer node={resolved as HtmlThingNode} />
						)}
						{interactive && active.outcome ? <ActionResult outcome={active.outcome} /> : null}
						{children}
					</Box>
				</ComponentUploadEnabled.Provider>
			</ComponentDataScope.Provider>
		</NativeControlsEnabled.Provider>
	);
};
