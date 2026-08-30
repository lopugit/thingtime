import React from 'react';
import { Box, Button, Flex, Input, Select, Switch, Text, Textarea } from '@chakra-ui/react';

import { useLopu } from '~/components/Lopu/useLopu';
import { DRAWER_Z } from '../Nav/Drawer/useDrawer';
import { sanitizeArgSpecs, type ComponentArgSpec } from '../ComponentsLibrary/componentTemplate';
import {
	blockLabel,
	findBlock,
	moveBlockRelative,
	removeBlock,
	updateBlock,
	type WebpageBlock,
	type WebpageBlockAlign,
	type WebpageContainerDirection,
	type WebpageTextStyle
} from './webpageBlocks';
import type { UseWebpageDraft } from './useWebpage';

// The builder's right-side drawer: page settings + the inspector for the
// selected block. Fixed to the right viewport edge (flush top/right/bottom,
// breathing room comes from the canvas padding), sitting at the nav drawer's
// z-band so the two drawers coexist — one per side.

export const BUILDER_DRAWER_WIDTH = 320;

// Floating reopen affordance shared by every surface with a collapsible
// builder drawer — closing the drawer must never exit the editing surface.
export const InspectorReopenPill = ({ onClick }: { onClick: () => void }) => (
	<Flex
		as="button"
		aria-label="Open the builder inspector"
		data-testid="builder-drawer-reopen"
		position="fixed"
		// clear of the DevKit bubble bottom-right
		right="84px"
		bottom="14px"
		zIndex={10120}
		alignItems="center"
		columnGap="7px"
		fontFamily="var(--tt-font-mono, ui-monospace, monospace)"
		fontSize="12px"
		fontWeight={700}
		paddingX="12px"
		paddingY="9px"
		borderRadius="var(--tt-radius-pill, 999px)"
		border="1px solid"
		borderColor="var(--tt-border, #ececef)"
		background="var(--tt-card, #ffffff)"
		color="var(--tt-ink, #16161a)"
		boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
		cursor="pointer"
		onClick={onClick}
	>
		🧱 Inspector
	</Flex>
);

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
	<Text
		color="var(--tt-muted, #9a9aa6)"
		fontFamily="var(--tt-font-mono, ui-monospace, monospace)"
		fontSize="10px"
		fontWeight={700}
		letterSpacing="0.12em"
		textTransform="uppercase"
		marginBottom={1}
	>
		{children}
	</Text>
);

const FieldRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
	<Flex flexDirection="column" rowGap={1}>
		<Text color="var(--tt-text, #5a5a66)" fontSize="xs" fontWeight={600}>
			{label}
		</Text>
		{children}
	</Flex>
);

const inputStyles = {
	size: 'sm' as const,
	border: '1px solid',
	borderColor: 'var(--tt-border, #ececef)',
	borderRadius: 'var(--tt-radius-sm, 9px)',
	background: 'var(--tt-card, #ffffff)'
};

const ALIGN_OPTIONS: Array<WebpageBlockAlign | ''> = ['', 'start', 'center', 'end', 'stretch'];

const ArgField = ({
	spec,
	value,
	onChange
}: {
	spec: ComponentArgSpec;
	value: string | number | boolean | undefined;
	onChange: (next: string | number | boolean | undefined) => void;
}) => {
	if (spec.type === 'boolean') {
		return (
			<Flex alignItems="center" justifyContent="space-between">
				<Text color="var(--tt-text, #5a5a66)" fontSize="xs" fontWeight={600}>
					{spec.label || spec.name}
				</Text>
				<Switch isChecked={value === true || value === 'true'} onChange={(event) => onChange(event.target.checked)} size="sm" />
			</Flex>
		);
	}
	if (spec.type === 'enum') {
		return (
			<FieldRow label={spec.label || spec.name}>
				<Select {...inputStyles} value={String(value ?? spec.default ?? '')} onChange={(event) => onChange(event.target.value)}>
					{(spec.values || []).map((option) => (
						<option key={option} value={option}>
							{option}
						</option>
					))}
				</Select>
			</FieldRow>
		);
	}
	if (spec.type === 'number') {
		return (
			<FieldRow label={spec.label || spec.name}>
				<Input
					{...inputStyles}
					type="number"
					value={value === undefined ? '' : String(value)}
					onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
				/>
			</FieldRow>
		);
	}
	if (spec.type === 'text') {
		return (
			<FieldRow label={spec.label || spec.name}>
				<Textarea {...inputStyles} rows={3} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} />
			</FieldRow>
		);
	}
	// string / color
	return (
		<FieldRow label={spec.label || spec.name}>
			<Input
				{...inputStyles}
				type={spec.type === 'color' ? 'text' : 'text'}
				placeholder={spec.default !== undefined ? String(spec.default) : undefined}
				value={String(value ?? '')}
				onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
			/>
		</FieldRow>
	);
};

