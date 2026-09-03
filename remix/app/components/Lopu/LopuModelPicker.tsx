import React from 'react';
import { Box, Button, Flex, Input, Popover, PopoverBody, PopoverContent, PopoverTrigger, Select, Switch, Text } from '@chakra-ui/react';

import type { AiModelPublic, LopuChatSettings, LopuProviderTemplatePublic, LopuVaultProviderPublic } from './lopuChatStore';

const MUTED = 'var(--tt-muted, #9a9aa6)';
const INK = 'var(--tt-ink, #16161a)';
const CUSTOM_MODEL = '__custom_model__';

const PROVIDER_LABELS: Record<string, string> = {
	anthropic: 'Anthropic',
	openai: 'OpenAI',
	google: 'Google Gemini',
	xai: 'xAI',
	openrouter: 'OpenRouter',
	mistral: 'Mistral',
	deepseek: 'DeepSeek',
	groq: 'Groq',
	cohere: 'Cohere',
	compatible: 'Compatible API'
};
const EFFORT_LABELS: Record<string, string> = {
	none: 'None',
	minimal: 'Minimal',
	low: 'Low',
	medium: 'Medium',
	high: 'High',
	xhigh: 'Extra high',
	max: 'Max',
	ultra: 'Ultra'
};

export const providerLabel = (provider: string): string => PROVIDER_LABELS[provider] || provider;
export const effortLabel = (effort: string | null | undefined): string => (effort ? EFFORT_LABELS[effort] || effort : '');

export const unavailableReason = (model: AiModelPublic): string | null => {
	if (model.enabled === false) return 'disabled by an admin';
	if (model.available === false) return `needs ${providerLabel(model.provider)} key`;
	return null;
};

export const describeModelChoice = (
	models: Array<{ id: string; label: string }>,
	value: LopuChatSettings,
	connection?: LopuVaultProviderPublic | null
): string => {
	const model = value.model ? models.find((entry) => entry.id === value.model) : null;
	if (!value.model) return connection ? `${connection.name} · Auto` : models.length ? 'No model' : 'Auto';
	const bits = [connection?.name, model?.label || value.model].filter(Boolean) as string[];
	if (value.effort) bits.push(effortLabel(value.effort));
	return `${bits.join(' · ')}${value.speed === 'fast' ? ' ⚡' : ''}`;
};

const effortFor = (model: { efforts: string[] }, current: string | null, preferred: string | null): string | null => {
	const efforts = Array.isArray(model.efforts) ? model.efforts : [];
	if (!efforts.length) return null;
	for (const candidate of [current, preferred, 'high']) if (candidate && efforts.includes(candidate)) return candidate;
	return efforts[efforts.length - 1] ?? null;
};

export type LopuModelPickerProps = {
	models: AiModelPublic[];
	vaultProviders?: LopuVaultProviderPublic[];
	providerTemplates?: LopuProviderTemplatePublic[];
	value: LopuChatSettings;
	defaults?: LopuChatSettings | null;
	onChange: (patch: Partial<LopuChatSettings>) => void;
	compact?: boolean;
	disabled?: boolean;
};

