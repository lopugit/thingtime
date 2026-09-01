import React from 'react';
import { Box, Button, Flex, Input, Select, Switch, Text, Textarea } from '@chakra-ui/react';

import { RichTextModal } from './RichTextModal';

import { useLopu } from '~/components/Lopu/useLopu';
import { DRAWER_Z } from '../Nav/Drawer/useDrawer';
import { sanitizeArgSpecs, type ComponentArgSpec } from '../ComponentsLibrary/componentTemplate';
import { BorderControl, CornersControl, SegmentedControl, ShadowControl, SidesControl } from './FigmaControls';
import {
	blockLabel,
	findBlock,
	moveBlockRelative,
	removeBlock,
	updateBlock,
	type WebpageBlock,
	type WebpageBlockAlign,
	type WebpageContainerDirection,
	type WebpageMediaKind,
	type WebpageTextStyle
} from './webpageBlocks';
import type { UseWebpageDraft } from './useWebpage';

// ——— Figma-style css editing ————————————————————————————————————————————
// Every block carries a free-form `css` record (kebab property → value).
// Dedicated fields below edit well-known properties; the Custom CSS textarea
// edits the whole record. One storage model, many handles.

const TEXT_TAG_OPTIONS = ['', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div', 'blockquote', 'pre', 'code'];

const cssRecordToLines = (css?: Record<string, string>): string =>
	Object.entries(css || {})
		.map(([key, value]) => `${key}: ${value}`)
		.join('\n');

const cssLinesToRecord = (text: string): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const line of text.split(/\n|;/)) {
		const split = line.indexOf(':');
		if (split <= 0) continue;
		const key = line.slice(0, split).trim().toLowerCase();
		const value = line.slice(split + 1).trim();
		if (key && value && /^(--)?[a-z][a-z0-9-]*$/.test(key)) out[key] = value;
	}
	return out;
};

// The builder's right-side drawer: page settings + the inspector for the
// selected block. Fixed to the right viewport edge (flush top/right/bottom,
// breathing room comes from the canvas padding), sitting at the nav drawer's
// z-band so the two drawers coexist — one per side.

export const BUILDER_DRAWER_WIDTH = 320;

// ——— drag-resizable drawer width ————————————————————————————————————————
// One persisted width shared by every builder surface. The drawer's left
// edge is the drag handle; consumers (canvas padding) subscribe through
// useBuilderDrawerWidth so the page re-flows live while dragging.
const DRAWER_WIDTH_KEY = 'tt-builder-drawer-width';
const DRAWER_MIN_WIDTH = 280;
const DRAWER_MAX_WIDTH = 720;
const DRAWER_WIDTH_EVENT = 'thingtime:builder-drawer-width';

const readBuilderDrawerWidth = (): number => {
	try {
		const raw = Number(window.localStorage.getItem(DRAWER_WIDTH_KEY));
		if (Number.isFinite(raw) && raw >= DRAWER_MIN_WIDTH && raw <= DRAWER_MAX_WIDTH) return Math.round(raw);
	} catch {
		// storage unavailable — default width
	}
	return BUILDER_DRAWER_WIDTH;
};

const setBuilderDrawerWidth = (width: number) => {
	const clamped = Math.round(Math.max(DRAWER_MIN_WIDTH, Math.min(DRAWER_MAX_WIDTH, width)));
	try {
		window.localStorage.setItem(DRAWER_WIDTH_KEY, String(clamped));
	} catch {
		// storage unavailable — width still applies for this session
	}
	try {
		window.dispatchEvent(new CustomEvent(DRAWER_WIDTH_EVENT, { detail: clamped }));
	} catch {
		// non-browser runtimes
	}
};

export const useBuilderDrawerWidth = (): number => {
	const [width, setWidth] = React.useState(() =>
		typeof window === 'undefined' ? BUILDER_DRAWER_WIDTH : readBuilderDrawerWidth()
	);
	React.useEffect(() => {
		const onWidth = (event: Event) => {
			const next = Number((event as CustomEvent).detail);
			if (Number.isFinite(next)) setWidth(next);
		};
		window.addEventListener(DRAWER_WIDTH_EVENT, onWidth);
		return () => window.removeEventListener(DRAWER_WIDTH_EVENT, onWidth);
	}, []);
	return width;
};

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

