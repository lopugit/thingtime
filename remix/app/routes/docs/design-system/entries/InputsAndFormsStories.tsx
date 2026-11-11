import React from 'react';
import { Box, Flex, Input, Select, Switch, Text, Textarea } from '@chakra-ui/react';

import { SettingRow, SettingsSection } from '~/components/Settings/SettingsSection';
import type { DesignSystemStory } from '../ThingContextMenuStories';

// Live stories for the Inputs & forms entry. Input/Select/Switch/Textarea are
// the REAL themed Chakra primitives — the provider overrides in
// Providers/Chakra/theme.tsx (focus-ring strip, Switch checked = rainbow-3,
// borderless Select) apply here exactly as in the app. SettingsSection and
// SettingRow are imported from the live /settings surface. All state is
// local; no fetches.

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

const GroupLabel = (props: { children: React.ReactNode }) => (
	<Text
		fontFamily={MONO}
		fontSize="10px"
		fontWeight={600}
		letterSpacing="0.14em"
		textTransform="uppercase"
		color="var(--tt-muted, #9a9aa6)"
		marginBottom="10px"
	>
		{props.children}
	</Text>
);

// The mono micro-label that sits above tokened form fields (routes/tests.tsx
// filter bar, admin panels): 10–11px, 600, tracked, uppercase, --tt-muted.
const MicroLabel = (props: { children: React.ReactNode }) => (
	<Text
		fontSize="11px"
		fontWeight={600}
		fontFamily={MONO}
		letterSpacing="0.12em"
		textTransform="uppercase"
		color="var(--tt-muted, #9a9aa6)"
		marginBottom={1}
	>
		{props.children}
	</Text>
);

// The tokened field recipe shared by admin / tests / builder surfaces:
// 1px --tt-border, radius --tt-radius-sm, card bg, accent focus border
// (TierManager INPUT_STYLES; BuilderDrawer inputStyles adds bg + size sm;
// tests.tsx applies border + radius inline).
const FIELD_RECIPE = {
	bg: 'var(--tt-card, #ffffff)',
	border: '1px solid',
	borderColor: 'var(--tt-border, #ececef)',
	borderRadius: 'var(--tt-radius-sm, 9px)',
	focusBorderColor: 'var(--tt-accent, hotpink)'
} as const;

const SettingsFormStory = () => {
	const [motion, setMotion] = React.useState(true);
	const [icons, setIcons] = React.useState('emoji');

	return (
		<Box maxWidth="560px">
			<SettingsSection eyebrow="appearance · example" description="The live /settings idiom: SettingsSection card + SettingRow rows, control on the right.">
				<SettingRow label="Motion" hint="Rainbow + decorative animation">
					<Switch isChecked={motion} onChange={(e) => setMotion(e.target.checked)}></Switch>
				</SettingRow>
				<SettingRow label="Icon style" hint="UI icon language for surfaces that support both">
					<Select size="sm" width="auto" value={icons} onChange={(e) => setIcons(e.target.value)}>
						<option value="emoji">Emoji</option>
						<option value="lucide">Lucide</option>
					</Select>
				</SettingRow>
				<SettingRow label="Two-factor codes" hint="Verify your email first — codes are delivered there">
					<Switch isChecked={false} isDisabled onChange={() => {}}></Switch>
				</SettingRow>
			</SettingsSection>
			<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)" marginTop="10px">
				Switch checked track = var(--tt-rainbow-3) · the settings Select keeps the theme’s borderless inline look
			</Text>
		</Box>
	);
};

const TokenedFieldsStory = () => {
	const [query, setQuery] = React.useState('');
	const [group, setGroup] = React.useState('all');
	const [payload, setPayload] = React.useState('{\n  "username": "sunflower",\n  "remember": true\n}');

	return (
		<Flex flexDirection="column" rowGap={5} maxWidth="560px">
			<Box>
				<MicroLabel>Search</MicroLabel>
				<Input {...FIELD_RECIPE} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="route, group, or test" />
			</Box>
			<Box>
				<MicroLabel>Group</MicroLabel>
				<Select {...FIELD_RECIPE} value={group} onChange={(e) => setGroup(e.target.value)}>
					<option value="all">All groups</option>
					<option value="auth">Auth</option>
					<option value="things">Things</option>
					<option value="themes">Themes</option>
				</Select>
			</Box>
			<Box>
				<MicroLabel>Request body</MicroLabel>
				<Textarea
					value={payload}
					onChange={(e) => setPayload(e.target.value)}
					spellCheck={false}
					fontFamily={MONO}
					fontSize="xs"
					minH="96px"
					resize="vertical"
					bg="var(--tt-surface-alt, #f5f5f7)"
					borderColor="var(--tt-border, #ececef)"
					borderRadius="var(--tt-radius-sm, 9px)"
					whiteSpace="pre"
					overflowX="auto"
				/>
				<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)" marginTop="6px">
					Code/payload textareas go mono on --tt-surface-alt (tests.tsx payload editor) — the inset wash marks
					machine text.
				</Text>
			</Box>
			<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
				Focus a field: the global theme strips Chakra’s blue ring, and the recipe answers with
				focusBorderColor var(--tt-accent) instead.
			</Text>
		</Flex>
	);
};

