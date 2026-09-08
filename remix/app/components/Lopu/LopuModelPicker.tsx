import React from 'react';
import { Box, Flex, Popover, PopoverBody, PopoverContent, PopoverTrigger, Select, Switch, Text } from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router';
import { Check, ChevronDown } from 'lucide-react';

import { getLopuStoreServerSnapshot, getLopuStoreSnapshot, subscribeLopuStore, type LopuChatDefaults, type LopuChatSettings } from './lopuChatStore';
import {
	buildLopuProviderGroups,
	describeLopuChoice,
	effortLabel,
	findLopuProviderOption,
	lopuProviderChoiceKey,
	modelUnavailableReason,
	parseLopuProviderChoiceKey,
	providerKeyLabel,
	type AiModelPublic,
	type LopuProviderChoice,
	type LopuProviderOption,
	type LopuVaultInfo,
	type LopuVaultProvider
} from './lopuProviderCore';
import { LOPU_UI, lopuChipSx, lopuEyebrowSx, lopuFocusRingSx, lopuPopoverSx } from './lopuTheme';

// The composer's model chip and its picker popover (design brief): server
// models grouped by provider family (Claude / OpenAI), then "Your providers"
// from the viewer's Secure Vault; a per-model effort segmented control; the
// speed toggle only when the model offers a fast lane; unavailable entries
// stay listed but disabled with the reason; a footer link to manage vault
// providers. Uncontrolled Popover on purpose (a controlled trigger re-runs
// onToggle after our onClick and closes on the same click) — the render
// prop hands us onClose for the footer link.
//
// `LopuProviderSelect` is the same choice as ONE native <select> for
// settings rows and the voice page (W2): value in, { model, providerId } out.

export const LOPU_MANAGE_PROVIDERS_PATH = '/settings#secure-vault';

// compatibility names used elsewhere in the Lopu family
export { effortLabel };
export const providerLabel = providerKeyLabel;
export const unavailableReason = modelUnavailableReason;
export const describeModelChoice = (models: AiModelPublic[], value: Pick<LopuChatSettings, 'model' | 'effort' | 'speed'> & { providerId?: string | null }): string =>
	describeLopuChoice(models, null, value);

// the effort a freshly picked model starts on: keep the current one when
// offered, else the catalog default, else 'high', else the deepest tier
const effortFor = (model: AiModelPublic | null, current: string | null, preferred: string | null): string | null => {
	const efforts = model && Array.isArray(model.efforts) ? model.efforts : [];
	if (!efforts.length) return null;
	for (const candidate of [current, preferred, 'high']) if (candidate && efforts.includes(candidate)) return candidate;
	return efforts[efforts.length - 1] ?? null;
};