// Side-by-side field pairs that WRAP instead of crushing their controls —
// a select squeezed below its min-content width wraps its own option text
// ("imag/e"). Every child gets a sane flex basis and minimum.
const FieldPair = ({ children }: { children: React.ReactNode }) => (
	<Flex columnGap={2} rowGap={2} flexWrap="wrap" sx={{ '& > *': { flex: '1 1 120px', minWidth: '120px' } }}>
		{children}
	</Flex>
);

const inputStyles = {
	size: 'sm' as const,
	border: '1px solid',
	borderColor: 'var(--tt-border, #ececef)',
	borderRadius: 'var(--tt-radius-sm, 9px)',
	background: 'var(--tt-card, #ffffff)',
	// placeholders must read as hints, never as real values
	_placeholder: { color: 'var(--tt-faint, #b6b6c0)' }
};

const ALIGN_OPTIONS: Array<WebpageBlockAlign | ''> = ['', 'start', 'center', 'end', 'stretch'];

// Numeric fields must NEVER rewrite what the user is typing: clamping every
// keystroke turns "3" into the minimum before "300" can exist. The raw draft
// lives here while the field is focused; the clamped value commits on blur
// or Enter.
const ClampedNumberInput = ({
	value,
	min,
	max,
	placeholder,
	onCommit,
	testId
}: {
	value: number | undefined;
	min: number;
	max: number;
	placeholder?: string;
	onCommit: (next: number | undefined) => void;
	testId?: string;
}) => {
	const [draft, setDraft] = React.useState<string | null>(null);
	const commit = (raw: string) => {
		setDraft(null);
		if (raw.trim() === '') {
			onCommit(undefined);
			return;
		}
		const numeric = Number(raw);
		if (!Number.isFinite(numeric)) return;
		onCommit(Math.max(min, Math.min(max, Math.round(numeric))));
	};
	return (
		<Input
			{...inputStyles}
			type="number"
			placeholder={placeholder}
			value={draft ?? (value === undefined ? '' : String(value))}
			onChange={(event) => setDraft(event.target.value)}
			onBlur={(event) => commit(event.target.value)}
			onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
				if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
			}}
			data-testid={testId}
		/>
	);
};

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

// A labelled input bound to one css property on the block — commits on every
// keystroke (drafts are local, saving is explicit).
const CssField = ({
	label,
	cssKey,
	block,
	onCss,
	placeholder,
	flexBasis
}: {
	label: string;
	cssKey: string;
	block: WebpageBlock;
	onCss: (key: string, value: string) => void;
	placeholder?: string;
	flexBasis?: string;
}) => (
	<Flex flexDirection="column" rowGap={1} flex={flexBasis ? `1 1 ${flexBasis}` : '1 1 45%'} minWidth="80px">
		<Text color="var(--tt-muted, #9a9aa6)" fontSize="10px" fontWeight={600} textTransform="uppercase" letterSpacing="0.06em">
			{label}
		</Text>
		<Input
			{...inputStyles}
			value={block.css?.[cssKey] ?? ''}
			placeholder={placeholder || 'auto'}
			onChange={(event) => onCss(cssKey, event.target.value)}
			data-testid={`css-${cssKey}`}
		/>
	</Flex>
);