const BlockInspector = ({
	draft,
	block,
	onDeselect
}: {
	draft: UseWebpageDraft;
	block: WebpageBlock;
	onDeselect: () => void;
}) => {
	const patch = (fields: Partial<WebpageBlock>) => draft.setBlocks(updateBlock(draft.blocks, block.id, fields));
	const component = block.type === 'component' ? draft.componentsByRef[block.component || ''] : null;
	const specs = React.useMemo(() => sanitizeArgSpecs(component?.crystal?.args), [component?.crystal?.args]);

	return (
		<Flex flexDirection="column" rowGap={3}>
			<Flex alignItems="center" justifyContent="space-between" columnGap={2}>
				<Eyebrow>Selected block · {blockLabel(block)}</Eyebrow>
				<Flex columnGap={1} flexShrink={0}>
					{([-1, 1] as const).map((delta) => (
						<Box
							key={delta}
							as="button"
							aria-label={delta === -1 ? 'Move block up' : 'Move block down'}
							data-testid={delta === -1 ? 'builder-move-up' : 'builder-move-down'}
							color="var(--tt-muted, #9a9aa6)"
							fontSize="13px"
							lineHeight="1"
							paddingX="5px"
							paddingY="3px"
							borderRadius="var(--tt-radius-xs, 7px)"
							border="1px solid"
							borderColor="var(--tt-border, #ececef)"
							cursor="pointer"
							_hover={{ color: 'var(--tt-ink, #16161a)', borderColor: 'var(--tt-muted, #9a9aa6)' }}
							onClick={() => draft.setBlocks(moveBlockRelative(draft.blocks, block.id, delta))}
						>
							{delta === -1 ? '↑' : '↓'}
						</Box>
					))}
				</Flex>
				{block.type !== 'native' ? (
					<Box
						as="button"
						aria-label="Delete block"
						data-testid="builder-delete-block"
						color="var(--tt-danger, #d6455a)"
						fontFamily="var(--tt-font-mono, ui-monospace, monospace)"
						fontSize="11px"
						fontWeight={700}
						cursor="pointer"
						_hover={{ textDecoration: 'underline' }}
						onClick={() => {
							draft.setBlocks(removeBlock(draft.blocks, block.id));
							onDeselect();
						}}
					>
						delete
					</Box>
				) : null}
			</Flex>

			{block.type === 'native' ? (
				<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" lineHeight="1.6">
					🔒 This is the built-in {block.native} screen. It can be moved between your blocks but not deleted — reset the page to
					discard your customisations.
				</Text>
			) : null}

			{block.type === 'text' ? (
				<>
					<FieldRow label="Text">
						<Textarea {...inputStyles} rows={4} value={block.text || ''} onChange={(event) => patch({ text: event.target.value })} />
					</FieldRow>
					<FieldRow label="Style">
						<Select {...inputStyles} value={block.style || 'body'} onChange={(event) => patch({ style: event.target.value as WebpageTextStyle })}>
							<option value="body">body</option>
							<option value="heading">heading</option>
							<option value="eyebrow">eyebrow</option>
						</Select>
					</FieldRow>
				</>
			) : null}

			{block.type === 'container' ? (
				<>
					<FieldRow label="Direction">
						<Select
							{...inputStyles}
							value={block.direction || 'column'}
							onChange={(event) => patch({ direction: event.target.value as WebpageContainerDirection })}
						>
							<option value="column">column</option>
							<option value="row">row</option>
							<option value="grid">grid</option>
						</Select>
					</FieldRow>
					<FieldRow label="Gap">
						<Input
							{...inputStyles}
							type="number"
							value={block.gap ?? 4}
							onChange={(event) => patch({ gap: Math.max(0, Math.min(12, Number(event.target.value) || 0)) })}
						/>
					</FieldRow>
					{block.direction === 'grid' ? (
						<FieldRow label="Columns">
							<Input
								{...inputStyles}
								type="number"
								value={block.columns ?? 2}
								onChange={(event) => patch({ columns: Math.max(1, Math.min(6, Number(event.target.value) || 1)) })}
							/>
						</FieldRow>
					) : null}
				</>
			) : null}

			{block.type === 'component' ? (
				<>
					<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, ui-monospace, monospace)" fontSize="10px">
						🧩 {block.component}
					</Text>
					{specs.length ? (
						<Flex flexDirection="column" rowGap={2}>
							<Eyebrow>Args</Eyebrow>
							{specs.map((spec) => (
								<ArgField
									key={spec.name}
									spec={spec}
									value={block.args?.[spec.name] ?? (component?.crystal?.savedArgs || {})[spec.name]}
									onChange={(next) => {
										const args = { ...(block.args || {}) };
										if (next === undefined) delete args[spec.name];
										else args[spec.name] = next;
										patch({ args });
									}}
								/>
							))}
						</Flex>
					) : (
						<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs">
							This component has no args to tweak.
						</Text>
					)}
				</>
			) : null}

			{block.type !== 'native' ? (
				<>
					<FieldRow label="Align">
						<Select
							{...inputStyles}
							value={block.align || ''}
							onChange={(event) => patch({ align: (event.target.value || undefined) as WebpageBlockAlign | undefined })}
						>
							{ALIGN_OPTIONS.map((option) => (
								<option key={option || 'auto'} value={option}>
									{option || 'auto'}
								</option>
							))}
						</Select>
					</FieldRow>
					<FieldRow label="Max width (px)">
						<Input
							{...inputStyles}
							type="number"
							placeholder="auto"
							value={block.maxWidth ?? ''}
							onChange={(event) => {
								const raw = event.target.value;
								patch({ maxWidth: raw === '' ? undefined : Math.max(120, Math.min(1680, Number(raw) || 120)) });
							}}
						/>
					</FieldRow>
				</>
			) : null}
		</Flex>
	);
};