// The house number editor recipe — a faithful rendering of NumberValueInput
// (components/Thingtime/Thingtime.tsx): light rounded input sized to its
// content, − / + steppers, draft state so partial input ('-', '1.', '')
// doesn't fight the committed value, accent-tint focus halo. The real
// component lives in the Thingtime tree module (it ships with the whole
// editor stack, so this story re-renders the recipe instead of importing it).
const stepButtonStyles = {
	alignItems: 'center',
	justifyContent: 'center',
	width: '30px',
	height: '30px',
	border: '1px solid var(--tt-border, #ececef)',
	borderRadius: 'var(--tt-radius-sm, 9px)',
	background: 'var(--tt-card, #ffffff)',
	color: 'var(--tt-muted, #9a9aa6)',
	fontSize: '15px',
	lineHeight: 1,
	cursor: 'pointer',
	userSelect: 'none',
	transition: 'background 0.15s ease, color 0.15s ease, transform 0.1s ease',
	_hover: { background: 'var(--tt-surface-hover, #ececee)', color: 'var(--tt-ink, #16161a)' },
	_active: { transform: 'scale(0.94)' }
} as const;

const NumberEditorStory = () => {
	const [value, setValue] = React.useState(12);
	const [draft, setDraft] = React.useState('12');

	const commitText = (text: string) => {
		const parsed = Number(text);
		if (text.trim() !== '' && !Number.isNaN(parsed)) setValue(parsed);
	};

	const step = (delta: number) => {
		const current = draft.trim() === '' ? NaN : Number(draft);
		const next = (Number.isNaN(current) ? value || 0 : current) + delta;
		setDraft(String(next));
		setValue(next);
	};

	return (
		<Box>
			<GroupLabel>sunflowers · count</GroupLabel>
			<Flex alignItems="center" columnGap="7px">
				<Box
					as="input"
					value={draft}
					inputMode="decimal"
					aria-label="Number value"
					width={`${Math.max(String(draft).length, 1) + 3}ch`}
					minWidth="5ch"
					paddingX="12px"
					paddingY="4px"
					border="1px solid var(--tt-border, #ececef)"
					borderRadius="var(--tt-radius-sm, 9px)"
					background="var(--tt-card, #ffffff)"
					fontSize="inherit"
					fontFamily="inherit"
					outline="none"
					transition="border-color 0.15s ease, box-shadow 0.15s ease"
					_focus={{
						borderColor: 'var(--tt-faint, #b6b6c0)',
						boxShadow: '0 0 0 3px var(--tt-accent-tint, #fff5fa)'
					}}
					onBlur={(e) => {
						commitText((e.target as HTMLInputElement).value);
						setDraft(String(value ?? 0));
					}}
					onChange={(e) => {
						const text = (e.target as HTMLInputElement).value;
						setDraft(text);
						commitText(text);
					}}
					onKeyDown={(e) => {
						if (e.key === 'Enter') (e.target as HTMLElement).blur?.();
						else if (e.key === 'ArrowUp') {
							e.preventDefault();
							step(e.shiftKey ? 10 : 1);
						} else if (e.key === 'ArrowDown') {
							e.preventDefault();
							step(e.shiftKey ? -10 : -1);
						}
					}}
				/>
				<Flex {...stepButtonStyles} onClick={() => step(-1)} aria-label="Decrease" role="button">
					−
				</Flex>
				<Flex {...stepButtonStyles} onClick={() => step(1)} aria-label="Increase" role="button">
					+
				</Flex>
			</Flex>
			<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)" marginTop="10px">
				committed value: {String(value)} · ↑/↓ step 1, shift steps 10 · Enter commits and blurs
			</Text>
		</Box>
	);
};

export const inputsAndFormsStories: DesignSystemStory[] = [
	{
		id: 'settings-form',
		title: 'Settings form idiom',
		description:
			'The live /settings composition: a SettingsSection card (eyebrow header + description) holding SettingRow rows — label and hint on the left, the control pushed right. The Switch is the real themed Chakra Switch: its checked track is var(--tt-rainbow-3), its resting track the grays.medium alias of --tt-faint. The inline Select keeps the theme’s stripped, borderless look for in-place value pickers.',
		render: SettingsFormStory,
		note: 'SettingRow + SettingsSection are imported from components/Settings/SettingsSection.tsx — the same modules /settings renders.'
	},
	{
		id: 'tokened-field-recipe',
		title: 'The tokened field recipe',
		description:
			'The form-field recipe shared by admin, /tests, and the builder drawer: mono uppercase micro-label above the field, 1px --tt-border, radius --tt-radius-sm, --tt-card fill, and focusBorderColor --tt-accent standing in for the globally-stripped Chakra focus ring. Payload/code textareas switch to mono type on the --tt-surface-alt wash.',
		render: TokenedFieldsStory,
		note: 'The global theme removes every default focus ring (theme.tsx styles.global) — a tokened field MUST bring its own focus voice: accent border, or the accent-tint halo below.'
	},
	{
		id: 'number-editor',
		title: 'Number editor',
		description:
			'The house number editor from the Thingtime tree (NumberValueInput): a content-sized rounded input with − / + steppers replacing the heavy bordered Chakra NumberInput (the theme sets NumberInput to variant unstyled). A local draft keeps partial input like "-" or "1." from fighting the committed value; focus is the second focus voice — border --tt-faint plus a 3px --tt-accent-tint halo.',
		render: NumberEditorStory,
		note: 'The real component is exported from components/Thingtime/Thingtime.tsx and reused verbatim by the concept viewers; this story re-renders its recipe so the docs chunk does not pull in the whole editor stack.'
	}
];
