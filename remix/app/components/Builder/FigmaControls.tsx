import React from 'react';
import { Box, Flex, Input, Select, Text } from '@chakra-ui/react';

import { BORDER_STYLES, collapseShorthand, expandShorthand, parseBorder, parseShadow, tokenizeCssValue } from './figmaControlValues';

// Figma-parity property controls for the block inspector. Every control edits
// ONE css shorthand value (padding, margin, border-radius, border,
// box-shadow, …) so the storage model stays the bounded per-block css record:
// uniform mode writes one token, axes mode writes the two-token shorthand,
// independent mode writes all four — exactly how Figma's linked/expanded
// padding and corner controls behave.

const inputStyles = {
	size: 'sm' as const,
	border: '1px solid',
	borderColor: 'var(--tt-border, #ececef)',
	borderRadius: 'var(--tt-radius-sm, 9px)',
	background: 'var(--tt-card, #ffffff)',
	_placeholder: { color: 'var(--tt-faint, #b6b6c0)' }
};

const MICRO_LABEL = {
	color: 'var(--tt-faint, #b6b6c0)',
	fontSize: '9px',
	fontWeight: 700,
	letterSpacing: '0.08em',
	textTransform: 'uppercase' as const,
	lineHeight: '1.2'
};

const ModeButton = ({
	active,
	title,
	onClick,
	children,
	testId
}: {
	active: boolean;
	title: string;
	onClick: () => void;
	children: React.ReactNode;
	testId?: string;
}) => (
	<Box
		as="button"
		type="button"
		title={title}
		aria-label={title}
		aria-pressed={active}
		data-testid={testId}
		fontSize="11px"
		lineHeight="1"
		paddingX="6px"
		paddingY="4px"
		borderRadius="var(--tt-radius-xs, 7px)"
		border="1px solid"
		borderColor={active ? 'var(--tt-muted, #9a9aa6)' : 'transparent'}
		background={active ? 'var(--tt-surface, #fafafb)' : 'transparent'}
		color={active ? 'var(--tt-ink, #16161a)' : 'var(--tt-faint, #b6b6c0)'}
		cursor="pointer"
		_hover={{ color: 'var(--tt-ink, #16161a)' }}
		onClick={onClick}
	>
		{children}
	</Box>
);

const LabelledInput = ({
	micro,
	value,
	onChange,
	placeholder,
	testId
}: {
	micro: string;
	value: string;
	onChange: (next: string) => void;
	placeholder?: string;
	testId?: string;
}) => (
	<Flex flexDirection="column" rowGap="2px" flex="1 1 0" minWidth="52px">
		<Text {...MICRO_LABEL}>{micro}</Text>
		<Input {...inputStyles} value={value} placeholder={placeholder || '0'} onChange={(event) => onChange(event.target.value)} data-testid={testId} />
	</Flex>
);

export { collapseShorthand, expandShorthand, parseBorder, parseShadow };

type SidesMode = 'all' | 'axes' | 'sides';

const modeOf = (value?: string): SidesMode => {
	const parts = tokenizeCssValue(value);
	if (parts.length <= 1) return 'all';
	if (parts.length === 2) return 'axes';
	return 'sides';
};