export const BuilderDrawer = (props: {
	title: string;
	draft: UseWebpageDraft;
	selectedId: string | null;
	onDeselect: () => void;
	onClose: () => void;
	// standalone pages can publish + get a /p/ link; site pages stay personal
	mode: 'page' | 'site';
	pageName: string;
	onPageName: (next: string) => void;
	isPublic: boolean;
	onIsPublic: (next: boolean) => void;
	onSaved?: (id: string) => void;
	// dual-region site editing (page + global drafts share one drawer):
	// onSaveAll saves every dirty draft, anyDirty drives the Save state, and
	// regionLabel names the region the selected block lives in
	onSaveAll?: () => Promise<{ ok: boolean; error?: string }>;
	anyDirty?: boolean;
	regionLabel?: string;
}) => {
	const {
		title,
		draft,
		selectedId,
		onDeselect,
		onClose,
		mode,
		pageName,
		onPageName,
		isPublic,
		onIsPublic,
		onSaved,
		onSaveAll,
		anyDirty,
		regionLabel
	} = props;
	const lopu = useLopu();
	const [saving, setSaving] = React.useState(false);
	// name/visibility edits live here (not in the block draft), so they mark
	// the page saveable on their own
	const [metaDirty, setMetaDirty] = React.useState(false);
	const selected = selectedId ? findBlock(draft.blocks, selectedId) : null;
	const source = draft.resolved?.source || null;
	const pageId = draft.resolved?.page?.id || null;

	const handleSave = async () => {
		setSaving(true);
		const result = onSaveAll
			? await onSaveAll()
			: await draft.save({ name: pageName, isPublic: mode === 'page' ? isPublic : false });
		setSaving(false);
		if (result.ok) {
			setMetaDirty(false);
			lopu({ title: mode === 'site' ? 'Your page is saved — this is your Thingtime now 🧱✨' : 'Page saved ✨', status: 'success' });
			if (result.id && onSaved) onSaved(result.id);
		} else {
			lopu({ title: result.error || 'Save didn’t stick — try again 🌈', status: 'error' });
		}
	};

	const handleReset = async () => {
		const result = await draft.resetToDefault();
		if (result.ok) {
			lopu({ title: 'Back to the default page 🌱', status: 'success' });
			onDeselect();
		} else {
			lopu({ title: result.error || 'Reset failed', status: 'error' });
		}
	};

	return (
		<Flex
			className="ttBuilderDrawer"
			data-testid="builder-drawer"
			position="fixed"
			top={0}
			right={0}
			bottom={0}
			width={[`min(${BUILDER_DRAWER_WIDTH}px, calc(100vw - 56px))`, `${BUILDER_DRAWER_WIDTH}px`]}
			zIndex={DRAWER_Z}
			flexDirection="column"
			background="var(--tt-card, #ffffff)"
			borderLeft="1px solid"
			borderColor="var(--tt-border, #ececef)"
			boxShadow="var(--tt-shadow-panel, -8px 0 24px rgba(0, 0, 0, 0.06))"
			paddingTop="calc(var(--thingtime-safe-area-top, 0px) + 12px)"
			overflowY="auto"
		>
			<Flex alignItems="center" justifyContent="space-between" paddingX={4} paddingBottom={3} borderBottom="1px solid" borderColor="var(--tt-border-light, #f0f0f2)">
				<Text color="var(--tt-ink, #16161a)" fontFamily="heading" fontSize="sm" fontWeight={800}>
					{title}
				</Text>
				<Box
					as="button"
					aria-label="Close builder"
					data-testid="builder-close"
					color="var(--tt-muted, #9a9aa6)"
					fontSize="16px"
					cursor="pointer"
					_hover={{ color: 'var(--tt-ink, #16161a)' }}
					onClick={onClose}
				>
					✕
				</Box>
			</Flex>

			<Flex flexDirection="column" rowGap={4} padding={4}>
				{selected ? (
					<>
						{regionLabel ? (
							<Text
								color="var(--tt-muted, #9a9aa6)"
								fontFamily="var(--tt-font-mono, ui-monospace, monospace)"
								fontSize="10px"
								fontWeight={700}
								letterSpacing="0.1em"
								textTransform="uppercase"
								marginBottom={-2}
							>
								{regionLabel}
							</Text>
						) : null}
						<BlockInspector draft={draft} block={selected} onDeselect={onDeselect} />
					</>
				) : (
					<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" lineHeight="1.7">
						Hover blocks to see their boundaries, click one to edit it, drag the ⠿ chip to move it, and use the inline
						<Box as="span" color="var(--tt-accent, hotpink)" fontWeight={700}>
							{' '}
							+ add block{' '}
						</Box>
						lines to build. 🌈
					</Text>
				)}

				<Box borderTop="1px solid" borderColor="var(--tt-border-light, #f0f0f2)" paddingTop={3}>
					<Eyebrow>{mode === 'site' ? 'Site page' : 'Page'}</Eyebrow>
					<Flex flexDirection="column" rowGap={2}>
						<FieldRow label="Name">
							<Input
								{...inputStyles}
								value={pageName}
								onChange={(event) => {
									onPageName(event.target.value);
									setMetaDirty(true);
								}}
								data-testid="builder-page-name"
							/>
						</FieldRow>
						{mode === 'page' ? (
							<Flex alignItems="center" justifyContent="space-between">
								<Text color="var(--tt-text, #5a5a66)" fontSize="xs" fontWeight={600}>
									Public page
								</Text>
								<Switch
									isChecked={isPublic}
									onChange={(event) => {
										onIsPublic(event.target.checked);
										setMetaDirty(true);
									}}
									size="sm"
									data-testid="builder-public-toggle"
								/>
							</Flex>
						) : (
							<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" lineHeight="1.6">
								{source === 'user'
									? 'This is your personalised version of this page — only you see it.'
									: 'Saving forks this page into your Things — only you see your version.'}
							</Text>
						)}
						{mode === 'page' && pageId && source === 'user' ? (
							<Text fontFamily="var(--tt-font-mono, ui-monospace, monospace)" fontSize="11px">
								<Box as="a" href={`/p/${pageId}`} color="var(--tt-link, #2f8fd6)" textDecoration="underline">
									/p/{pageId}
								</Box>
							</Text>
						) : null}
					</Flex>
				</Box>

				<Flex columnGap={2}>
					<Button
						size="sm"
						onClick={handleSave}
						isLoading={saving}
						isDisabled={anyDirty !== undefined ? !anyDirty && !metaDirty : !draft.dirty && !metaDirty && source === 'user'}
						data-testid="builder-save"
						flex={1}
					>
						{source === 'user' ? 'Save' : mode === 'site' ? 'Save my version' : 'Save page'}
					</Button>
					{draft.dirty ? (
						<Button size="sm" variant="outline" onClick={draft.discardDraft} data-testid="builder-discard">
							Discard
						</Button>
					) : null}
				</Flex>
				{mode === 'site' && source === 'user' ? (
					<Box
						as="button"
						alignSelf="flex-start"
						color="var(--tt-danger, #d6455a)"
						fontFamily="var(--tt-font-mono, ui-monospace, monospace)"
						fontSize="11px"
						fontWeight={700}
						cursor="pointer"
						_hover={{ textDecoration: 'underline' }}
						onClick={handleReset}
						data-testid="builder-reset-default"
					>
						reset to default page
					</Box>
				) : null}
			</Flex>
		</Flex>
	);
};
