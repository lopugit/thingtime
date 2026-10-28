import React from 'react';
import { Box } from '@chakra-ui/react';
import { useLocation, useNavigate } from 'react-router';
import { useLopu } from '~/components/Lopu/useLopu';
import { LOCAL_UI_ACTION, localQueryHref, reduceLocalUi } from '../Actions/localUiAction';
import { componentNavigationState, componentPageHref, hasComponentBackEntry } from './componentNavigation';
import { ComponentDataScope } from './ComponentSelect';
import { ComponentLocalControl } from './NativeComponentControls';
import { useWebpageRuntime } from './webpageRuntime';
import {
	clickTtActionForEnter,
	useTtActionClicks,
	type TtActionConfirmHandler,
	type TtActionUnownedHandler
} from '../Actions/useTtActionClicks';

/** A saved Component already handles its own controls inside its LiveTemplate. */
export const isExpandedPageControl = (target: { closest: (selector: string) => Element | null } | null): boolean =>
	!!target && !target.closest('[data-live], [data-tt-native-upload], [data-tt-discussion]');

export const isExpandedPageAction = (target: { closest: (selector: string) => Element | null } | null): boolean =>
	isExpandedPageControl(target) && !!target?.closest('[data-tt-action]');

/** A page-level fallback must never collect fields from unrelated rows. */
export const expandedActionGroup = (control: HTMLElement, boundary: HTMLElement): HTMLElement => {
	const group = control.closest<HTMLElement>('[data-tt-action-group]');
	return group && boundary.contains(group) ? group : control;
};

export const PageActionSurface = ({
	actionEnabled,
	onUnowned,
	confirm,
	surfaceRef,
	...props
}: React.ComponentProps<typeof Box> & {
	actionEnabled: boolean;
	onUnowned?: TtActionUnownedHandler;
	confirm?: TtActionConfirmHandler;
	surfaceRef?: React.Ref<HTMLDivElement>;
}) => {
	const runtime = useWebpageRuntime();
	const parentScope = React.useContext(ComponentDataScope);
	const navigate = useNavigate();
	const location = useLocation();
	const lopu = useLopu();
	const identity = JSON.stringify([runtime.viewer.id, runtime.pageId, runtime.query]);
	const [local, setLocal] = React.useState<{ identity: string; values: Record<string, unknown> }>({ identity, values: {} });
	const values = local.identity === identity ? local.values : {};
	const onLocal = (input: Record<string, unknown>) => {
		if (input.op === 'query' || input.op === 'back') {
			if (input.op === 'back' && hasComponentBackEntry(runtime.pageId, location, location.state)) {
				navigate(-1);
				return;
			}
			const href = localQueryHref(runtime.pageId, input.params);
			if (href) {
				const to = componentPageHref(runtime.pageId, location, href);
				navigate(to, { state: input.op === 'query' ? componentNavigationState(runtime.pageId, location, to) : undefined });
			}
			return;
		}
		if (input.op === 'copy' && typeof input.value === 'string' && input.value.length <= 5000) {
			if (!navigator.clipboard) lopu({ title: 'Clipboard unavailable', description: 'Copy is available on secure pages.', status: 'info' });
			else void navigator.clipboard.writeText(input.value)
				.then(() => lopu({ title: 'Copied', status: 'success' }))
				.catch(() => lopu({ title: 'Could not copy', description: 'Your browser did not allow clipboard access.', status: 'error' }));
			return;
		}
		if (input.op === 'search' && typeof input.value === 'string') {
			navigate(`/search?q=${encodeURIComponent(input.value.slice(0, 500))}`);
			return;
		}
		setLocal((previous) => ({ identity, values: reduceLocalUi(previous.identity === identity ? previous.values : {}, parentScope, input) }));
	};
	const onAction = useTtActionClicks({ onUnowned, confirm, onLocal, fallbackGroup: expandedActionGroup });
	return <ComponentLocalControl.Provider value={actionEnabled ? onLocal : null}>
		<ComponentDataScope.Provider value={{ ...parentScope, ...values }}>
		<Box
		{...props}
		ref={surfaceRef}
		onClickCapture={actionEnabled ? (event: React.MouseEvent<HTMLDivElement>) => {
			if (isExpandedPageAction(event.target as Element)) onAction(event);
		} : undefined}
		onChangeCapture={actionEnabled ? (event: React.ChangeEvent<HTMLDivElement>) => {
			const field = event.target as HTMLInputElement;
			if (!isExpandedPageControl(field) || field.getAttribute('data-tt-action') !== LOCAL_UI_ACTION) return;
			try {
				const input = JSON.parse(field.getAttribute('data-tt-action-inputs') || '{}');
				onLocal({ ...input, op: 'set', value: field.type === 'checkbox' ? field.checked : field.type === 'number' || field.type === 'range' ? Number(field.value) : field.value });
			} catch {}
		} : undefined}
		onKeyDownCapture={actionEnabled ? (event: React.KeyboardEvent<HTMLDivElement>) => {
			if (isExpandedPageControl(event.target as Element)) clickTtActionForEnter(event, true);
		} : undefined}
		/>
		</ComponentDataScope.Provider>
	</ComponentLocalControl.Provider>;
};
