import React from 'react';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost, type TransientBlockActions } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { lopuCredentialBlocks } from './lopuCredentialBlocks';
import { lopuCredentialPatch, lopuCredentialView } from './lopuCredentialChoice';
import { loadLopuModels, loadLopuChats, getLopuStoreSnapshot, setLopuAiDefaults, type LopuAiDefaults } from './lopuChatStore';
import type { AiModelPublic, LopuVaultProvider } from './lopuProviderCore';
import { useLopuChat } from './useLopuChat';

export function LopuCredentialSettings({
	mode = 'chat',
	value,
	models,
	providers,
	onChange,
	disabled = false
}: {
	mode?: 'defaults' | 'chat';
	value: LopuAiDefaults;
	models: AiModelPublic[];
	providers: LopuVaultProvider[];
	onChange: (patch: Partial<LopuAiDefaults>) => void;
	disabled?: boolean;
}) {
	const user = useCurrentUser();
	const plane = useDataPlane();
	const origin = typeof window === 'undefined' ? '' : window.location.origin;
	const scope = `${origin}:${user?.id || 'anonymous'}:${plane}:${mode}:${mode === 'chat' ? getLopuStoreSnapshot().activeChatId : 'defaults'}`;
	const current = React.useRef(scope);
	current.current = scope;
	const [refreshing, setRefreshing] = React.useState(false);
	const [error, setError] = React.useState('');
	const snapshot = getLopuStoreSnapshot();
	const unresolvedChat = mode === 'chat' && !!snapshot.activeChatId && !snapshot.chats.some((chat) => chat.id === snapshot.activeChatId);
	const view = lopuCredentialView(value, models, providers, mode);
	if (unresolvedChat) {
		view.credential = 'unresolved';
		view.credentials.push({ id: 'unresolved', label: 'Load this chat’s saved choice', disabled: true });
		view.endpoint = 'Waiting for saved chat settings';
		view.problem = 'This chat’s saved AI choice is not loaded. Refresh to load it before changing credentials.';
	}
	const actions: TransientBlockActions = {};
	for (const operation of ['ai.credential', 'ai.model', 'ai.effort', 'ai.speed'])
		actions[operation] = (invocation) => {
			invocation.signal.throwIfAborted();
			if (current.current !== scope || !user?.id || disabled || unresolvedChat) return;
			const patch = lopuCredentialPatch(operation, invocation.value, models, providers, value);
			if (!patch) {
				setError('That choice is unavailable. Refresh credentials and models.');
				return;
			}
			setError('');
			onChange(patch);
		};
	actions['ai.refresh'] = async ({ signal }) => {
		if (current.current !== scope || !user?.id || refreshing) return;
		setRefreshing(true);
		try {
			await Promise.all([loadLopuModels(), loadLopuChats()]);
		} finally {
			if (!signal.aborted && current.current === scope) setRefreshing(false);
		}
	};
	return (
		<SettingsDocumentHost documentKey={`lopu-ai-${mode}`} defaultDocument={lopuCredentialBlocks} scopeKey={scope} title="Lopu AI settings layout">
			{({ blocks, chrome, editing }) => (
				<TransientBlockHost
					scopeKey={scope}
					scope={{ ai: { ...view, disabled: disabled || !user?.id || unresolvedChat, refreshing, problem: error || view.problem } }}
					actions={actions}
					enabled={!editing}
					onError={() => setError('The choice could not be updated. Please retry.')}
				>
					<WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
				</TransientBlockHost>
			)}
		</SettingsDocumentHost>
	);
}

export function LopuAiDefaultsSettings() {
	const chat = useLopuChat();
	const defaults = getLopuStoreSnapshot().aiDefaults;
	return (
		<LopuCredentialSettings
			mode="defaults"
			value={defaults || { model: null, effort: null, speed: null, providerId: null }}
			models={chat.models}
			providers={chat.vaultProviders}
			onChange={setLopuAiDefaults}
		/>
	);
}
