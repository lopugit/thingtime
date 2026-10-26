import React from 'react';
import { Box, Button, Text } from '@chakra-ui/react';
import { activityEvents, activityInterval, clearActivityInterval } from '~/activity/activityManager';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { rootIdentity } from '~/utils/rootIdentity';
import type { ThingsThing } from '../Things/thingsCore';
import { ThingView } from '../Thingtime/ThingView';
import { useActionRunConfirm } from '../Actions/ActionRunConfirm';
import { LiveTemplate, useComponentArgValues, useThingSource } from './liveComponent';
import {
	currentExplicitComponentResolution,
	explicitComponentInteractive,
	explicitThingRenderScope,
	parseExplicitRenderComponent,
	resolveSavedRenderComponent,
	type ExplicitComponentResolution
} from './explicitThingRenderCore';

const unavailableCopy = {
	absent: 'This Thing has no render component.',
	invalid: 'This Thing\'s render component definition is invalid.',
	unavailable: 'The selected render component is unavailable or private.',
	'wrong-kind': 'The selected renderer is not a Component Thing.'
} as const;

function InspectorChoice({ thing, compact, message }: { thing: ThingsThing; compact?: boolean; message: string }) {
	const [inspect, setInspect] = React.useState(false);
	return (
		<Box minW={0} role="note">
			<Text color="var(--tt-muted, #6f6f7b)" fontSize="sm" lineHeight="1.5">
				{message}
			</Text>
			<Button
				marginTop={2}
				minHeight="44px"
				size="sm"
				variant="outline"
				aria-expanded={inspect}
				onClick={() => setInspect((current) => !current)}
			>
				{inspect ? 'Hide data' : 'Inspect data'}
			</Button>
			{inspect ? <Box marginTop={3}><ThingView thing={thing.crystal.thing || thing.crystal} initialMode="data" compact={compact} /></Box> : null}
		</Box>
	);
}

function ExplicitComponentPresentation({ thing, component, kind }: { thing: ThingsThing; component: { id: string; author?: { id?: string } | null; crystal: Record<string, unknown> }; kind: 'embedded' | 'reference' }) {
	const user = useCurrentUser();
	const contentScope = React.useMemo(() => explicitThingRenderScope(thing), [thing]);
	const { argValues } = useComponentArgValues(component.crystal, contentScope);
	// A render pointer is presentation, not an instruction to execute the
	// component's saved source Action when an embed mounts.
	const { scope } = useThingSource({ source: null, cacheId: `${thing.id}:${component.id}`, argValues, interactive: true });
	const { confirm, dialog } = useActionRunConfirm({ enabled: true });
	const interactive = explicitComponentInteractive(kind, user?.id, thing.author?.id, component.author?.id);
	return <>{<LiveTemplate render={component.crystal.render} scope={{ ...argValues, ...scope }} interactive={interactive} confirm={confirm} />}{dialog}</>;
}

export function ExplicitThingRender({ thing, compact }: { thing: ThingsThing; compact?: boolean }) {
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const user = useCurrentUser();
	const plane = useDataPlane();
	const identity = React.useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
	const parsed = React.useMemo(() => parseExplicitRenderComponent(thing), [thing]);
	const pointer = parsed.status === 'ready' && parsed.value.kind === 'reference' ? parsed.value.thingId : null;
	const key = JSON.stringify([user?.id || null, plane, identity.generation, thing.id, thing.updatedAt, pointer]);
	const [resolution, setResolution] = React.useState<ExplicitComponentResolution | null>(null);
	const pending = React.useRef<AbortController | null>(null);
	const refresh = React.useCallback(() => {
		if (!pointer || pending.current) return;
		const controller = new AbortController();
		pending.current = controller;
		// Keep a verified presentation visible during revalidation. A new
		// identity or first load still presents the honest loading state.
		setResolution((current) => current?.key === key && current.status === 'ready' ? current : { key, status: 'loading', component: null });
		void apiRef.current.v1.things.get(
			{ id: pointer },
			{ signal: controller.signal, expectedActor: user?.id, expectedDataPlane: plane }
		).then((response: { thing?: unknown }) => {
			if (controller.signal.aborted) return;
			const next = resolveSavedRenderComponent(response?.thing, pointer);
			setResolution({ key, status: next.status, component: next.component });
		}).catch(() => {
			if (!controller.signal.aborted) setResolution({ key, status: 'unavailable', component: null });
		}).finally(() => {
			if (pending.current === controller) pending.current = null;
		});
	}, [key, pointer, plane, user?.id]);

	React.useEffect(() => {
		if (!pointer) return;
		const visibleRefresh = () => {
			if (document.visibilityState === 'visible') refresh();
		};
		refresh();
		const timer = activityInterval('timer:components/Builder/ExplicitThingRender:1', 'Explicit Thing renderer access', visibleRefresh, 60_000);
		activityEvents(window, 'events:components/Builder/ExplicitThingRender', 'ExplicitThingRender').addEventListener('focus', visibleRefresh);
		activityEvents(document, 'events:components/Builder/ExplicitThingRender', 'ExplicitThingRender').addEventListener('visibilitychange', visibleRefresh);
		return () => {
			clearActivityInterval(timer);
			activityEvents(window, 'events:components/Builder/ExplicitThingRender', 'ExplicitThingRender').removeEventListener('focus', visibleRefresh);
			activityEvents(document, 'events:components/Builder/ExplicitThingRender', 'ExplicitThingRender').removeEventListener('visibilitychange', visibleRefresh);
			pending.current?.abort();
			pending.current = null;
		};
	}, [pointer, refresh]);

	if (parsed.status !== 'ready') return <InspectorChoice thing={thing} compact={compact} message={unavailableCopy[parsed.status]} />;
	if (parsed.value.kind === 'embedded') return <ExplicitComponentPresentation thing={thing} component={parsed.value.component} kind="embedded" />;

	const current = currentExplicitComponentResolution(resolution, key);
	if (current.status === 'loading') return <Text role="status" color="var(--tt-muted, #6f6f7b)" fontSize="sm">Opening presentation…</Text>;
	if (!current.component) return <InspectorChoice thing={thing} compact={compact} message={unavailableCopy[current.status]} />;
	return <ExplicitComponentPresentation thing={thing} component={current.component} kind="reference" />;
}
