import React from 'react';
import { Box, Button, Flex, Popover, PopoverBody, PopoverContent, PopoverTrigger, Switch, Text } from '@chakra-ui/react';

import type { AiModelPublic, LopuChatSettings } from './lopuChatStore';

// The composer's model chip (design note §3.2): model → the efforts THAT
// model offers → a speed toggle only when the model offers 'fast'. Unavailable
// models stay visible but disabled with the reason ("needs Anthropic key" /
// "disabled by an admin"), so the viewer learns what an admin has to add.
// Uncontrolled Popover on purpose: a controlled trigger re-runs onToggle
// after our onClick and closes on the same click.

const MUTED = 'var(--tt-muted, #9a9aa6)';
const INK = 'var(--tt-ink, #16161a)';

const PROVIDER_LABELS: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI' };
const EFFORT_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };

export const providerLabel = (provider: string): string => PROVIDER_LABELS[provider] || provider;
export const effortLabel = (effort: string | null | undefined): string => (effort ? EFFORT_LABELS[effort] || effort : '');

export const unavailableReason = (model: AiModelPublic): string | null => {
	if (model.enabled === false) return 'disabled by an admin';
	if (model.available === false) return `needs ${providerLabel(model.provider)} key`;
	return null;
};

export const describeModelChoice = (models: AiModelPublic[], value: LopuChatSettings): string => {
	const model = value.model ? models.find((entry) => entry.id === value.model) : null;
	if (!value.model) return models.length ? 'No model' : 'Auto';
	const bits = [model?.label || value.model];
	if (value.effort) bits.push(effortLabel(value.effort));
	return `${bits.join(' · ')}${value.speed === 'fast' ? ' ⚡' : ''}`;
};

// the effort a freshly picked model starts on: keep the current one when
// offered, else the catalog default, else 'high', else the deepest tier
const effortFor = (model: AiModelPublic, current: string | null, preferred: string | null): string | null => {
	const efforts = Array.isArray(model.efforts) ? model.efforts : [];
	if (!efforts.length) return null;
	for (const candidate of [current, preferred, 'high']) if (candidate && efforts.includes(candidate)) return candidate;
	return efforts[efforts.length - 1] ?? null;
};

export type LopuModelPickerProps = {
	models: AiModelPublic[];
	value: LopuChatSettings;
	defaults?: LopuChatSettings | null;
	onChange: (patch: Partial<LopuChatSettings>) => void;
	compact?: boolean;
	disabled?: boolean;
};

export const LopuModelPicker = ({ models, value, defaults, onChange, compact = false, disabled = false }: LopuModelPickerProps) => {
	const current = value.model ? models.find((model) => model.id === value.model) ?? null : null;
	const efforts = current && Array.isArray(current.efforts) ? current.efforts : [];
	const offersFast = !!current && Array.isArray(current.speeds) && current.speeds.includes('fast');
	const summary = describeModelChoice(models, value);
	const grouped = React.useMemo(() => {
		const byProvider = new Map<string, AiModelPublic[]>();
		for (const model of models) {
			const list = byProvider.get(model.provider) || [];
			list.push(model);
			byProvider.set(model.provider, list);
		}
		return [...byProvider.entries()];
	}, [models]);

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
					maxW={compact ? '180px' : '260px'}
					title="Choose the model Lopu thinks with"
					aria-label={`Model: ${summary}`}
					_hover={{ borderColor: 'var(--tt-accent, #7c6cff)' }}
				>
					<Text as="span" isTruncated>
						🧠 {summary}
					</Text>
				</Button>
			</PopoverTrigger>
			<PopoverContent width="300px" maxW="calc(100vw - 24px)" borderRadius="14px" boxShadow="var(--tt-shadow-toast, 0 14px 38px rgba(20,20,40,0.18))" _focus={{ outline: 'none' }}>
				<PopoverBody p={3}>
					<Text fontSize="10px" fontFamily="var(--tt-font-mono, monospace)" letterSpacing="0.08em" textTransform="uppercase" color={MUTED} mb={1.5}>
						Model
					</Text>
					{models.length === 0 ? (
						<Text fontSize="xs" color={MUTED} mb={2}>
							No models in the catalog yet — Lopu answers from her little book until an admin adds a provider key.
						</Text>
					) : null}
					<Flex direction="column" gap={2} mb={efforts.length || offersFast ? 3 : 0}>
						{grouped.map(([provider, list]) => (
							<Box key={provider}>
								<Text fontSize="10px" color={MUTED} mb={1}>
									{providerLabel(provider)}
								</Text>
								<Flex direction="column" gap={1}>
									{list.map((model) => {
										const reason = unavailableReason(model);
										const selected = model.id === value.model;
										return (
											<Button
												key={model.id}
												size="xs"
												variant={selected ? 'solid' : 'ghost'}
												justifyContent="space-between"
												height="28px"
												px={2}
												fontWeight={selected ? 700 : 500}
												bg={selected ? 'var(--tt-accent, #7c6cff)' : undefined}
												color={selected ? 'var(--tt-accent-contrast, #ffffff)' : INK}
												isDisabled={!!reason}
												title={reason || model.id}
												onClick={() => {
													if (reason) return;
													onChange({
														model: model.id,
														effort: effortFor(model, value.effort, defaults?.effort ?? null),
														speed: Array.isArray(model.speeds) && value.speed && model.speeds.includes(value.speed) ? value.speed : 'normal'
													});
												}}
												_hover={selected ? { opacity: 0.92 } : { bg: 'var(--tt-surface-alt, #f5f5f7)' }}
											>
												<Text as="span" isTruncated>
													{model.label}
													{model.isDefault ? ' · default' : ''}
												</Text>
												{reason ? (
													<Text as="span" fontSize="10px" color={MUTED} ml={2} flexShrink={0}>
														{reason}
													</Text>
												) : null}
											</Button>
										);
									})}
								</Flex>
							</Box>
						))}
					</Flex>
					{efforts.length ? (
						<Box mb={offersFast ? 3 : 0}>
							<Text fontSize="10px" fontFamily="var(--tt-font-mono, monospace)" letterSpacing="0.08em" textTransform="uppercase" color={MUTED} mb={1.5}>
								Reasoning effort
							</Text>
							<Flex gap={1} wrap="wrap">
								{efforts.map((effort) => {
									const selected = effort === value.effort;
									return (
										<Button
											key={effort}
											size="xs"
											height="24px"
											px={2}
											variant={selected ? 'solid' : 'outline'}
											bg={selected ? 'var(--tt-accent, #7c6cff)' : 'var(--tt-card, #ffffff)'}
											color={selected ? 'var(--tt-accent-contrast, #ffffff)' : INK}
											borderColor="var(--tt-border, #ececef)"
											onClick={() => onChange({ effort })}
										>
											{effortLabel(effort)}
										</Button>
									);
								})}
							</Flex>
						</Box>
					) : null}
					{offersFast ? (
						<Flex align="center" justify="space-between" gap={3}>
							<Box>
								<Text fontSize="xs" fontWeight={600} color={INK}>
									⚡ Fast mode
								</Text>
								<Text fontSize="10px" color={MUTED}>
									Quicker replies, same model.
								</Text>
							</Box>
							<Switch size="sm" isChecked={value.speed === 'fast'} onChange={(event) => onChange({ speed: event.target.checked ? 'fast' : 'normal' })} aria-label="Fast mode" />
						</Flex>
					) : null}
				</PopoverBody>
			</PopoverContent>
		</Popover>
	);
};
