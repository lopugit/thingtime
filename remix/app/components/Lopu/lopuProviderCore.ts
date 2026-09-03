// Pure helpers behind the model / provider picker (LopuModelPicker.tsx) and
// the single-control <LopuProviderSelect>: the client shape of the viewer's
// Secure Vault providers (GET /api/v1/ai/models → vaultProviders / vault), the
// grouped option list (Claude / OpenAI / Your providers) and the composite
// option keys a native <select> can carry. No React, no fetch — unit-tested
// in node (lopuProviderCore.test.ts). Vault entries are metadata only: the
// server never sends a credential to the client (write-only providers).

// ——— wire shapes ————————————————————————————————————————————————————————————

// GET /api/v1/ai/models (design note §1.1) — one catalog row
export type AiModelPublic = {
	id: string;
	label: string;
	provider: 'anthropic' | 'openai';
	efforts: string[];
	speeds: string[];
	family: string;
	enabled: boolean;
	available: boolean;
	// the provider key's server-side probe verdict: true verified, false
	// rejected ("key invalid"), null unknown; absent on older servers
	verified?: boolean | null;
	isDefault: boolean;
};

// GET /api/v1/ai/models → providers.<p> — the server key behind a catalog
// provider: presence plus the bounded probe's verdict (never a value)
export type LopuProviderKeyInfo = { configured: boolean; verified?: boolean | null; checkedAt?: string | null; reason?: string | null };

// a realtime speech-to-speech model the kind offers (direct voice, §6.1)
export type LopuRealtimeModel = { id: string; label: string };

// GET /api/v1/ai/models → vaultProviders[] — one of the viewer's own
// provider connections (name, kind, model, endpoint host, the kind's direct-
// voice models; never the key)
export type LopuVaultProvider = {
	id: string;
	name: string;
	kind: string;
	model: string | null;
	endpointHost: string | null;
	available: boolean;
	reason: string | null;
	realtimeModels: LopuRealtimeModel[];
};

// GET /api/v1/ai/models → vault
export type LopuVaultInfo = { configured: boolean };

const textOrNull = (value: unknown, max = 200): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed ? trimmed.slice(0, max) : null;
};

const normalizeRealtimeModels = (raw: unknown): LopuRealtimeModel[] => {
	if (!Array.isArray(raw)) return [];
	const out: LopuRealtimeModel[] = [];
	for (const entry of raw.slice(0, 20)) {
		if (!entry || typeof entry !== 'object') continue;
		const id = textOrNull((entry as { id?: unknown }).id, 160);
		if (!id) continue;
		out.push({ id, label: textOrNull((entry as { label?: unknown }).label, 80) ?? id });
	}
	return out;
};

export const normalizeLopuVaultProvider = (raw: unknown): LopuVaultProvider | null => {
	if (!raw || typeof raw !== 'object') return null;
	const source = raw as Record<string, unknown>;
	const id = textOrNull(source.id, 120);
	if (!id) return null;
	return {
		id,
		name: textOrNull(source.name, 120) ?? id,
		kind: textOrNull(source.kind, 40) ?? 'compatible',
		model: textOrNull(source.model, 160),
		endpointHost: textOrNull(source.endpointHost, 253),
		available: source.available !== false,
		reason: textOrNull(source.reason, 200),
		realtimeModels: normalizeRealtimeModels(source.realtimeModels)
	};
};

export const normalizeLopuVaultProviders = (raw: unknown): LopuVaultProvider[] =>
	Array.isArray(raw) ? raw.map(normalizeLopuVaultProvider).filter((entry): entry is LopuVaultProvider => !!entry) : [];

export const normalizeLopuVaultInfo = (raw: unknown): LopuVaultInfo | null => {
	if (!raw || typeof raw !== 'object') return null;
	return { configured: (raw as { configured?: unknown }).configured === true };
};

export const findLopuVaultProvider = (providers: LopuVaultProvider[] | null | undefined, id: string | null | undefined): LopuVaultProvider | null =>
	id && Array.isArray(providers) ? providers.find((entry) => entry.id === id) ?? null : null;

// ——— labels ———————————————————————————————————————————————————————————————

export const PROVIDER_FAMILY_LABELS: Record<string, string> = { anthropic: 'Claude', openai: 'OpenAI' };
export const PROVIDER_KEY_LABELS: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI' };
export const VAULT_KIND_LABELS: Record<string, string> = {
	anthropic: 'Anthropic',
	openai: 'OpenAI',
	google: 'Google',
	xai: 'xAI',
	openrouter: 'OpenRouter',
	mistral: 'Mistral',
	deepseek: 'DeepSeek',
	groq: 'Groq',
	cohere: 'Cohere',
	compatible: 'OpenAI-compatible'
};
export const YOUR_PROVIDERS_LABEL = 'Your providers';