// An ink-on-hairline switch (Chakra's default track is a brand blue — Lopu
// keeps colour for the rainbow only).
export const LopuToggle = ({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) => (
	<Switch
		size="sm"
		isChecked={checked}
		isDisabled={disabled}
		aria-label={label}
		onChange={(event) => onChange(event.target.checked)}
		sx={{
			'.chakra-switch__track': { bg: LOPU_UI.faint, boxShadow: 'none' },
			'.chakra-switch__track[data-checked]': { bg: LOPU_UI.ink },
			'.chakra-switch__track[data-focus-visible]': { outline: '2px solid var(--tt-ink, #18181b)', outlineOffset: '2px' },
			'.chakra-switch__thumb': { bg: LOPU_UI.card }
		}}
	/>
);

// A hairline segmented control (effort tiers). Wraps onto a second row when
// a model offers more tiers than one row fits (OpenAI's seven) — every label
// stays whole, nothing truncates.
export const LopuSegmented = ({
	options,
	value,
	onChange,
	label
}: {
	options: { value: string; label: string }[];
	value: string | null;
	onChange: (value: string) => void;
	label: string;
}) => (
	<Flex role="radiogroup" aria-label={label} bg={LOPU_UI.surfaceAlt} border={LOPU_UI.border} borderRadius="15px" p="2px" gap="2px" flexWrap="wrap">
		{options.map((option) => {
			const selected = option.value === value;
			return (
				<Box
					as="button"
					type="button"
					key={option.value}
					role="radio"
					aria-checked={selected}
					flex="1 1 auto"
					minW="fit-content"
					height="26px"
					px={2.5}
					borderRadius={LOPU_UI.pill}
					border={selected ? LOPU_UI.border : '1px solid transparent'}
					bg={selected ? LOPU_UI.card : 'transparent'}
					color={selected ? LOPU_UI.ink : LOPU_UI.muted}
					fontSize={LOPU_UI.fontSmall}
					fontWeight={600}
					lineHeight={1}
					whiteSpace="nowrap"
					cursor="pointer"
					transition={`background ${LOPU_UI.transitionFast}, color ${LOPU_UI.transitionFast}`}
					_hover={selected ? undefined : { color: LOPU_UI.ink }}
					sx={lopuFocusRingSx}
					onClick={() => onChange(option.value)}
				>
					{option.label}
				</Box>
			);
		})}
	</Flex>
);

const OptionRow = ({ option, selected, compact, onPick }: { option: LopuProviderOption; selected: boolean; compact: boolean; onPick: (option: LopuProviderOption) => void }) => {
	const rowRef = React.useRef<HTMLButtonElement | null>(null);
	// the list is long (two families + the vault): open on the current choice
	React.useEffect(() => {
		if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' });
	}, [selected]);
	return (
	<Box
		ref={rowRef}
		as="button"
		type="button"
		role="option"
		aria-selected={selected}
		aria-disabled={option.disabled || undefined}
		disabled={option.disabled}
		title={option.reason || option.hint || option.model || undefined}
		display="flex"
		alignItems="center"
		gap={2}
		width="100%"
		textAlign="left"
		minH={compact ? '32px' : '36px'}
		px={2.5}
		py={1}
		borderRadius={LOPU_UI.radiusSm}
		bg={selected ? LOPU_UI.surfaceAlt : 'transparent'}
		color={LOPU_UI.ink}
		cursor={option.disabled ? 'not-allowed' : 'pointer'}
		opacity={option.disabled ? 0.5 : 1}
		transition={`background ${LOPU_UI.transitionFast}`}
		_hover={option.disabled ? undefined : { bg: LOPU_UI.surfaceHover }}
		sx={lopuFocusRingSx}
		onClick={() => {
			if (!option.disabled) onPick(option);
		}}
	>
		<Box minW={0} flex={1}>
			<Text as="span" display="block" fontSize={compact ? LOPU_UI.fontCompact : LOPU_UI.fontBody} fontWeight={selected ? 700 : 500} lineHeight="1.3" isTruncated>
				{option.label}
				{option.isDefault ? (
					<Text as="span" color={LOPU_UI.muted} fontWeight={500}>
						{' '}
						· default
					</Text>
				) : null}
			</Text>
			{option.reason || option.hint ? (
				<Text as="span" display="block" fontSize="11px" color={LOPU_UI.muted} lineHeight="1.3" isTruncated>
					{option.reason || option.hint}
				</Text>
			) : null}
		</Box>
		{selected ? (
			<Box as="span" display="inline-flex" color={LOPU_UI.ink} flexShrink={0} aria-hidden="true">
				<Check size={14} strokeWidth={2.4} />
			</Box>
		) : null}
	</Box>
	);
};

export type LopuModelPickerProps = {
	models: AiModelPublic[];
	vaultProviders?: LopuVaultProvider[] | null;
	vault?: LopuVaultInfo | null;
	value: LopuChatSettings;
	defaults?: LopuChatDefaults | null;
	onChange: (patch: Partial<LopuChatSettings>) => void;
	compact?: boolean;
	disabled?: boolean;
	// mobile: the chip keeps its visual height but grows a 44px hit area
	mobile?: boolean;
};

export const LopuModelPicker = ({ models, vaultProviders, vault, value, defaults, onChange, compact = false, disabled = false, mobile = false }: LopuModelPickerProps) => {
	const groups = React.useMemo(() => buildLopuProviderGroups(models, vaultProviders), [models, vaultProviders]);
	const current = value.providerId ? null : value.model ? models.find((model) => model.id === value.model) ?? null : null;
	const efforts = current && Array.isArray(current.efforts) ? current.efforts : [];
	const offersFast = !!current && Array.isArray(current.speeds) && current.speeds.includes('fast');
	const summary = describeLopuChoice(models, vaultProviders, value);
	const selectedKey = lopuProviderChoiceKey(value);

	const pick = (option: LopuProviderOption) => {
		if (option.kind === 'vault') {
			onChange({ providerId: option.providerId });
			return;
		}
		const model = option.catalog;
		onChange({
			providerId: null,
			model: option.model,
			effort: effortFor(model, value.effort, defaults?.effort ?? null),
			speed: model && Array.isArray(model.speeds) && value.speed && model.speeds.includes(value.speed) ? value.speed : 'normal'
		});
	};

	return (
		<Popover placement="top-start" isLazy strategy="fixed" gutter={8}>
			{({ onClose }) => (
				<>
					<PopoverTrigger>
						<Box
							as="button"
							type="button"
							className="lopuModelChip"
							data-lopu-control
							aria-haspopup="dialog"
							aria-label={`Model: ${summary}`}
							title="Choose what Lopu thinks with"
							disabled={disabled}
							sx={{
								...lopuChipSx,
								height: `${compact ? 26 : LOPU_UI.controlCompact}px`,
								maxWidth: compact ? '160px' : '240px',
								position: 'relative',
								...(mobile ? { _before: { content: '""', position: 'absolute', left: 0, right: 0, top: '-8px', bottom: '-8px' } } : {})
							}}
						>
							<Text as="span" isTruncated minW={0}>
								{summary}
							</Text>
							<ChevronDown size={12} strokeWidth={2.2} aria-hidden style={{ flexShrink: 0, opacity: 0.7 }} />
						</Box>
					</PopoverTrigger>
					<PopoverContent
						width="320px"
						maxW="calc(100vw - 24px)"
						sx={lopuPopoverSx}
						_focus={{ outline: 'none', boxShadow: LOPU_UI.shadowPopover }}
						_focusVisible={{ outline: 'none', boxShadow: LOPU_UI.shadowPopover }}
						aria-label="Choose what Lopu thinks with"
					>
						<PopoverBody p={0}>
							<Flex align="center" px={3} pt={2.5} pb={1}>
								<Text as="span" sx={lopuEyebrowSx}>
									Model
								</Text>
							</Flex>
							<Box maxH="272px" overflowY="auto" px={1.5} pb={1.5} role="listbox" aria-label="Models and providers">
								{groups.length === 0 ? (
									<Text fontSize={LOPU_UI.fontSmall} color={LOPU_UI.muted} px={2} py={2} lineHeight="1.5">
										No models in the catalog yet — Lopu answers from its little book until an admin adds a provider key.
									</Text>
								) : null}
								{groups.map((group) => (
									<Box key={group.id} role="group" aria-label={group.label} mb={1}>
										<Text as="span" display="block" sx={lopuEyebrowSx} px={2.5} pt={1.5} pb={1}>
											{group.label}
										</Text>
										{group.options.map((option) => (
											<OptionRow key={option.key} option={option} selected={option.key === selectedKey} compact={compact} onPick={pick} />
										))}
									</Box>
								))}
							</Box>
							{efforts.length ? (
								<Box borderTop={LOPU_UI.border} px={3} py={2.5}>
									<Text as="span" display="block" sx={lopuEyebrowSx} mb={1.5}>
										Effort
									</Text>
									<LopuSegmented label="Reasoning effort" options={efforts.map((effort) => ({ value: effort, label: effortLabel(effort) }))} value={value.effort} onChange={(effort) => onChange({ effort })} />
								</Box>
							) : null}
							{offersFast ? (
								<Flex borderTop={LOPU_UI.border} px={3} py={2.5} align="center" justify="space-between" gap={3}>
									<Box minW={0}>
										<Text fontSize={LOPU_UI.fontSmall} fontWeight={600} color={LOPU_UI.ink} lineHeight="1.3">
											Fast mode
										</Text>
										<Text fontSize="11px" color={LOPU_UI.muted} lineHeight="1.3">
											Quicker replies, same model.
										</Text>
									</Box>
									<LopuToggle checked={value.speed === 'fast'} onChange={(fast) => onChange({ speed: fast ? 'fast' : 'normal' })} label="Fast mode" />
								</Flex>
							) : null}
							<Flex borderTop={LOPU_UI.border} px={3} py={2} align="center" justify="space-between" gap={3}>
								<Box
									as={RouterLink}
									to={LOPU_MANAGE_PROVIDERS_PATH}
									fontSize={LOPU_UI.fontSmall}
									fontWeight={600}
									color={LOPU_UI.link}
									textDecoration="underline"
									textUnderlineOffset="2px"
									textDecorationColor={LOPU_UI.faint}
									_hover={{ textDecorationColor: LOPU_UI.ink }}
									sx={lopuFocusRingSx}
									onClick={onClose}
								>
									Manage your providers →
								</Box>
								{vault && !vault.configured ? (
									<Text fontSize="11px" color={LOPU_UI.muted} whiteSpace="nowrap">
										Vault not configured
									</Text>
								) : null}
							</Flex>
						</PopoverBody>
					</PopoverContent>
				</>
			)}
		</Popover>
	);
};

// ——— the single-control variant ————————————————————————————————————————

export type LopuProviderSelectChange = LopuProviderChoice & { key: string; option: LopuProviderOption | null };

export type LopuProviderSelectProps = {
	// a composite key ('model:<id>' / 'vault:<id>' / bare catalog id / '') or { model, providerId }
	value: string | Partial<LopuProviderChoice> | null | undefined;
	onChange: (choice: LopuProviderSelectChange) => void;
	compact?: boolean;
	// default to the shared chat store's catalog + vault list
	models?: AiModelPublic[];
	vaultProviders?: LopuVaultProvider[] | null;
	disabled?: boolean;
	'aria-label'?: string;
	// offer a leading entry (value '') that clears both model and providerId
	includeDefault?: boolean;
	defaultLabel?: string;
	// only the viewer's own providers (voice needs a vault provider)
	vaultOnly?: boolean;
	maxWidth?: string;
};

export const LopuProviderSelect = (props: LopuProviderSelectProps) => {
	const snapshot = React.useSyncExternalStore(subscribeLopuStore, getLopuStoreSnapshot, getLopuStoreServerSnapshot);
	const models = props.models ?? snapshot.models;
	const vaultProviders = props.vaultProviders ?? snapshot.vaultProviders;
	const groups = React.useMemo(() => buildLopuProviderGroups(props.vaultOnly ? [] : models, vaultProviders), [models, vaultProviders, props.vaultOnly]);
	const key = typeof props.value === 'string' ? lopuProviderChoiceKey(parseLopuProviderChoiceKey(props.value)) : lopuProviderChoiceKey(props.value);
	const includeDefault = props.includeDefault ?? true;
	return (
		<Select
			size={props.compact ? 'xs' : 'sm'}
			value={key}
			isDisabled={props.disabled}
			aria-label={props['aria-label'] || 'Model or provider'}
			maxW={props.maxWidth || '260px'}
			bg={LOPU_UI.card}
			color={LOPU_UI.ink}
			borderColor={LOPU_UI.borderColor}
			borderRadius={LOPU_UI.radiusSm}
			fontSize={props.compact ? LOPU_UI.fontSmall : LOPU_UI.fontCompact}
			_hover={{ borderColor: LOPU_UI.faint }}
			_focusVisible={{ borderColor: LOPU_UI.ink, boxShadow: 'none' }}
			onChange={(event) => {
				const nextKey = event.target.value;
				const parsed = parseLopuProviderChoiceKey(nextKey) ?? { model: null, providerId: null };
				props.onChange({ ...parsed, key: nextKey, option: findLopuProviderOption(groups, nextKey) });
			}}
		>
			{includeDefault ? <option value="">{props.defaultLabel || (props.vaultOnly ? 'Choose a provider' : 'Catalog default')}</option> : null}
			{groups.map((group) => (
				<optgroup key={group.id} label={group.label}>
					{group.options.map((option) => (
						<option key={option.key} value={option.key} disabled={option.disabled}>
							{option.label}
							{option.hint ? ` · ${option.hint}` : ''}
							{option.reason ? ` — ${option.reason}` : ''}
						</option>
					))}
				</optgroup>
			))}
		</Select>
	);
};