// The whole css record as editable `property: value` lines — the native-code
// escape hatch. Local state while typing, committed on blur.
const CustomCssEditor = ({ block, onCommit }: { block: WebpageBlock; onCommit: (css: Record<string, string>) => void }) => {
	const [text, setText] = React.useState(() => cssRecordToLines(block.css));
	const editedRef = React.useRef(false);
	React.useEffect(() => {
		// a different block selected → show its css (never clobber mid-edit text)
		if (!editedRef.current) setText(cssRecordToLines(block.css));
		// eslint-disable-next-line react-hooks/exhaustive-deps -- block identity change resets the buffer
	}, [block.id]);
	return (
		<FieldRow label="Custom CSS (property: value per line)">
			<Textarea
				{...inputStyles}
				rows={5}
				fontFamily="var(--tt-font-mono, ui-monospace, monospace)"
				fontSize="12px"
				placeholder={'padding: 24px\nbackground: #fff5fa\nborder-radius: 16px'}
				value={text}
				onChange={(event) => {
					editedRef.current = true;
					setText(event.target.value);
				}}
				onBlur={() => {
					editedRef.current = false;
					onCommit(cssLinesToRecord(text));
				}}
				data-testid="css-custom-editor"
			/>
		</FieldRow>
	);
};

// The advanced Editor.js surface for a text block — the shared RichTextModal
// (the block right-click menu opens the same one from the canvas).
const RichTextEditorButton = ({
	block,
	patch
}: {
	block: WebpageBlock;
	patch: (fields: Partial<WebpageBlock>) => void;
}) => {
	const [open, setOpen] = React.useState(false);
	return (
		<>
			<Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="rich-text-editor-open" alignSelf="flex-start">
				📝 Rich editor (Editor.js)
			</Button>
			<RichTextModal block={block} isOpen={open} onClose={() => setOpen(false)} onApply={patch} />
		</>
	);
};

