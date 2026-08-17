import { Box, Button, Flex, Input, Text, Textarea } from '@chakra-ui/react';
import { Wand2 } from 'lucide-react';
import React from 'react';

import { useTtTheme } from '~/hooks/useTtTheme';
import { TT_CUSTOM_TARGETS } from '~/theme/customise';
import {
	sanitizePaddingCssValue,
	THINGS_BADGE_PADDING_PRESETS,
	type TtThingsBadgePadding
} from '~/theme/tokens';

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

export const isHexColor = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

/** Swatch + hex/text input pair used by the Theme Studio and settings modal. */
export const ColorControl = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
	<Flex alignItems="center" gap="8px">
		<Box
			position="relative"
			width="28px"
			height="28px"
			borderRadius="var(--tt-radius-xs, 7px)"
			overflow="hidden"
			border="1px solid var(--tt-border, #ececef)"
		>
			<Box position="absolute" inset={0} background={value} />
			<Input
				type="color"
				value={isHexColor(value) ? value : '#888888'}
				onChange={(e) => onChange(e.target.value)}
				position="absolute"
				inset={0}
				opacity={0}
				width="100%"
				height="100%"
				padding={0}
				cursor="pointer"
			/>
		</Box>
		<Input
			value={value}
			onChange={(e) => onChange(e.target.value)}
			width="130px"
			size="sm"
			fontFamily={MONO}
			fontSize="12px"
			background="var(--tt-surface-alt, #f5f5f7)"
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-sm, 9px)"
		/>
	</Flex>
);

const THINGS_BADGE_PADDING_OPTIONS: { value: TtThingsBadgePadding; label: string }[] = [
	{ value: 'small', label: 'Small' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'large', label: 'Large' },
	{ value: 'custom', label: 'Custom' }
];

/** Shared control used by Theme Studio and both quick-settings surfaces. */
export const ThingsBadgePaddingControl = ({
	value,
	customValue,
	onValueChange,
	onCustomValueChange
}: {
	value: TtThingsBadgePadding;
	customValue: string;
	onValueChange: (value: TtThingsBadgePadding) => void;
	onCustomValueChange: (value: string) => void;
}) => {
	const customValidation = sanitizePaddingCssValue(customValue);
	const customIsInvalid = value === 'custom' && customValidation === null;

	return (
		<Flex direction="column" alignItems="flex-end" gap="6px" maxWidth="100%">
			<Flex role="group" aria-label="Things badge padding" gap="2px" flexWrap="wrap" justifyContent="flex-end">
				{THINGS_BADGE_PADDING_OPTIONS.map((option) => (
					<Button
						key={option.value}
						type="button"
						size="xs"
						variant={value === option.value ? 'solid' : 'ghost'}
						aria-pressed={value === option.value}
						title={option.value === 'custom' ? 'Enter CSS padding shorthand' : THINGS_BADGE_PADDING_PRESETS[option.value]}
						onClick={() => onValueChange(option.value)}
					>
						{option.label}
					</Button>
				))}
			</Flex>
			{value === 'custom' ? (
				<Box width="100%" maxWidth="220px">
					<Input
						aria-label="Custom Things badge padding CSS"
						value={customValue}
						onChange={(event) => onCustomValueChange(event.target.value)}
						placeholder={THINGS_BADGE_PADDING_PRESETS.small}
						autoComplete="off"
						spellCheck={false}
						isInvalid={customIsInvalid}
						size="sm"
						fontFamily={MONO}
						fontSize="12px"
						background="var(--tt-card, #ffffff)"
						border="1px solid var(--tt-border, #ececef)"
						borderRadius="var(--tt-radius-sm, 9px)"
					/>
					<Text
						aria-live="polite"
						marginTop="3px"
						fontSize="10.5px"
						color={customIsInvalid ? 'var(--tt-danger, #d6455a)' : 'var(--tt-faint, #b6b6c0)'}
					>
						{customIsInvalid
							? 'Use 1–4 non-negative CSS lengths.'
							: customValue.trim()
								? 'CSS padding shorthand — applied live.'
								: `Empty uses Small (${THINGS_BADGE_PADDING_PRESETS.small}).`}
					</Text>
				</Box>
			) : null}
		</Flex>
	);
};

