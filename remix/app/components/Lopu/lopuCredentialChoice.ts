import type { AiModelPublic, LopuVaultProvider } from './lopuProviderCore';
import type { LopuAiDefaults } from './lopuChatStore';

export function lopuCredentialView(value: LopuAiDefaults, models: AiModelPublic[], providers: LopuVaultProvider[], mode: 'defaults' | 'chat') {
	const provider = providers.find((row) => row.id === value.providerId);
	const model = models.find((row) => row.id === value.model);
	const usesCredits = !value.providerId;
	const missing = !!value.providerId && !provider;
	const plan = value.providerId?.startsWith('chatgpt-plan-') === true;
	const credentials = providers.map((row) => ({
		id: row.id,
		label: `${row.name}${row.id.startsWith('chatgpt-plan-') ? ' · ChatGPT OAuth' : ' · saved credential'}${row.available ? '' : ' · unavailable'}`,
		disabled: !row.available
	}));
	if (missing) credentials.push({ id: value.providerId!, label: 'Saved credential unavailable', disabled: true });
	return {
		heading: mode === 'defaults' ? 'Default AI for new chats' : 'AI for this chat',
		description:
			mode === 'defaults'
				? 'Saved for this Thingtime account on this device. Existing chats keep their own choices.'
				: 'This choice is saved with this chat. Your defaults and other chats stay unchanged.',
		credential: value.providerId || 'credits',
		credentialName: provider?.name || 'Saved credential unavailable',
		credentials,
		usesCredits,
		usesCredential: !usesCredits,
		endpoint: usesCredits ? 'Thingtime managed API' : provider?.endpointHost || 'Unavailable — reconnect this credential',
		model: value.model || '',
		models: models.map((row) => ({ id: row.id, label: row.label, disabled: !row.enabled || !row.available })),
		providerModel: provider?.model || 'Choose a model in the saved connection settings',
		manageHref: '/settings?tab=security#secure-vault',
		effort: value.effort || '',
		efforts: (model?.efforts || []).map((id) => ({ id, label: id, disabled: false })),
		hasEfforts: usesCredits && !!model?.efforts.length,
		speed: value.speed || '',
		speeds: (model?.speeds || []).map((id) => ({ id, label: id, disabled: false })),
		hasSpeeds: usesCredits && !!model?.speeds.length,
		billing: usesCredits
			? 'Uses Thingtime credits under your account’s normal pricing.'
			: plan
			? 'Uses this account’s ChatGPT plan. No automatic fallback to Thingtime credits.'
			: 'Uses your saved credential and its provider billing. No automatic fallback to Thingtime credits.',
		problem: missing
			? 'This saved credential is not available on the current runtime. Reconnect it or explicitly choose another credential.'
			: provider?.available === false
			? provider.reason || 'This credential is unavailable. Reconnect it or choose another credential.'
			: ''
	};
}

export function lopuCredentialPatch(
	operation: string,
	raw: unknown,
	models: AiModelPublic[],
	providers: LopuVaultProvider[],
	value: LopuAiDefaults
): Partial<LopuAiDefaults> | null {
	if (typeof raw !== 'string') return null;
	if (operation === 'ai.credential') {
		if (raw === 'credits') return { providerId: null };
		return providers.some((row) => row.id === raw && row.available) ? { providerId: raw } : null;
	}
	if (value.providerId) return null;
	if (operation === 'ai.model') {
		if (!raw) return { model: null, effort: null, speed: null };
		return models.some((row) => row.id === raw && row.available && row.enabled) ? { model: raw, effort: null, speed: null } : null;
	}
	const model = models.find((row) => row.id === value.model);
	if (operation === 'ai.effort' && (!raw || model?.efforts.includes(raw))) return { effort: raw || null };
	if (operation === 'ai.speed' && (!raw || model?.speeds.includes(raw))) return { speed: raw || null };
	return null;
}