const BlockInspector = ({
	draft,
	block,
	onDeselect,
	onUploadToBlock
}: {
	draft: UseWebpageDraft;
	block: WebpageBlock;
	onDeselect: () => void;
	// wired to the builder chrome's uploader — the inspector's Upload button
	// sends files AT this block (media blocks swap src in place)
	onUploadToBlock?: (blockId: string, files: File[]) => void;
}) => {
	const uploadInputRef = React.useRef<HTMLInputElement | null>(null);
	const patch = (fields: Partial<WebpageBlock>) => draft.setBlocks(updateBlock(draft.blocks, block.id, fields));
	const setCss = (key: string, value: string) => {
		const css = { ...(block.css || {}) };
		if (!value.trim()) delete css[key];
		else css[key] = value;
		patch({ css: Object.keys(css).length ? css : undefined });
	};
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
					{block.html ? (
						<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" lineHeight="1.6">
							✍️ This block holds rich text — click it on the canvas to edit inline (select text for the formatting toolbar).
						</Text>
					) : (
						<FieldRow label="Text">
							<Textarea {...inputStyles} rows={4} value={block.text || ''} onChange={(event) => patch({ text: event.target.value })} />
						</FieldRow>
					)}
					<RichTextEditorButton block={block} patch={patch} />
					<FieldPair>
						<FieldRow label="Style">
							<Select {...inputStyles} value={block.style || 'body'} onChange={(event) => patch({ style: event.target.value as WebpageTextStyle })}>
								<option value="body">body</option>
								<option value="heading">heading</option>
								<option value="eyebrow">eyebrow</option>
							</Select>
						</FieldRow>
						<FieldRow label="Tag">
							<Select {...inputStyles} value={block.tag || ''} onChange={(event) => patch({ tag: event.target.value || undefined })}>
								{TEXT_TAG_OPTIONS.map((tag) => (
									<option key={tag || 'auto'} value={tag}>
										{tag || 'auto'}
									</option>
								))}
							</Select>
						</FieldRow>
					</FieldPair>
					<Flex flexWrap="wrap" gap={2}>
						<CssField label="Font size" cssKey="font-size" block={block} onCss={setCss} placeholder="16px" />
						<CssField label="Weight" cssKey="font-weight" block={block} onCss={setCss} placeholder="400" />
						<CssField label="Line height" cssKey="line-height" block={block} onCss={setCss} placeholder="1.65" />
						<CssField label="Letter spacing" cssKey="letter-spacing" block={block} onCss={setCss} placeholder="0" />
						<CssField label="Color" cssKey="color" block={block} onCss={setCss} placeholder="#16161a" />
						<CssField label="Font family" cssKey="font-family" block={block} onCss={setCss} placeholder="inherit" />
					</Flex>
					<SegmentedControl
						label="Text align"
						value={block.css?.['text-align'] || ''}
						onChange={(next) => setCss('text-align', next)}
						testIdPrefix="text-align"
						options={[
							{ value: 'left', label: '⇤', title: 'Align left' },
							{ value: 'center', label: '↔', title: 'Align center' },
							{ value: 'right', label: '⇥', title: 'Align right' },
							{ value: 'justify', label: '☰', title: 'Justify' }
						]}
					/>
				</>
			) : null}

			{block.type === 'media' ? (
				<>
					<FieldRow label="Media">
						<Flex columnGap={2} alignItems="center">
							<Button
								size="sm"
								flexShrink={0}
								onClick={() => uploadInputRef.current?.click()}
								isDisabled={!onUploadToBlock}
								data-testid="media-upload-button"
							>
								⬆️ Upload file
							</Button>
							<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" lineHeight="1.4">
								or paste (⌘/Ctrl+V), drop a file on the block, or set a URL below
							</Text>
						</Flex>
						<Box
							as="input"
							type="file"
							accept="image/*,video/*,audio/*"
							display="none"
							ref={uploadInputRef}
							data-testid="media-upload-input"
							onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
								const files = Array.from(event.target.files || []);
								if (files.length && onUploadToBlock) onUploadToBlock(block.id, files);
								event.target.value = '';
							}}
						/>
					</FieldRow>
					<FieldRow label="…or media URL (https or /path)">
						<Input
							{...inputStyles}
							value={block.src || ''}
							placeholder="https://…/image.png"
							onChange={(event) => patch({ src: event.target.value.trim() })}
							data-testid="media-src-input"
						/>
					</FieldRow>
					<FieldPair>
						<FieldRow label="Kind">
							<Select {...inputStyles} value={block.media || 'image'} onChange={(event) => patch({ media: event.target.value as WebpageMediaKind })}>
								<option value="image">image</option>
								<option value="video">video</option>
								<option value="audio">audio</option>
							</Select>
						</FieldRow>
						<FieldRow label="Alt text">
							<Input {...inputStyles} value={block.alt || ''} onChange={(event) => patch({ alt: event.target.value || undefined })} />
						</FieldRow>
					</FieldPair>
				</>
			) : null}

			{block.type === 'html' ? (
				<FieldRow label="HTML (sanitised at render — scripts/iframes never run)">
					<Textarea
						{...inputStyles}
						rows={10}
						fontFamily="var(--tt-font-mono, ui-monospace, monospace)"
						fontSize="12px"
						value={block.html || ''}
						onChange={(event) => patch({ html: event.target.value })}
						data-testid="html-block-editor"
					/>
				</FieldRow>
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
						<ClampedNumberInput value={block.gap ?? 4} min={0} max={12} onCommit={(next) => patch({ gap: next ?? 4 })} testId="container-gap" />
					</FieldRow>
					{block.direction === 'grid' ? (
						<FieldRow label="Columns">
							<ClampedNumberInput value={block.columns ?? 2} min={1} max={6} onCommit={(next) => patch({ columns: next ?? 2 })} testId="container-columns" />
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
					<Box borderTop="1px solid" borderColor="var(--tt-border-light, #f0f0f2)" paddingTop={3}>
						<Eyebrow>Layout</Eyebrow>
						<Flex flexDirection="column" rowGap={3}>
							<FieldPair>
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
									<ClampedNumberInput
										value={block.maxWidth}
										min={120}
										max={1680}
										placeholder="auto"
										onCommit={(next) => patch({ maxWidth: next })}
										testId="block-max-width"
									/>
								</FieldRow>
							</FieldPair>
							<Flex flexWrap="wrap" gap={2}>
								<CssField label="Width" cssKey="width" block={block} onCss={setCss} />
								<CssField label="Height" cssKey="height" block={block} onCss={setCss} />
								<CssField label="Min width" cssKey="min-width" block={block} onCss={setCss} />
								<CssField label="Min height" cssKey="min-height" block={block} onCss={setCss} />
							</Flex>
							<SidesControl key={`${block.id}-padding`} label="Padding" value={block.css?.padding} onChange={(next) => setCss('padding', next)} testIdPrefix="padding" />
							<SidesControl key={`${block.id}-margin`} label="Margin" value={block.css?.margin} onChange={(next) => setCss('margin', next)} testIdPrefix="margin" />
						</Flex>
					</Box>
					<Box borderTop="1px solid" borderColor="var(--tt-border-light, #f0f0f2)" paddingTop={3}>
						<Eyebrow>Appearance</Eyebrow>
						<Flex flexDirection="column" rowGap={3}>
							<Flex flexWrap="wrap" gap={2}>
								<CssField label="Background" cssKey="background" block={block} onCss={setCss} placeholder="transparent" />
								<CssField label="Opacity" cssKey="opacity" block={block} onCss={setCss} placeholder="1" />
							</Flex>
							<CornersControl
								key={`${block.id}-radius`}
								label="Corner radius"
								value={block.css?.['border-radius']}
								onChange={(next) => setCss('border-radius', next)}
								testIdPrefix="radius"
							/>
							<BorderControl value={block.css?.border} onChange={(next) => setCss('border', next)} testIdPrefix="border" />
							<ShadowControl value={block.css?.['box-shadow']} onChange={(next) => setCss('box-shadow', next)} testIdPrefix="shadow" />
						</Flex>
					</Box>
					<Box borderTop="1px solid" borderColor="var(--tt-border-light, #f0f0f2)" paddingTop={3}>
						<Eyebrow>Native code</Eyebrow>
						<CustomCssEditor block={block} onCommit={(css) => patch({ css: Object.keys(css).length ? css : undefined })} />
					</Box>
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
	// upload files at the selected block (media blocks swap src in place) —
	// powers the inspector's ⬆️ Upload button
	onUploadToBlock?: (blockId: string, files: File[]) => void;
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
		regionLabel,
		onUploadToBlock
	} = props;
	const lopu = useLopu();
	const drawerWidth = useBuilderDrawerWidth();
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
			width={[`min(${drawerWidth}px, calc(100vw - 56px))`, `${drawerWidth}px`]}
			zIndex={DRAWER_Z}
			flexDirection="column"
			background="var(--tt-card, #ffffff)"
			borderLeft="1px solid"
			borderColor="var(--tt-border, #ececef)"
			boxShadow="var(--tt-shadow-panel, -8px 0 24px rgba(0, 0, 0, 0.06))"
			paddingTop="calc(var(--thingtime-safe-area-top, 0px) + 12px)"
		>
			{/* left-edge drag handle — anchored to the drawer shell (the CONTENT
			    scrolls, not the shell, so the handle is always reachable) */}
			<Box
				position="absolute"
				left={0}
				top={0}
				bottom={0}
				width="7px"
				cursor="col-resize"
				zIndex={2}
				data-testid="builder-drawer-resize"
				sx={{ touchAction: 'none', userSelect: 'none' }}
				_hover={{ background: 'var(--tt-accent, hotpink)', opacity: 0.35 }}
				onPointerDown={(event: React.PointerEvent<HTMLElement>) => {
					event.preventDefault();
					try {
						(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
					} catch {
						// pointer capture unsupported — move events still flow while over the handle
					}
				}}
				onPointerMove={(event: React.PointerEvent) => {
					if ((event.buttons & 1) === 0) return;
					setBuilderDrawerWidth(window.innerWidth - event.clientX);
				}}
			/>
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

			<Flex flexDirection="column" rowGap={4} padding={4} flex="1" minHeight={0} overflowY="auto">
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
						<BlockInspector draft={draft} block={selected} onDeselect={onDeselect} onUploadToBlock={onUploadToBlock} />
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