/** The picker's group heading for a catalog provider ("Claude", "OpenAI"). */
export const providerFamilyLabel = (provider: string): string => PROVIDER_FAMILY_LABELS[provider] || provider;
/** The key holder's name for "needs … key" copy ("Anthropic", "OpenAI"). */
export const providerKeyLabel = (provider: string): string => PROVIDER_KEY_LABELS[provider] || provider;
export const vaultKindLabel = (kind: string): string => VAULT_KIND_LABELS[kind] || kind;

/** Why a catalog model cannot be picked right now (null = pickable). */
export const modelUnavailableReason = (model: Pick<AiModelPublic, 'enabled' | 'available' | 'provider' | 'verified'>): string | null => {
	if (model.enabled === false) return 'disabled by an admin';
	if (model.available === false) return model.verified === false ? `${providerKeyLabel(model.provider)} key invalid` : `needs ${providerKeyLabel(model.provider)} key`;
	return null;
};

// ——— provider key status (admin editor) ————————————————————————————————————

export type LopuProviderKeyState = 'verified' | 'invalid' | 'unverified' | 'missing';

/** The server key's state for one catalog provider (from providers.<p>). */
export const providerKeyState = (info: LopuProviderKeyInfo | null | undefined): LopuProviderKeyState => {
	if (!info || info.configured !== true) return 'missing';
	if (info.verified === true) return 'verified';
	if (info.verified === false) return 'invalid';
	return 'unverified';
};

export const PROVIDER_KEY_STATE_LABELS: Record<LopuProviderKeyState, string> = {
	verified: 'key verified',
	invalid: 'key invalid',
	unverified: 'key unverified',
	missing: 'no key'
};