// Padding/margin: uniform ▢ · linked axes ⬍⬌ (top/bottom + left/right) ·
// independent sides ⛶ — Figma's link/expand semantics on the css shorthand.
export const SidesControl = ({
	label,
	value,
	onChange,
	testIdPrefix
}: {
	label: string;
	value?: string;
	onChange: (next: string) => void;
	testIdPrefix: string;
}) => {
	const [mode, setMode] = React.useState<SidesMode>(() => modeOf(value));
	const [top, right, bottom, left] = expandShorthand(value);

	const write = (t: string, r: string, b: string, l: string) => onChange(collapseShorthand(t, r, b, l));

	const switchMode = (next: SidesMode) => {
		setMode(next);
		if (!value?.trim()) return;
		if (next === 'all') onChange(top.trim() || '0');
		else if (next === 'axes') onChange(`${top.trim() || '0'} ${right.trim() || '0'}`);
		// 'sides' keeps the current expansion — collapse happens on edits
	};

	return (
		<Flex flexDirection="column" rowGap={1}>
			<Flex alignItems="center" justifyContent="space-between">
				<Text {...MICRO_LABEL} fontSize="10px">
					{label}
				</Text>
				<Flex columnGap="2px">
					<ModeButton active={mode === 'all'} title={`${label}: one value for every side`} onClick={() => switchMode('all')} testId={`${testIdPrefix}-mode-all`}>
						▢
					</ModeButton>
					<ModeButton active={mode === 'axes'} title={`${label}: vertical + horizontal`} onClick={() => switchMode('axes')} testId={`${testIdPrefix}-mode-axes`}>
						⬍⬌
					</ModeButton>
					<ModeButton active={mode === 'sides'} title={`${label}: each side on its own`} onClick={() => switchMode('sides')} testId={`${testIdPrefix}-mode-sides`}>
						⛶
					</ModeButton>
				</Flex>
			</Flex>
			{mode === 'all' ? (
				<Input
					{...inputStyles}
					value={value || ''}
					placeholder="0"
					onChange={(event) => onChange(event.target.value)}
					data-testid={`${testIdPrefix}-all`}
				/>
			) : mode === 'axes' ? (
				<Flex columnGap={2}>
					<LabelledInput micro="Vertical" value={top} onChange={(v) => write(v, right, v, right)} testId={`${testIdPrefix}-v`} />
					<LabelledInput micro="Horizontal" value={right} onChange={(h) => write(top, h, top, h)} testId={`${testIdPrefix}-h`} />
				</Flex>
			) : (
				<Flex columnGap={2}>
					<LabelledInput micro="Top" value={top} onChange={(v) => write(v, right, bottom, left)} testId={`${testIdPrefix}-top`} />
					<LabelledInput micro="Right" value={right} onChange={(v) => write(top, v, bottom, left)} testId={`${testIdPrefix}-right`} />
					<LabelledInput micro="Bottom" value={bottom} onChange={(v) => write(top, right, v, left)} testId={`${testIdPrefix}-bottom`} />
					<LabelledInput micro="Left" value={left} onChange={(v) => write(top, right, bottom, v)} testId={`${testIdPrefix}-left`} />
				</Flex>
			)}
		</Flex>
	);
};

// Corner radius: uniform ▢ · independent corners ⛶ (TL/TR/BR/BL).
export const CornersControl = ({
	label,
	value,
	onChange,
	testIdPrefix
}: {
	label: string;
	value?: string;
	onChange: (next: string) => void;
	testIdPrefix: string;
}) => {
	const [independent, setIndependent] = React.useState(() => tokenizeCssValue(value).length > 1);
	const [tl, tr, br, bl] = expandShorthand(value);
	const write = (a: string, b: string, c: string, d: string) => onChange(collapseShorthand(a, b, c, d));
	return (
		<Flex flexDirection="column" rowGap={1}>
			<Flex alignItems="center" justifyContent="space-between">
				<Text {...MICRO_LABEL} fontSize="10px">
					{label}
				</Text>
				<Flex columnGap="2px">
					<ModeButton active={!independent} title="One radius for every corner" onClick={() => { setIndependent(false); if (value?.trim()) onChange(tl.trim() || '0'); }} testId={`${testIdPrefix}-mode-all`}>
						▢
					</ModeButton>
					<ModeButton active={independent} title="Each corner on its own" onClick={() => setIndependent(true)} testId={`${testIdPrefix}-mode-corners`}>
						⛶
					</ModeButton>
				</Flex>
			</Flex>
			{!independent ? (
				<Input
					{...inputStyles}
					value={value || ''}
					placeholder="0"
					onChange={(event) => onChange(event.target.value)}
					data-testid={`${testIdPrefix}-all`}
				/>
			) : (
				<Flex columnGap={2}>
					<LabelledInput micro="TL" value={tl} onChange={(v) => write(v, tr, br, bl)} testId={`${testIdPrefix}-tl`} />
					<LabelledInput micro="TR" value={tr} onChange={(v) => write(tl, v, br, bl)} testId={`${testIdPrefix}-tr`} />
					<LabelledInput micro="BR" value={br} onChange={(v) => write(tl, tr, v, bl)} testId={`${testIdPrefix}-br`} />
					<LabelledInput micro="BL" value={bl} onChange={(v) => write(tl, tr, br, v)} testId={`${testIdPrefix}-bl`} />
				</Flex>
			)}
		</Flex>
	);
};

