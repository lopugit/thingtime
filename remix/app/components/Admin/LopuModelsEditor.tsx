import React from 'react';
import { Box, Button, Flex, Select, Text } from '@chakra-ui/react';

import { LopuToggle } from '~/components/Lopu/LopuModelPicker';
import { LOPU_UI, lopuEyebrowSx } from '~/components/Lopu/lopuTheme';
import { useLopu } from '~/components/Lopu/useLopu';
import {
	describeLopuEffort,
	describeLopuModelChoice,
	findLopuCatalogModel,
	normalizeLopuCatalogModel,
	normalizeLopuSpeed,
	preferredLopuEffort,
	useLopuModelCatalog,
	type LopuCatalogDefaults,
	type LopuCatalogModel
} from '~/components/Lopu/useLopuSettings';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';

// Admin editor for Lopu's model catalog (the `ai-model` things): enable or
// disable each model and pick the chat defaults (model / effort / speed) that
// every viewer starts from. Rendered inside AdminPanel. Every action is
// re-checked server-side; this is only the surface.
//
// Optimistic per the house rule: the catalog paints from the per-device
// cache the moment the panel mounts, toggles flip instantly and revert on
// failure, and the server copy reconciles in the background.

// admin-stored defaults (may name a model that is currently unavailable — the
// public catalog resolves that to the first available one)
const STORED_DEFAULTS_CACHE_KEY = 'tt-lopu-admin-chat-defaults';

const EMPTY_DEFAULTS: LopuCatalogDefaults = { model: null, effort: null, speed: null };

// the Lopu family's eyebrow + a neutral hairline chip (no colour-coded badges)
const eyebrow = lopuEyebrowSx;

const Chip = ({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'ink' | 'danger' }) => (
	<Box
		as="span"
		display="inline-flex"
		alignItems="center"
		height="18px"
		px="7px"
		borderRadius={LOPU_UI.pill}
		border={LOPU_UI.border}
		bg={LOPU_UI.card}
		fontSize="10px"
		fontWeight={600}
		letterSpacing="0.02em"
		lineHeight={1}
		whiteSpace="nowrap"
		color={tone === 'danger' ? LOPU_UI.danger : tone === 'ink' ? LOPU_UI.ink : LOPU_UI.muted}
	>
		{children}
	</Box>
);

const selectSx = {
	bg: LOPU_UI.card,
	color: LOPU_UI.ink,
	borderColor: LOPU_UI.borderColor,
	borderRadius: LOPU_UI.radiusSm,
	_hover: { borderColor: LOPU_UI.faint },
	_focusVisible: { borderColor: LOPU_UI.ink, boxShadow: 'none' }
} as const;

const PROVIDER_LABELS: Record<string, string> = {
	anthropic: 'Anthropic',
	openai: 'OpenAI'
};

const providerLabel = (provider: string): string => PROVIDER_LABELS[provider] ?? provider;

const normalizeDefaults = (raw: unknown): LopuCatalogDefaults => {
	const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	return {
		model: typeof source.model === 'string' && source.model.trim() ? source.model.trim() : null,
		effort: typeof source.effort === 'string' && source.effort.trim() ? source.effort.trim() : null,
		speed: normalizeLopuSpeed(source.speed)
	};
};

const sameDefaults = (left: LopuCatalogDefaults, right: LopuCatalogDefaults): boolean => {
	return left.model === right.model && left.effort === right.effort && left.speed === right.speed;
};

const readStoredDefaults = (): LopuCatalogDefaults => normalizeDefaults(readLocalCache<unknown>(STORED_DEFAULTS_CACHE_KEY) ?? EMPTY_DEFAULTS);

const errorMessage = (error: unknown, fallback: string): string => {
	const message = (error as { error?: unknown; message?: unknown } | null)?.error ?? (error as { message?: unknown } | null)?.message;
	return typeof message === 'string' && message ? message : fallback;
};