/** "checked just now" / "checked 3 min ago" / "checked 2 h ago" / "checked 3 Sep 14:02"; null when unknown. */
export const describeCheckedAt = (checkedAt: string | null | undefined, now: number = Date.now()): string | null => {
	if (!checkedAt) return null;
	const at = Date.parse(checkedAt);
	if (!Number.isFinite(at)) return null;
	const seconds = Math.max(0, Math.round((now - at) / 1000));
	if (seconds < 45) return 'checked just now';
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `checked ${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `checked ${hours} h ago`;
	const date = new Date(at);
	const month = date.toLocaleString('en', { month: 'short' });
	return `checked ${date.getDate()} ${month} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

/** Why a vault provider cannot be used right now (null = usable). */
export const vaultProviderUnavailableReason = (provider: Pick<LopuVaultProvider, 'available' | 'reason'>): string | null =>
	provider.available === false ? provider.reason || 'unavailable' : null;

// ——— direct voice (§6.1) ——————————————————————————————————————————————————

/** A vault provider can run direct voice when it is usable and its kind lists a realtime model. */
export const vaultProviderSupportsDirectVoice = (provider: LopuVaultProvider | null | undefined): boolean =>
	!!provider && provider.available !== false && provider.realtimeModels.length > 0;

export const DIRECT_VOICE_TRANSCRIBE_REASON = 'Off while transcribing — utterances become private pages';
export const DIRECT_VOICE_NO_PROVIDER_REASON = 'Choose one of your Secure Vault providers first';
export const DIRECT_VOICE_NO_REALTIME_REASON = 'needs a provider with realtime voice (xAI Grok Voice)';

/**
 * Why direct voice cannot run for this session (null = it can): the one-line
 * explanation the voice gear shows beside the disabled switch.
 */
export const directVoiceUnavailableReason = (provider: LopuVaultProvider | null | undefined, transcribe: boolean): string | null => {
	if (transcribe) return DIRECT_VOICE_TRANSCRIBE_REASON;
	if (!provider) return DIRECT_VOICE_NO_PROVIDER_REASON;
	if (provider.available === false) return provider.reason || 'This provider is unavailable right now';
	if (!provider.realtimeModels.length) return `${provider.name} ${DIRECT_VOICE_NO_REALTIME_REASON}`;
	return null;
};

/** The realtime model a session runs: the chosen one when the provider still lists it, else its first. */
export const resolveDirectVoiceModel = (provider: LopuVaultProvider | null | undefined, chosen: string | null | undefined): LopuRealtimeModel | null => {
	if (!provider?.realtimeModels.length) return null;
	return (chosen ? provider.realtimeModels.find((model) => model.id === chosen) : null) ?? provider.realtimeModels[0] ?? null;
};

/** "gpt-4o · api.openai.com" — the small hint under a vault option. */
export const vaultProviderHint = (provider: Pick<LopuVaultProvider, 'model' | 'endpointHost' | 'kind'>): string => {
	const bits = [provider.model, provider.endpointHost].filter((entry): entry is string => !!entry);
	return bits.length ? bits.join(' · ') : vaultKindLabel(provider.kind);
};

// ——— composite keys (what a native <select> carries) ————————————————————————

export type LopuProviderChoice = { model: string | null; providerId: string | null };

export const lopuProviderChoiceKey = (choice: Partial<LopuProviderChoice> | null | undefined): string => {
	if (choice?.providerId) return `vault:${choice.providerId}`;
	if (choice?.model) return `model:${choice.model}`;
	return '';
};

export const parseLopuProviderChoiceKey = (key: string | null | undefined): LopuProviderChoice | null => {
	if (typeof key !== 'string' || !key) return null;
	if (key.startsWith('vault:')) {
		const providerId = key.slice('vault:'.length);
		return providerId ? { model: null, providerId } : null;
	}
	if (key.startsWith('model:')) {
		const model = key.slice('model:'.length);
		return model ? { model, providerId: null } : null;
	}
	// a bare catalog id is accepted too
	return { model: key, providerId: null };
};

// ——— the grouped option list ————————————————————————————————————————————————

export type LopuProviderOption = {
	key: string;
	kind: 'model' | 'vault';
	label: string;
	// one line under the label (vault: model · host; catalog: null)
	hint: string | null;
	model: string | null;
	providerId: string | null;
	disabled: boolean;
	reason: string | null;
	isDefault: boolean;
	// the catalog row behind a model option (efforts / speeds live here)
	catalog: AiModelPublic | null;
};

export type LopuProviderGroup = { id: string; label: string; options: LopuProviderOption[] };

const FAMILY_ORDER = ['anthropic', 'openai'];

/**
 * Server models grouped by provider family (Claude first, then OpenAI, then
 * anything new), followed by "Your providers" from the viewer's vault.
 * Empty groups are omitted; unavailable entries stay listed but disabled
 * with their reason so the viewer learns what to add.
 */
export const buildLopuProviderGroups = (models: AiModelPublic[], vaultProviders: LopuVaultProvider[] | null | undefined): LopuProviderGroup[] => {
	const byFamily = new Map<string, LopuProviderOption[]>();
	for (const model of models) {
		if (!model || typeof model.id !== 'string') continue;
		const reason = modelUnavailableReason(model);
		const list = byFamily.get(model.provider) || [];
		list.push({
			key: lopuProviderChoiceKey({ model: model.id }),
			kind: 'model',
			label: model.label || model.id,
			hint: null,
			model: model.id,
			providerId: null,
			disabled: !!reason,
			reason,
			isDefault: model.isDefault === true,
			catalog: model
		});
		byFamily.set(model.provider, list);
	}
	const families = [...byFamily.keys()].sort((a, b) => {
		const ai = FAMILY_ORDER.indexOf(a);
		const bi = FAMILY_ORDER.indexOf(b);
		return (ai === -1 ? FAMILY_ORDER.length : ai) - (bi === -1 ? FAMILY_ORDER.length : bi) || a.localeCompare(b);
	});
	const groups: LopuProviderGroup[] = families.map((family) => ({ id: family, label: providerFamilyLabel(family), options: byFamily.get(family) || [] }));
	const vault = Array.isArray(vaultProviders) ? vaultProviders : [];
	if (vault.length) {
		groups.push({
			id: 'vault',
			label: YOUR_PROVIDERS_LABEL,
			options: vault.map((provider) => {
				const reason = vaultProviderUnavailableReason(provider);
				return {
					key: lopuProviderChoiceKey({ providerId: provider.id }),
					kind: 'vault',
					label: provider.name,
					hint: vaultProviderHint(provider),
					model: provider.model,
					providerId: provider.id,
					disabled: !!reason,
					reason,
					isDefault: false,
					catalog: null
				};
			})
		});
	}
	return groups;
};

export const findLopuProviderOption = (groups: LopuProviderGroup[], key: string): LopuProviderOption | null => {
	for (const group of groups) for (const option of group.options) if (option.key === key) return option;
	return null;
};

// ——— chip / status copy ————————————————————————————————————————————————————

const EFFORT_LABELS: Record<string, string> = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };
export const effortLabel = (effort: string | null | undefined): string => (effort ? EFFORT_LABELS[effort] || effort : '');

/**
 * The composer chip's text: "Claude Opus 5 · High · Fast", or the vault
 * provider's name; "Auto" before a catalog exists and "No model" when the
 * catalog has nothing pickable.
 */
export const describeLopuChoice = (
	models: AiModelPublic[],
	vaultProviders: LopuVaultProvider[] | null | undefined,
	choice: { model: string | null; effort?: string | null; speed?: string | null; providerId?: string | null }
): string => {
	if (choice.providerId) {
		const provider = findLopuVaultProvider(vaultProviders, choice.providerId);
		return provider ? provider.name : 'Your provider';
	}
	if (!choice.model) return models.length ? 'No model' : 'Auto';
	const model = models.find((entry) => entry.id === choice.model);
	const bits = [model?.label || choice.model];
	const effort = effortLabel(choice.effort);
	if (effort) bits.push(effort);
	if (choice.speed === 'fast') bits.push('Fast');
	return bits.join(' · ');
};