/** The little wand beside a theming option — toggles its customise panel. */
export const CustomiseToggle = ({ open, onToggle }: { open: boolean; onToggle: () => void }) => (
	<Flex
		as="button"
		type="button"
		aria-expanded={open}
		title="Customise — custom classes & CSS"
		alignItems="center"
		justifyContent="center"
		width="20px"
		height="20px"
		flexShrink={0}
		borderRadius="var(--tt-radius-xs, 7px)"
		color={open ? 'var(--tt-accent, hotpink)' : 'var(--tt-faint, #b6b6c0)'}
		background={open ? 'var(--tt-accent-tint, #fff5fa)' : 'transparent'}
		cursor="pointer"
		transition="background 0.15s ease, color 0.15s ease"
		_hover={{ color: 'var(--tt-accent, hotpink)', background: 'var(--tt-accent-tint, #fff5fa)' }}
		onClick={onToggle}
	>
		<Wand2 size={12} strokeWidth={2} />
	</Flex>
);

/**
 * The customise panel a theming option expands into: custom classes (element
 * options) + custom CSS scoped to the option's selector, applied live by
 * ThemeHost. Personal only — never saved into shareable themes.
 */
export const CustomisePanel = ({ targetKey }: { targetKey: string }) => {
	const target = TT_CUSTOM_TARGETS[targetKey];
	const { custom, setCustomEntry } = useTtTheme();

	const entry = custom?.[targetKey] || {};
	const isRoot = target?.selector === ':root';

	if (!target) {
		return null;
	}

	const hasContent = !!(entry.classes || entry.css);

	return (
		<Box
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-md, 12px)"
			background="var(--tt-surface, #fafafb)"
			padding="12px"
			marginBottom="10px"
		>
			<Flex alignItems="center" justifyContent="space-between" gap="8px" marginBottom="8px">
				<Text fontSize="12px" fontWeight={700} color="var(--tt-ink, #16161a)">
					Customise — {target.label}
				</Text>
				{hasContent ? (
					<Box
						as="button"
						type="button"
						fontSize="11px"
						fontWeight={600}
						color="var(--tt-danger, #d6455a)"
						cursor="pointer"
						onClick={() => setCustomEntry(targetKey, null)}
					>
						Clear
					</Box>
				) : null}
			</Flex>
			{target.classable ? (
				<Box marginBottom="8px">
					<Text fontSize="11px" fontWeight={600} color="var(--tt-muted, #9a9aa6)" marginBottom="3px">
						Custom classes — added to the element
					</Text>
					<Input
						value={entry.classes || ''}
						onChange={(e) => setCustomEntry(targetKey, { classes: e.target.value })}
						placeholder="my-class sparkle"
						size="sm"
						fontFamily={MONO}
						fontSize="12px"
						background="var(--tt-card, #ffffff)"
						border="1px solid var(--tt-border, #ececef)"
						borderRadius="var(--tt-radius-sm, 9px)"
					/>
				</Box>
			) : null}
			<Text fontSize="11px" fontWeight={600} color="var(--tt-muted, #9a9aa6)" marginBottom="3px">
				Custom CSS — applied to{' '}
				<Box as="span" fontFamily={MONO} color="var(--tt-ink, #16161a)">
					{target.selector}
				</Box>
			</Text>
			<Textarea
				value={entry.css || ''}
				onChange={(e) => setCustomEntry(targetKey, { css: e.target.value })}
				placeholder={
					isRoot
						? `${target.varName?.split('…')[0] || '--tt-accent'}: rebeccapurple;`
						: 'box-shadow: 0 0 0 2px var(--tt-ink);\ntransform: rotate(4deg);'
				}
				rows={3}
				size="sm"
				fontFamily={MONO}
				fontSize="12px"
				background="var(--tt-card, #ffffff)"
				border="1px solid var(--tt-border, #ececef)"
				borderRadius="var(--tt-radius-sm, 9px)"
				resize="vertical"
			/>
			<Text fontSize="10.5px" color="var(--tt-faint, #b6b6c0)" marginTop="6px">
				{isRoot
					? `Declarations only — set any --tt-* variable${target.varName ? ` (this option drives ${target.varName})` : ''}. Yours only; not part of shared themes.`
					: `Declarations only${target.varName ? ` — this option drives ${target.varName}` : ''}. Yours only; not part of shared themes.`}
			</Text>
		</Box>
	);
};