// Border: width + style + color composing the `border` shorthand.
export const BorderControl = ({
	value,
	onChange,
	testIdPrefix
}: {
	value?: string;
	onChange: (next: string) => void;
	testIdPrefix: string;
}) => {
	const { width, style, color } = parseBorder(value);
	const write = (w: string, s: string, c: string) => {
		if (!s || s === 'none') {
			onChange('');
			return;
		}
		onChange([w.trim() || '1px', s, c.trim() || 'var(--tt-border, #ececef)'].join(' '));
	};
	return (
		<Flex flexDirection="column" rowGap={1}>
			<Text {...MICRO_LABEL} fontSize="10px">
				Border
			</Text>
			<Flex columnGap={2}>
				<Flex flexDirection="column" rowGap="2px" flex="0 0 30%" minWidth="56px">
					<Text {...MICRO_LABEL}>Style</Text>
					<Select {...inputStyles} value={style} onChange={(event) => write(width, event.target.value, color)} data-testid={`${testIdPrefix}-style`}>
						<option value="">none</option>
						{BORDER_STYLES.filter(Boolean).map((option) => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</Select>
				</Flex>
				<LabelledInput micro="Width" value={width} onChange={(v) => write(v, style || 'solid', color)} placeholder="1px" testId={`${testIdPrefix}-width`} />
				<LabelledInput micro="Color" value={color} onChange={(v) => write(width, style || 'solid', v)} placeholder="#ececef" testId={`${testIdPrefix}-color`} />
			</Flex>
		</Flex>
	);
};

// Drop shadow: X / Y / Blur / Spread / Color composing `box-shadow` —
// Figma's effect panel, one shadow deep (stacked shadows stay expressible in
// the Custom CSS editor).
export const ShadowControl = ({
	value,
	onChange,
	testIdPrefix
}: {
	value?: string;
	onChange: (next: string) => void;
	testIdPrefix: string;
}) => {
	const { x, y, blur, spread, color } = parseShadow(value);
	const write = (nx: string, ny: string, nb: string, ns: string, nc: string) => {
		if (!nx.trim() && !ny.trim() && !nb.trim() && !ns.trim() && !nc.trim()) {
			onChange('');
			return;
		}
		onChange(
			[nx.trim() || '0', ny.trim() || '0', nb.trim() || '0', ns.trim() || '0', nc.trim() || 'rgba(0, 0, 0, 0.12)'].join(' ')
		);
	};
	return (
		<Flex flexDirection="column" rowGap={1}>
			<Text {...MICRO_LABEL} fontSize="10px">
				Shadow
			</Text>
			<Flex columnGap={2}>
				<LabelledInput micro="X" value={x} onChange={(v) => write(v, y, blur, spread, color)} testId={`${testIdPrefix}-x`} />
				<LabelledInput micro="Y" value={y} onChange={(v) => write(x, v, blur, spread, color)} testId={`${testIdPrefix}-y`} />
				<LabelledInput micro="Blur" value={blur} onChange={(v) => write(x, y, v, spread, color)} testId={`${testIdPrefix}-blur`} />
				<LabelledInput micro="Spread" value={spread} onChange={(v) => write(x, y, blur, v, color)} testId={`${testIdPrefix}-spread`} />
			</Flex>
			<LabelledInput micro="Color" value={color} onChange={(v) => write(x, y, blur, spread, v)} placeholder="rgba(0, 0, 0, 0.12)" testId={`${testIdPrefix}-shadow-color`} />
		</Flex>
	);
};

// A Figma-style segmented icon row (text align, block align, …).
export const SegmentedControl = ({
	label,
	options,
	value,
	onChange,
	testIdPrefix
}: {
	label: string;
	options: Array<{ value: string; label: string; title: string }>;
	value: string;
	onChange: (next: string) => void;
	testIdPrefix: string;
}) => (
	<Flex flexDirection="column" rowGap={1}>
		<Text {...MICRO_LABEL} fontSize="10px">
			{label}
		</Text>
		<Flex
			border="1px solid"
			borderColor="var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-sm, 9px)"
			overflow="hidden"
			width="fit-content"
		>
			{options.map((option) => {
				const active = value === option.value;
				return (
					<Box
						key={option.value || 'unset'}
						as="button"
						type="button"
						title={option.title}
						aria-label={option.title}
						aria-pressed={active}
						data-testid={`${testIdPrefix}-${option.value || 'unset'}`}
						fontSize="12px"
						lineHeight="1"
						paddingX="10px"
						paddingY="6px"
						background={active ? 'var(--tt-surface-hover, #ececee)' : 'var(--tt-card, #ffffff)'}
						color={active ? 'var(--tt-ink, #16161a)' : 'var(--tt-muted, #9a9aa6)'}
						cursor="pointer"
						_hover={{ color: 'var(--tt-ink, #16161a)' }}
						onClick={() => onChange(active ? '' : option.value)}
					>
						{option.label}
					</Box>
				);
			})}
		</Flex>
	</Flex>
);