export const LopuModelsEditor = () => {
	const api = useApi();
	const lopu = useLopu();
	const { catalog, hasCatalog, loading, failed, refresh, setCatalog } = useLopuModelCatalog(true);

	const apiRef = React.useRef(api);
	apiRef.current = api;

	const [stored, setStored] = React.useState<LopuCatalogDefaults>(readStoredDefaults);
	const [draft, setDraft] = React.useState<LopuCatalogDefaults | null>(null);
	const [savingDefaults, setSavingDefaults] = React.useState(false);
	const [busyId, setBusyId] = React.useState<string | null>(null);
	const [seeding, setSeeding] = React.useState(false);

	// the stored singleton (not the resolved default the public list reports)
	React.useEffect(() => {
		let cancelled = false;
		apiRef.current.v1.settings
			.lopuChatDefaults()
			.then((resp: any) => {
				if (cancelled || !resp?.ok) return;
				const next = normalizeDefaults(resp.defaults ?? resp);
				setStored(next);
				writeLocalCache(STORED_DEFAULTS_CACHE_KEY, next);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	const current = draft ?? stored;
	const dirty = !!draft && !sameDefaults(draft, stored);
	const currentModel = findLopuCatalogModel(catalog, current.model);
	const resolvedLabel = describeLopuModelChoice(catalog, { model: null, effort: null, speed: null });

	const patchModel = React.useCallback(
		(id: string, patch: Partial<LopuCatalogModel>) => {
			setCatalog((prev) => (prev ? { ...prev, models: prev.models.map((model) => (model.id === id ? { ...model, ...patch } : model)) } : prev));
		},
		[setCatalog]
	);

	const toggleModel = async (model: LopuCatalogModel, enabled: boolean) => {
		if (busyId) return;
		const providerConfigured = catalog.providers[model.provider]?.configured ?? model.available;
		const previous = { enabled: model.enabled, available: model.available };
		// optimistic — the switch flips now and reverts if the server refuses
		patchModel(model.id, { enabled, available: enabled && providerConfigured });
		setBusyId(model.id);
		try {
			const resp = await apiRef.current.v1.admin.setAiModel({ id: model.id, enabled });
			if (resp?.ok) {
				const saved = normalizeLopuCatalogModel(resp.model);
				if (saved) patchModel(model.id, saved);
				lopu({ title: enabled ? `${model.label} enabled ✨` : `${model.label} disabled`, status: 'success', duration: 5000 });
			} else {
				patchModel(model.id, previous);
				lopu({ title: 'Could not update the model', description: resp?.error, status: 'error' });
			}
		} catch (error: unknown) {
			patchModel(model.id, previous);
			lopu({ title: 'Could not update the model', description: errorMessage(error, 'Please try again in a moment.'), status: 'error' });
		} finally {
			setBusyId(null);
		}
	};

	const seed = async () => {
		setSeeding(true);
		try {
			const resp = await apiRef.current.v1.admin.setAiModel({ seed: true });
			if (resp?.ok) {
				const count = Array.isArray(resp.models) ? resp.models.length : typeof resp.seeded === 'number' ? resp.seeded : null;
				lopu({ title: count === null ? 'Catalog seeded ✨' : `Catalog seeded — ${count} models ✨`, status: 'success', duration: 5000 });
				await refresh();
			} else {
				lopu({ title: 'Could not seed the catalog', description: resp?.error, status: 'error' });
			}
		} catch (error: unknown) {
			lopu({ title: 'Could not seed the catalog', description: errorMessage(error, 'Please try again in a moment.'), status: 'error' });
		} finally {
			setSeeding(false);
		}
	};

	// the stored default must name a real catalog model (the server refuses
	// null / the `default` sentinel); availability is applied at read time
	const pickDefaultModel = (id: string) => {
		const model = findLopuCatalogModel(catalog, id);
		if (!model) return;
		setDraft({
			model: model.id,
			// effort tiers and fast mode are per-model: reset both on a model change
			effort: preferredLopuEffort(model, stored.model === model.id ? stored.effort : null),
			speed: 'normal'
		});
	};

	const saveDefaults = async () => {
		if (!draft || !draft.model) return;
		setSavingDefaults(true);
		try {
			const resp = await apiRef.current.v1.admin.setLopuChatDefaults(draft);
			if (resp?.ok) {
				const saved = normalizeDefaults(resp.defaults ?? draft);
				setStored(saved);
				setDraft(null);
				writeLocalCache(STORED_DEFAULTS_CACHE_KEY, saved);
				lopu({ title: 'Lopu chat defaults saved ✨', status: 'success', duration: 5000 });
				// the public list re-resolves `defaults` from the new singleton
				refresh();
			} else {
				lopu({ title: 'Could not save the defaults', description: resp?.error, status: 'error' });
			}
		} catch (error: unknown) {
			lopu({ title: 'Could not save the defaults', description: errorMessage(error, 'Please try again in a moment.'), status: 'error' });
		} finally {
			setSavingDefaults(false);
		}
	};

	const providerSummary = Object.entries(catalog.providers);

	return (
		<Flex flexDirection="column" rowGap={3}>
			<Text sx={eyebrow}>Lopu models 🦄</Text>
			<Text fontSize="xs" color={LOPU_UI.muted} lineHeight="1.5">
				The catalog Lopu may think with. A model is offered to people only while it is enabled here and its provider key is set on the server.
				{providerSummary.length > 0 && (
					<>
						{' '}
						{providerSummary.map(([provider, info]) => `${providerLabel(provider)}: ${info.configured ? 'key set' : 'no key'}`).join(' · ')}
					</>
				)}
			</Text>

			{!hasCatalog && loading && (
				<Text fontSize="xs" color={LOPU_UI.muted}>
					Loading the catalog…
				</Text>
			)}
			{!hasCatalog && failed && (
				<Text fontSize="xs" color={LOPU_UI.danger}>
					Could not load the catalog. Seed it below, or try again in a moment.
				</Text>
			)}
			{hasCatalog && catalog.models.length === 0 && (
				<Text fontSize="xs" color={LOPU_UI.muted}>
					No models yet — seed the catalog to create one `ai-model` thing per base model.
				</Text>
			)}

			<Flex flexDirection="column" rowGap={1}>
				{catalog.models.map((model) => {
					const configured = catalog.providers[model.provider]?.configured ?? model.available;
					return (
						<Flex
							key={model.id}
							alignItems="center"
							columnGap={3}
							rowGap={1}
							flexWrap="wrap"
							px={3}
							py={2}
							borderRadius={LOPU_UI.radiusMd}
							border={LOPU_UI.border}
							background={LOPU_UI.surfaceAlt}
							opacity={model.enabled ? 1 : 0.7}
						>
							<Box minWidth={0} flex="1 1 200px">
								<Flex alignItems="center" columnGap={2} rowGap={1} flexWrap="wrap">
									<Text fontSize="sm" fontWeight={600} color={LOPU_UI.ink} noOfLines={1}>
										{model.label}
									</Text>
									<Chip>{providerLabel(model.provider)}</Chip>
									{model.isDefault && <Chip tone="ink">default</Chip>}
									{!configured && <Chip tone="danger">needs {providerLabel(model.provider)} key</Chip>}
								</Flex>
								<Text fontSize="11px" color={LOPU_UI.muted} wordBreak="break-word" mt="2px">
									{model.id}
									{model.efforts.length ? ` · effort ${model.efforts.map((effort) => describeLopuEffort(effort)).join(' / ')}` : ''}
									{model.speeds.includes('fast') ? ' · fast mode' : ''}
								</Text>
							</Box>
							<Flex alignItems="center" columnGap={2} marginLeft="auto">
								<Text fontSize="xs" color={LOPU_UI.muted}>
									{model.enabled ? 'On' : 'Off'}
								</Text>
								<LopuToggle checked={model.enabled} disabled={busyId === model.id} label={`${model.label} enabled`} onChange={(next) => toggleModel(model, next)} />
							</Flex>
						</Flex>
					);
				})}
			</Flex>

			<Flex columnGap={2} rowGap={2} flexWrap="wrap" alignItems="center">
				<Button size="xs" variant="outline" borderColor={LOPU_UI.borderColor} color={LOPU_UI.ink} borderRadius={LOPU_UI.radiusSm} isLoading={seeding} onClick={seed}>
					{catalog.models.length ? 'Re-seed catalog' : 'Seed catalog'}
				</Button>
				<Text fontSize="xs" color={LOPU_UI.muted}>
					Upserts one `ai-model` thing per base model; your enabled/disabled choices are kept.
				</Text>
			</Flex>

			<Text sx={eyebrow}>Chat defaults</Text>
			<Text fontSize="xs" color={LOPU_UI.muted} lineHeight="1.5">
				What every Lopu conversation starts from. Resolved right now: <strong>{resolvedLabel}</strong>
				{stored.model && stored.model !== catalog.defaults.model ? ` (stored ${stored.model} is unavailable, so the first available model stands in)` : ''}.
			</Text>
			<Flex columnGap={2} rowGap={2} flexWrap="wrap" alignItems="center">
				<Select size="xs" maxWidth="240px" value={current.model ?? ''} aria-label="Default model" sx={selectSx} onChange={(event) => pickDefaultModel(event.target.value)}>
					{!current.model && (
						<option value="" disabled>
							Pick a model…
						</option>
					)}
					{catalog.models.map((model) => (
						<option key={model.id} value={model.id}>
							{model.label}
							{model.enabled ? '' : ' — disabled'}
							{model.enabled && !model.available ? ` — needs ${providerLabel(model.provider)} key` : ''}
						</option>
					))}
				</Select>
				{!!currentModel?.efforts.length && (
					<Select
						size="xs"
						maxWidth="160px"
						value={current.effort ?? ''}
						aria-label="Default reasoning effort"
						sx={selectSx}
						onChange={(event) => setDraft({ ...current, effort: event.target.value || null })}
					>
						{currentModel.efforts.map((effort) => (
							<option key={effort} value={effort}>
								{describeLopuEffort(effort)}
							</option>
						))}
					</Select>
				)}
				{!!currentModel?.speeds.includes('fast') && (
					<Select
						size="xs"
						maxWidth="140px"
						value={current.speed ?? 'normal'}
						aria-label="Default speed"
						sx={selectSx}
						onChange={(event) => setDraft({ ...current, speed: normalizeLopuSpeed(event.target.value) })}
					>
						{currentModel.speeds.map((speed) => (
							<option key={speed} value={speed}>
								{speed === 'fast' ? 'Fast' : 'Normal'}
							</option>
						))}
					</Select>
				)}
				<Button
					size="xs"
					variant="solid"
					bg={LOPU_UI.ink}
					color={LOPU_UI.card}
					borderRadius={LOPU_UI.radiusSm}
					_hover={{ opacity: 0.9 }}
					_disabled={{ opacity: 0.45, cursor: 'not-allowed' }}
					isLoading={savingDefaults}
					isDisabled={!dirty || !current.model}
					onClick={saveDefaults}
				>
					Save defaults
				</Button>
				{dirty && (
					<Button size="xs" variant="ghost" color={LOPU_UI.muted} onClick={() => setDraft(null)}>
						Discard
					</Button>
				)}
			</Flex>
		</Flex>
	);
};