export const LopuModelPicker = ({
	models,
	vaultProviders = [],
	providerTemplates = [],
	value,
	defaults,
	onChange,
	compact = false,
	disabled = false
}: LopuModelPickerProps) => {
	const connection = value.providerId ? vaultProviders.find((entry) => entry.id === value.providerId) ?? null : null;
	const template = connection ? providerTemplates.find((entry) => entry.id === connection.provider) ?? null : null;
	const selectableModels = connection ? template?.models || [] : models;
	const current = value.model ? selectableModels.find((model) => model.id === value.model) ?? null : null;
	const custom = !!connection && !!value.model && !current;
	const efforts =
		current && Array.isArray(current.efforts) ? current.efforts : custom ? ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] : [];
	const speeds = current && Array.isArray(current.speeds) ? current.speeds : custom ? ['normal', 'fast'] : [];
	const offersFast = speeds.includes('fast');
	const summary = describeModelChoice(selectableModels, value, connection);

	const selectConnection = (providerId: string) => {
		if (!providerId) {
			const first = models.find((model) => model.available !== false && model.enabled !== false) || null;
			onChange({
				providerId: null,
				model: defaults?.model || first?.id || null,
				effort: first ? effortFor(first, null, defaults?.effort ?? null) : null,
				speed: 'normal'
			});
			return;
		}
		const nextConnection = vaultProviders.find((entry) => entry.id === providerId);
		const nextTemplate = nextConnection ? providerTemplates.find((entry) => entry.id === nextConnection.provider) : null;
		const first = nextTemplate?.models[0] || null;
		onChange({ providerId, model: first?.id || null, effort: first ? effortFor(first, null, null) : null, speed: 'normal' });
	};

	const selectModel = (modelId: string) => {
		if (modelId === CUSTOM_MODEL) {
			onChange({ model: '', effort: null, speed: 'normal' });
			return;
		}
		const model = selectableModels.find((entry) => entry.id === modelId);
		if (!model) return;
		if ('available' in model && unavailableReason(model as AiModelPublic)) return;
		onChange({
			model: model.id,
			effort: effortFor(model, value.effort, defaults?.effort ?? null),
			speed: model.speeds.includes(value.speed || 'normal') ? value.speed || 'normal' : 'normal'
		});
	};

	return (
		<Popover placement="top-start" isLazy>
			<PopoverTrigger>
				<Button
					size="xs"
					variant="outline"
					height="26px"
					px={2}
					fontWeight={600}
					fontSize="11px"
					borderColor="var(--tt-border, #ececef)"
					color={INK}
					bg="var(--tt-card, #ffffff)"
					isDisabled={disabled}
					maxW={compact ? '190px' : '300px'}
					title="Choose this chat's provider, model, reasoning, and speed"
					aria-label={`AI selection: ${summary}`}
					_hover={{ borderColor: 'var(--tt-accent, #7c6cff)' }}
				>
					<Text as="span" isTruncated>
						🧠 {summary}
					</Text>
				</Button>
			</PopoverTrigger>
			<PopoverContent
				width="340px"
				maxW="calc(100vw - 24px)"
				borderRadius="14px"
				boxShadow="var(--tt-shadow-toast, 0 14px 38px rgba(20,20,40,0.18))"
				_focus={{ outline: 'none' }}
			>
				<PopoverBody p={3}>
					<Text fontSize="10px" fontFamily="var(--tt-font-mono, monospace)" letterSpacing="0.08em" textTransform="uppercase" color={MUTED} mb={1.5}>
						Provider connection
					</Text>
					<Select
						size="sm"
						value={value.providerId || ''}
						onChange={(event) => selectConnection(event.target.value)}
						aria-label="AI provider connection"
						mb={3}
					>
						<option value="">Thingtime managed</option>
						{vaultProviders.map((entry) => (
							<option key={entry.id} value={entry.id}>
								{entry.name} · {providerLabel(entry.provider)}
							</option>
						))}
					</Select>

					<Text fontSize="10px" fontFamily="var(--tt-font-mono, monospace)" letterSpacing="0.08em" textTransform="uppercase" color={MUTED} mb={1.5}>
						Model
					</Text>
					<Select
						size="sm"
						value={custom || (connection && !value.model) ? CUSTOM_MODEL : value.model || ''}
						onChange={(event) => selectModel(event.target.value)}
						aria-label="AI model"
						mb={custom || (connection && !value.model) ? 2 : 3}
					>
						{!connection ? <option value="">Catalog default</option> : null}
						{selectableModels.map((model) => {
							const reason = 'available' in model ? unavailableReason(model as AiModelPublic) : null;
							return (
								<option key={model.id} value={model.id} disabled={!!reason}>
									{model.label}
									{reason ? ` — ${reason}` : ''}
								</option>
							);
						})}
						{connection ? <option value={CUSTOM_MODEL}>Custom model ID…</option> : null}
					</Select>
					{connection && (custom || !value.model) ? (
						<Input
							size="sm"
							value={custom ? value.model || '' : ''}
							onChange={(event) => onChange({ model: event.target.value.slice(0, 200) })}
							placeholder="Provider model ID"
							aria-label="Custom model ID"
							mb={3}
						/>
					) : null}

					{efforts.length ? (
						<Box mb={offersFast ? 3 : 0}>
							<Text
								fontSize="10px"
								fontFamily="var(--tt-font-mono, monospace)"
								letterSpacing="0.08em"
								textTransform="uppercase"
								color={MUTED}
								mb={1.5}
							>
								Reasoning level
							</Text>
							<Select
								size="sm"
								value={value.effort || ''}
								onChange={(event) => onChange({ effort: event.target.value || null })}
								aria-label="Reasoning level"
							>
								<option value="">Provider default</option>
								{efforts.map((effort) => (
									<option key={effort} value={effort}>
										{effortLabel(effort)}
									</option>
								))}
							</Select>
						</Box>
					) : null}
					{offersFast ? (
						<Flex align="center" justify="space-between" gap={3}>
							<Box>
								<Text fontSize="xs" fontWeight={600} color={INK}>
									⚡ Fast mode
								</Text>
								<Text fontSize="10px" color={MUTED}>
									Use the provider's faster service tier when available.
								</Text>
							</Box>
							<Switch
								size="sm"
								isChecked={value.speed === 'fast'}
								onChange={(event) => onChange({ speed: event.target.checked ? 'fast' : 'normal' })}
								aria-label="Fast mode"
							/>
						</Flex>
					) : null}
					{!vaultProviders.length ? (
						<Text fontSize="10px" color={MUTED} mt={3}>
							Add your own encrypted provider token in Settings → Secure Vault.
						</Text>
					) : null}
				</PopoverBody>
			</PopoverContent>
		</Popover>
	);
};
