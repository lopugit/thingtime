import { NativeControlsEnabled } from './NativeComponentControls';
import { ComponentUploadEnabled } from './ComponentUpload';
import React from 'react';
import { useNavigate } from 'react-router';
import { useLopu } from '~/components/Lopu/useLopu';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { LOCAL_UI_ACTION, reduceLocalUi } from '../Actions/localUiAction';
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
	const [state, setState] = React.useState<{ status: ThingSourceState; result: unknown; error: string | null }>(() => ({
		status: !source ? 'inert' : !canRun ? 'signed-out' : !interactive ? 'inert' : 'loading',
		// keyed by the viewer too, so this optimistic seed can only ever be the
		// CURRENT viewer's own last result — never the previous account's, and
		// nothing at all when signed out (see writeSourceCache)
		result: source && !runtime.sharedRun ? readSourceCache(runtime.viewer.id, runtime.pageId, cacheId) : undefined,
		error: null
	}));
	// inputs interpolate {arg} tokens against the args and {query.x} against
	// the URL — the same substitution the template itself gets
	const inputsKey = JSON.stringify({ i: source?.inputs || null, a: argValues, q: runtime.query });
	const inputs = React.useMemo(() => {
		if (!source?.inputs) return {};
		const resolved = resolveTemplate(source.inputs, { ...argValues, query: runtime.query });
		return resolved && typeof resolved === 'object' && !Array.isArray(resolved) ? (resolved as Record<string, unknown>) : {};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- inputsKey is the serialised form
	}, [inputsKey]);
	const manual = source?.refresh === 'manual';
	// 'interval' sources tick on their own clock (bounded by the gate) on top
	// of the runtime's version — a clock or live tally refreshes without a
	// click and without touching `last`
	const intervalMs =
		source?.refresh === 'interval'
			? Math.max(MIN_WEBPAGE_SOURCE_INTERVAL_MS, Math.min(MAX_WEBPAGE_SOURCE_INTERVAL_MS, Number(source.intervalMs) || DEFAULT_WEBPAGE_SOURCE_INTERVAL_MS))
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
		if (!source) return;
		// signed-out wins over inert: the template offers the sign-in even on
		// a seeded page that is not (yet) interactive for this viewer
		if (!canRun) {
			setState((current) => (current.status === 'signed-out' ? current : { ...current, status: 'signed-out' }));
			return;
		}
		if (!active) {
			setState((current) => (current.status === 'inert' ? current : { ...current, status: 'inert' }));
			return;
		}
		let cancelled = false;
		setState((current) => (current.result === undefined || current.status === 'signed-out' || current.status === 'inert' ? { ...current, status: 'loading' } : current));
		(async () => {
			try {
				const shareKey = JSON.stringify({ a: source.action, i: inputs, t: tick, l: local });
				const response: any = await runtime.load(shareKey, () => runtime.sharedRun
					? runtime.sharedRun(source.action, inputs)
					: apiRef.current.v1.actions.run({ action: source.action, inputs, source: 'component' }));
				if (cancelled) return;
				if (response?.status === 'ok') {
					if (!runtime.sharedRun) {
						if (response.cache === 'no-store') clearSourceCache(viewerId, pageId, cacheId);
						else writeSourceCache(viewerId, pageId, cacheId, response.result ?? null);
					}
					setState({ status: 'ok', result: response.result ?? null, error: null });
				} else {
					setState((current) => ({ ...current, status: 'error', error: response?.error || 'The source action failed' }));
				}
			} catch (error: unknown) {
				if (cancelled) return;
				const message = (error as { error?: string; message?: string })?.error || (error as { message?: string })?.message || '';
				const unowned = /no action you own matches/i.test(message);
				setState((current) => ({ ...current, status: unowned ? 'not-installed' : 'error', error: unowned ? null : message || 'The source action failed' }));
			}
		})();
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- sourceKey/inputsKey are the serialised forms; runVersion folds the runtime's refetch signal, the interval tick and manual refetches; runtime.load is version-keyed
	}, [active, signedIn, canRun, runtime.sharedRun, viewerId, sourceKey, inputsKey, runVersion, pageId, cacheId]);

	const scope = React.useMemo<ThingSourceScope>(
		() => ({
			result: interactive ? state.result : undefined,
			state: interactive ? state.status : 'inert',
			error: state.error,
			last: runtime.last,
			viewer: runtime.viewer,
			query: runtime.query,
			installing: runtime.installing,
			hasSource: !!source
		}),
		[state, runtime.last, runtime.viewer, runtime.query, runtime.installing, source, interactive]
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
	const baseScope = Object.fromEntries(Object.entries(scope).filter(([key]) => !['result', 'state', 'error', 'last', 'viewer', 'query', 'installing', 'hasSource'].includes(key)));
	const identity = JSON.stringify([user?.id, runtime.pageId, render, baseScope]);
	const [local, setLocal] = React.useState<{ identity: string; values: Record<string, unknown>; outcome?: ControlResult }>({ identity, values: {} });
	const active = local.identity === identity ? local : { identity, values: {} };
	const onLocal = (input: Record<string, unknown>) => {
		if (input.op === 'copy' && typeof input.value === 'string' && input.value.length <= 5000) {
			if (!navigator.clipboard) { lopu({ title: 'Clipboard unavailable', description: 'Copy is available on secure pages.', status: 'info' }); return; }
			navigator.clipboard?.writeText(input.value).then(() => lopu({ title: 'Copied', status: 'success' })).catch(() => lopu({ title: 'Could not copy', description: 'Your browser did not allow clipboard access.', status: 'error' }));
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
	const onTtAction = useTtActionClicks({ onUnowned, confirm, onLocal,
		onResult: (outcome) => setLocal((previous) => ({ ...(previous.identity === identity ? previous : { identity, values: {} }), outcome })) });
	const liveScope = { ...scope, ...active.values };
	const scopeKey = JSON.stringify(liveScope);
	const resolved = React.useMemo(() => (render ? alreadyResolved ? render : resolveTemplate(render, liveScope) : null), [render, scopeKey, alreadyResolved]); // eslint-disable-line react-hooks/exhaustive-deps -- scopeKey is the serialised scope
	if (!resolved) return null;
	return (
		<NativeControlsEnabled.Provider key={identity} value={interactive}><ComponentUploadEnabled.Provider value={interactive && !runtime.sharedRun}>
			<Box
				onClickCapture={interactive ? (event) => {
					if (!(event.target as Element).closest?.('[data-tt-native-upload]')) onTtAction(event);
				} : undefined}
				onChangeCapture={interactive ? (event) => {
					const field = event.target as HTMLInputElement;
					if (field.getAttribute('data-tt-action') !== LOCAL_UI_ACTION) return;
					try {
						const input = JSON.parse(field.getAttribute('data-tt-action-inputs') || '{}');
						onLocal({ ...input, op: 'set', value: field.type === 'checkbox' ? field.checked : field.type === 'number' || field.type === 'range' ? Number(field.value) : field.value });
					} catch {}
				} : undefined}
				onKeyDownCapture={interactive ? (event) => {
					const field = event.target as HTMLInputElement;
					if (event.key !== 'Enter' || event.nativeEvent.isComposing || field.tagName !== 'INPUT' || ['checkbox', 'radio', 'range', 'button', 'file'].includes(field.type)) return;
					const group = field.closest('fieldset') || event.currentTarget;
					const submit = group.querySelector<HTMLButtonElement>('button[data-tt-action]:not(:disabled)');
					if (submit) {
						const action = submit.getAttribute('data-tt-action');
						const inputs = submit.getAttribute('data-tt-action-inputs') || '';
						if (action !== LOCAL_UI_ACTION || /"op":"search"/.test(inputs)) { event.preventDefault(); submit.click(); }
					}
				} : undefined}
				onDoubleClickCapture={onDoubleClickCapture}
				width="100%"
				data-live={interactive ? 'true' : 'false'}
			>
				{isChakraThingNode(resolved) ? <ChakraThingRenderer node={resolved as ChakraThingNode} /> : <HtmlThingRenderer node={resolved as HtmlThingNode} />}
				{interactive && active.outcome ? <ActionResult outcome={active.outcome} /> : null}
				{children}
			</Box>
		</ComponentUploadEnabled.Provider></NativeControlsEnabled.Provider>
	);
};
