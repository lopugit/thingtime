import React from 'react';
import { Box, Flex, Grid, Text, Textarea } from '@chakra-ui/react';

import { RenderThing, getKindRenderer, getKindRenderers, sampleKindThings } from '~/components/Kinds';
import { LONG_TEXT_BLOCK_TYPES, LongTextEditor } from '~/components/Editor/LongTextEditor';
import type { LongTextBlockType, LongTextBlockTypes, LongTextValue } from '~/components/Editor/LongTextEditor';
import {
	FocusCardsViewer,
	FormSheetViewer,
	MillerColumnsViewer,
	OrbitCanvasViewer,
	OutlineDocViewer,
	makeSampleWorld
} from '~/components/Thingtime/concepts';
import { sanitizeParsedJson } from '~/components/Thingtime/jsonValue';

// Live stories for /docs/concepts. Every story renders real Thingtime
// components on plain JSON state, inside a device frame that can flip between
// a desktop canvas and a phone-width frame, with a view/edit switch — so the
// docs demo *is* the component you'd mount in the editor.

// 'auto' = the desktop canvas: viewers still measure their container, so the
// docs page itself degrades correctly on a narrow screen
export type ConceptStoryArgs = { variant: 'auto' | 'mobile'; edit: boolean };

export type ConceptStory = {
	id: string;
	title: string;
	description: string;
	note?: string;
	defaultEdit?: boolean;
	render: (args: ConceptStoryArgs) => React.ReactNode;
};

// ————— device frame chrome —————

const TogglePill = (props: { active: boolean; children: React.ReactNode; onClick: () => void }) => (
	<Box
		as="button"
		type="button"
		background={props.active ? 'var(--tt-card, #ffffff)' : 'transparent'}
		borderRadius="999px"
		boxShadow={props.active ? 'var(--tt-shadow-card, 0 1px 2px rgba(0,0,0,0.08))' : 'none'}
		color={props.active ? 'var(--tt-ink, #16161a)' : 'var(--tt-muted, #9a9aa6)'}
		cursor="pointer"
		fontSize="12px"
		fontWeight={700}
		paddingX="12px"
		paddingY="4px"
		whiteSpace="nowrap"
		onClick={props.onClick}
	>
		{props.children}
	</Box>
);

export const DeviceFrame = (props: {
	children: (args: ConceptStoryArgs) => React.ReactNode;
	defaultEdit?: boolean;
	editToggle?: boolean;
}) => {
	const [device, setDevice] = React.useState<'desktop' | 'mobile'>('desktop');
	const [edit, setEdit] = React.useState(props.defaultEdit ?? false);

	return (
		<Box width="100%">
			<Flex columnGap={2} flexWrap="wrap" justifyContent="space-between" marginBottom={3} rowGap={2}>
				<Flex background="var(--tt-surface-alt, #f5f5f7)" borderRadius="999px" padding="2px">
					<TogglePill active={device === 'desktop'} onClick={() => setDevice('desktop')}>
						🖥️ Desktop
					</TogglePill>
					<TogglePill active={device === 'mobile'} onClick={() => setDevice('mobile')}>
						📱 Phone
					</TogglePill>
				</Flex>
				{props.editToggle !== false ? (
					<Flex background="var(--tt-surface-alt, #f5f5f7)" borderRadius="999px" padding="2px">
						<TogglePill active={!edit} onClick={() => setEdit(false)}>
							👀 View
						</TogglePill>
						<TogglePill active={edit} onClick={() => setEdit(true)}>
							🎨 Edit
						</TogglePill>
					</Flex>
				) : null}
			</Flex>

			{device === 'mobile' ? (
				<Flex justifyContent="center">
					<Box
						background="var(--tt-surface, #fafafb)"
						border="8px solid var(--tt-ink, #16161a)"
						borderRadius="34px"
						maxWidth="100%"
						overflow="hidden"
						width="375px"
					>
						<Box height="586px" overflowY="auto" padding={3}>
							{props.children({ variant: 'mobile', edit })}
						</Box>
					</Box>
				</Flex>
			) : (
				<Box>{props.children({ variant: 'auto', edit })}</Box>
			)}
		</Box>
	);
};

// stateful sample-world wrapper so edits persist while you play
const useWorld = () => {
	const [world, setWorld] = React.useState<unknown>(() => makeSampleWorld());
	return { world, setWorld };
};

// ————— concept viewer stories —————

const ColumnsStory = ({ variant, edit }: ConceptStoryArgs) => {
	const { world, setWorld } = useWorld();
	return <MillerColumnsViewer thing={world} onThingChange={setWorld} edit={edit} variant={variant} />;
};

const FocusStory = ({ variant, edit }: ConceptStoryArgs) => {
	const { world, setWorld } = useWorld();
	return <FocusCardsViewer thing={world} onThingChange={setWorld} edit={edit} variant={variant} />;
};

const DocumentStory = ({ variant, edit }: ConceptStoryArgs) => {
	const { world, setWorld } = useWorld();
	return <OutlineDocViewer thing={world} onThingChange={setWorld} edit={edit} variant={variant} />;
};

const FormStory = ({ variant, edit }: ConceptStoryArgs) => {
	const { world, setWorld } = useWorld();
	return <FormSheetViewer thing={world} onThingChange={setWorld} edit={edit} variant={variant} />;
};

const GalaxyStory = ({ variant, edit }: ConceptStoryArgs) => {
	const { world, setWorld } = useWorld();
	return <OrbitCanvasViewer thing={world} onThingChange={setWorld} edit={edit} variant={variant} />;
};

export const columnsStories: ConceptStory[] = [
	{
		id: 'columns-walk',
		title: 'Walk the world left to right',
		description:
			'Click through garden → plants → a plant. Every level is a column; the trail stays visible. On the phone frame the same walk becomes push navigation with a Back button.',
		render: (args) => <ColumnsStory {...args} />,
		note: 'Flip to 🎨 Edit for inline value editing, 🗑️ recycling, and the 🌱 grow button in every column.'
	}
];

export const focusStories: ConceptStory[] = [
	{
		id: 'focus-drill',
		title: 'One thing at a time',
		description:
			'The focused thing owns the screen; children are big friendly cards. Branch cards drill in, leaf cards edit in place. Subtrees that carry a kind (like “for sale”) show their rendered card with a ✨/🔍 flip.',
		render: (args) => <FocusStory {...args} />,
		note: 'This concept is identical on desktop and mobile — only the card grid density changes.'
	}
];

export const documentStories: ConceptStory[] = [
	{
		id: 'document-read',
		title: 'Data that reads like a page',
		description:
			'Objects become headed sections, leaves become labelled lines, and the plants array — same-shaped objects — renders as a real table. Nesting is typography, not indentation, so nothing marches off the right edge.',
		render: (args) => <DocumentStory {...args} />,
		note: 'On the phone frame tables become stacked cards and labels move above values.'
	}
];

export const formStories: ConceptStory[] = [
	{
		id: 'form-sheet',
		title: 'Every thing is a settings page',
		description:
			'Top-level branches are section cards, leaves are labelled fields — switches for booleans, steppers for numbers, magic inputs for text. This is the closest cousin of the current edit mode, reorganised into a shape people already know.',
		defaultEdit: true,
		render: (args) => <FormStory {...args} />,
		note: 'Deep branches nest with a soft left rule for three levels, then hand off to a drill-down view.'
	}
];

export const galaxyStories: ConceptStory[] = [
	{
		id: 'galaxy-orbit',
		title: 'Things orbit their parent',
		description:
			'The focused thing is the sun; children orbit as moons. Tap a moon with children to make it the new sun; tap a leaf to open it in a sheet below. Structure becomes place — things inside things, not brackets inside brackets.',
		render: (args) => <GalaxyStory {...args} />,
		note: 'Busy orbits cap at nine moons plus a “+n more” bubble that opens the full list.'
	}
];

// ————— kind gallery stories —————

const GALLERY_CATEGORY_ORDER = ['Social', 'Media', 'Commerce', 'Planning', 'Knowledge', 'Life', 'World', 'Data', 'Builder'];

const KindGalleryStory = ({ variant }: ConceptStoryArgs) => {
	const groups = React.useMemo(() => {
		const byCategory = new Map<string, typeof sampleKindThings>();
		sampleKindThings.forEach((sample) => {
			const category = getKindRenderer(sample.kind)?.category || 'Other';
			byCategory.set(category, [...(byCategory.get(category) || []), sample]);
		});
		return [...byCategory.entries()].sort(
			(a, b) =>
				(GALLERY_CATEGORY_ORDER.indexOf(a[0]) + 100 * Number(GALLERY_CATEGORY_ORDER.indexOf(a[0]) < 0)) -
				(GALLERY_CATEGORY_ORDER.indexOf(b[0]) + 100 * Number(GALLERY_CATEGORY_ORDER.indexOf(b[0]) < 0))
		);
	}, []);

	return (
		<Flex flexDirection="column" rowGap={6}>
			{groups.map(([category, samples]) => (
				<Box key={category}>
					<Flex alignItems="baseline" columnGap={2} marginBottom={3}>
						<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={850} letterSpacing="0.1em" textTransform="uppercase">
							{category}
						</Text>
						<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="11px">
							{samples.length}
						</Text>
					</Flex>
					<Grid gap={4} templateColumns={variant === 'mobile' ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))'}>
						{samples.map((sample) => (
							<Box key={sample.kind}>
								<Text
									color="var(--tt-muted, #9a9aa6)"
									fontFamily="var(--tt-font-mono, monospace)"
									fontSize="11px"
									fontWeight={700}
									marginBottom={1.5}
								>
									kind: '{sample.kind}'
								</Text>
								<RenderThing thing={sample.thing} context={{ size: variant === 'mobile' ? 'compact' : 'card' }} />
							</Box>
						))}
					</Grid>
				</Box>
			))}
		</Flex>
	);
};

const PolymorphismStory = (_args: ConceptStoryArgs) => {
	// one feed post shaped like PublicPost carrying a listing — the listing
	// renderer adapts it without the thing being authored "for" that template
	const feedPost = {
		type: 'marketplace',
		author: { username: 'lopu', displayName: 'Lopu 🦄' },
		text: 'Moving house — the reading chair needs a new home!',
		listing: { title: 'Sunny yellow armchair', price: 120, currency: 'AUD', condition: 'used', location: 'Byron Bay', sold: false },
		reactionCounts: { '❤️': 4 }
	};

	const bareCoords = { name: 'Secret picnic spot', lat: -28.31, lng: 153.44, note: 'No kind field on this thing at all.' };

	return (
		<Grid gap={4} templateColumns="repeat(auto-fill, minmax(300px, 1fr))">
			<Box>
				<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="11px" fontWeight={700} marginBottom={1.5}>
					PublicPost shape → listing template (via adapt)
				</Text>
				<RenderThing thing={feedPost} />
			</Box>
			<Box>
				<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="11px" fontWeight={700} marginBottom={1.5}>
					kind-less {'{ lat, lng }'} → place template (via match)
				</Text>
				<RenderThing thing={bareCoords} />
			</Box>
		</Grid>
	);
};

export const kindGalleryStories: ConceptStory[] = [
	{
		id: 'kind-gallery',
		title: 'The gallery',
		description:
			'Every built-in kind renderer, fed by plain JSON exactly as it would sit in the things collection. This is what a mixed feed or search result page can look like when things know their kind.',
		render: (args) => <KindGalleryStory {...args} />
	},
	{
		id: 'kind-polymorphism',
		title: 'Polymorphism: many shapes, one template',
		description:
			'Renderers adapt data instead of demanding a schema. A feed post carrying a listing renders through the listing template, and a bare { lat, lng } object resolves the place template by shape alone — no kind field required.',
		render: (args) => <PolymorphismStory {...args} />
	}
];

// ————— long-text editor stories —————

const LONG_TEXT_SEED = `## Repotting plan

The monstera doubled over winter — time to size up before the roots stage a breakout.

- [x] Buy 30cm terracotta pot
- [ ] Fresh potting mix
- [ ] Bribe Monty with plant food

> Growth is just nested time.

| plant | water |
| --- | --- |
| Monstera | weekly |
| Basil | daily |

\`\`\`
const monty = { happy: true };
\`\`\`

⚠️ Root check — lift the pot every Sunday.

---

Water lightly for the first week.`;

const LongTextStringStory = ({ edit }: ConceptStoryArgs) => {
	const [value, setValue] = React.useState<LongTextValue>(LONG_TEXT_SEED);

	return (
		<Grid gap={4} templateColumns="repeat(auto-fit, minmax(280px, 1fr))">
			<Box>
				<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="11px" fontWeight={700} marginBottom={1.5}>
					the block editor (what people touch)
				</Text>
				<LongTextEditor value={LONG_TEXT_SEED} onValueChange={setValue} readonly={!edit} />
			</Box>
			<Box minWidth={0}>
				<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="11px" fontWeight={700} marginBottom={1.5}>
					the stored value (still one plain string)
				</Text>
				<Box
					as="pre"
					background="var(--tt-surface, #fafafb)"
					border="1px dashed var(--tt-border, #ececef)"
					borderRadius="var(--tt-radius-md, 12px)"
					color="var(--tt-text, #5a5a66)"
					fontFamily="var(--tt-font-mono, monospace)"
					fontSize="12px"
					lineHeight="1.6"
					minHeight="120px"
					overflowX="auto"
					padding={4}
					whiteSpace="pre-wrap"
				>
					{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
				</Box>
			</Box>
		</Grid>
	);
};

const RICH_TEXT_SEED = {
	kind: 'rich-text',
	blocks: [
		{ type: 'header', data: { text: 'A thing made of blocks', level: 2 } },
		{ type: 'paragraph', data: { text: 'This document <b>IS</b> a thing — the <i>blocks</i> array lives in Mongo like any other JSON.' } },
		{ type: 'list', data: { style: 'unordered', items: ['Edit it here with <b>Editor.js</b>', 'Render it anywhere with the <mark>rich-text</mark> kind'] } }
	]
};

const RichTextThingStory = ({ edit }: ConceptStoryArgs) => {
	const [doc, setDoc] = React.useState<LongTextValue>(RICH_TEXT_SEED as LongTextValue);

	return (
		<Grid gap={4} templateColumns="repeat(auto-fit, minmax(280px, 1fr))">
			<Box>
				<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="11px" fontWeight={700} marginBottom={1.5}>
					editing the thing (block mode)
				</Text>
				<LongTextEditor value={RICH_TEXT_SEED as LongTextValue} onValueChange={setDoc} readonly={!edit} />
			</Box>
			<Box minWidth={0}>
				<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="11px" fontWeight={700} marginBottom={1.5}>
					rendered by the rich-text kind (live)
				</Text>
				<RenderThing thing={doc} />
			</Box>
		</Grid>
	);
};

const BLOCK_TYPE_META: Record<LongTextBlockType, { label: string; emoji: string }> = {
	header: { label: 'Headings', emoji: '🔠' },
	list: { label: 'Lists', emoji: '📚' },
	checklist: { label: 'Checklists', emoji: '☑️' },
	quote: { label: 'Quotes', emoji: '💬' },
	delimiter: { label: 'Dividers', emoji: '➖' },
	table: { label: 'Tables', emoji: '🧮' },
	code: { label: 'Code', emoji: '⌨️' },
	warning: { label: 'Callouts', emoji: '⚠️' },
	embed: { label: 'Embeds', emoji: '▶️' },
	image: { label: 'Images', emoji: '🖼️' },
	marker: { label: 'Highlight', emoji: '🖍️' },
	inlineCode: { label: 'Inline code', emoji: '🔤' },
	underline: { label: 'Underline', emoji: '🖊️' },
	style: { label: 'Custom style', emoji: '🎨' }
};

const BLOCK_PICKER_SEED = `## Every block, one field

| tool | vibe |
| --- | --- |
| tables | spreadsheety |
| callouts | loud |

\`\`\`
blocks: { table: false } // ...and it's gone
\`\`\`

⚠️ Heads up — toggle the chips above and watch the + menu shrink.

> Fields decide what their text can contain.`;

const BlockPickerStory = ({ edit }: ConceptStoryArgs) => {
	const [blockTypes, setBlockTypes] = React.useState<LongTextBlockTypes>({});
	const enabledCount = LONG_TEXT_BLOCK_TYPES.filter((tool) => blockTypes[tool] !== false).length;

	return (
		<Box>
			<Flex columnGap={1.5} flexWrap="wrap" marginBottom={3} rowGap={1.5}>
				{LONG_TEXT_BLOCK_TYPES.map((tool) => {
					const enabled = blockTypes[tool] !== false;
					// fall back gracefully if a tool ships before its chip metadata
					const meta = BLOCK_TYPE_META[tool] || { label: tool, emoji: '🧩' };
					return (
						<Box
							key={tool}
							as="button"
							type="button"
							background={enabled ? 'var(--tt-positive-tint, #e4f6ea)' : 'var(--tt-surface-alt, #f5f5f7)'}
							border={enabled ? '1px solid var(--tt-positive, #2f8f4f)' : '1px solid var(--tt-border, #ececef)'}
							borderRadius="999px"
							color={enabled ? 'var(--tt-positive, #2f8f4f)' : 'var(--tt-muted, #9a9aa6)'}
							cursor="pointer"
							data-testid={`block-toggle-${tool}`}
							fontSize="12px"
							fontWeight={700}
							paddingX="10px"
							paddingY="3px"
							textDecoration={enabled ? 'none' : 'line-through'}
							onClick={() => setBlockTypes((prev) => ({ ...prev, [tool]: prev[tool] === false }))}
						>
							{meta.emoji} {meta.label}
						</Box>
					);
				})}
				<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="11px" alignSelf="center">
					{enabledCount}/{LONG_TEXT_BLOCK_TYPES.length} tools on
				</Text>
			</Flex>
			<LongTextEditor value={BLOCK_PICKER_SEED} blockTypes={blockTypes} readonly={!edit} onValueChange={() => {}} />
		</Box>
	);
};

// styled blocks: tokens in block.tunes.style — including one hostile block
// whose "styles" must come out neutralised
const STYLED_SEED = {
	kind: 'rich-text',
	blocks: [
		{ type: 'header', data: { text: 'Painted headings', level: 2 }, tunes: { style: { color: '#ff69b4', size: 40, align: 'center' } } },
		{
			type: 'paragraph',
			data: { text: 'Colour, size, font, and alignment live in <b>block.tunes.style</b> as validated tokens — hex or theme colours, clamped px sizes, curated font stacks. Never raw CSS.' },
			tunes: { style: { font: 'serif', size: 17 } }
		},
		{ type: 'quote', data: { text: 'Style is data too.', caption: 'Lopu' }, tunes: { style: { align: 'center', color: 'var(--tt-link, #2f8fd6)', size: 19 } } },
		{
			type: 'paragraph',
			data: { text: 'This block tried to smuggle position:fixed, a 9999px font, and Comic Sans — the validators kept a clamped size and dropped the rest. 🛡️' },
			tunes: { style: { color: 'red;position:fixed;top:0', size: 9999, font: 'comic-sans' } }
		}
	]
};

const StyledTextStory = ({ edit }: ConceptStoryArgs) => {
	const [doc, setDoc] = React.useState<LongTextValue>(STYLED_SEED as LongTextValue);

	return (
		<Grid gap={4} templateColumns="repeat(auto-fit, minmax(280px, 1fr))">
			<Box>
				<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="11px" fontWeight={700} marginBottom={1.5}>
					the 🎨 Style tune (block settings ⋮ menu)
				</Text>
				<LongTextEditor value={STYLED_SEED as LongTextValue} onValueChange={setDoc} readonly={!edit} />
			</Box>
			<Box minWidth={0}>
				<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="11px" fontWeight={700} marginBottom={1.5}>
					rendered by the rich-text kind (live)
				</Text>
				<RenderThing thing={doc} />
			</Box>
		</Grid>
	);
};

export const longTextStories: ConceptStory[] = [
	{
		id: 'long-text-string',
		title: 'A string field can opt into blocks',
		description:
			'A field such as the feed composer can explicitly use Editor.js while still serialising back to one plain, readable string. In the Thingtime tree, primitive strings remain stable plain-text values; choosing Editor.js from Change type promotes the value to a persistent rich-text block document instead of changing controls as you type.',
		defaultEdit: true,
		render: (args) => <LongTextStringStory {...args} />,
		note: 'This demo is an explicitly block-enabled string field. In the tree, use Change type → Editor.js for persistent block editing, or Change type → string to flatten the blocks back to readable text.'
	},
	{
		id: 'long-text-rich-thing',
		title: 'Editor.js as a stable datatype',
		description:
			'A value that already is an Editor.js document ({ blocks: [...] }) edits natively — bold, italics, links, and marks included — and renders through the rich-text kind renderer via a sanitising allowlist. Write once, display anywhere a RenderThing mounts.',
		defaultEdit: true,
		render: (args) => <RichTextThingStory {...args} />,
		note: 'Select text in the editor for the inline toolbar (bold/italic/link) — formatting carries into the rendered panel live.'
	},
	{
		id: 'long-text-styled',
		title: 'Custom colours, sizes & fonts — safely (style is data)',
		description:
			'Full visual customisation without raw CSS: the 🎨 Style tune in every block\'s ⋮ settings menu offers colour swatches (theme tokens + hexes), clamped px sizes, curated font stacks, and alignment. Choices are stored as validated tokens in block.tunes.style and compiled to React style objects at render — a token can never express url(), position:fixed, or any other CSS escape hatch. The last block below arrived hostile and left harmless.',
		defaultEdit: true,
		render: (args) => <StyledTextStory {...args} />,
		note: 'Click a block, open ⋮ → 🎨 Style. Tokens survive in block mode (rich-text things); plain-string fields drop styling by design — the string stays honest.'
	},
	{
		id: 'long-text-block-picker',
		title: 'Choose your blocks (per field)',
		description:
			'The full Editor.js suite is on by default — headings, lists, checklists, quotes, dividers, tables, code, callouts, embeds, images, plus highlight/inline-code/underline inline tools. The blockTypes prop turns any of them off per field: toggle the chips and the editor re-initialises with exactly that toolset (content carries over; disabled types degrade gracefully).',
		defaultEdit: true,
		render: (args) => <BlockPickerStory {...args} />,
		note: 'Open the + menu after toggling — disabled tools vanish from it. A field\'s metadata can carry this config, so "notes allow everything, titles allow nothing" becomes data.'
	}
];

// ————— pipeline stories —————

const elementStarter = JSON.stringify(sampleKindThings.find((sample) => sample.kind === 'element')?.thing, null, 2);

const JsonToPageStory = (_args: ConceptStoryArgs) => {
	const [source, setSource] = React.useState(elementStarter || '{}');
	const [parsed, setParsed] = React.useState<unknown>(() => {
		try {
			return sanitizeParsedJson(JSON.parse(elementStarter || '{}'));
		} catch {
			return null;
		}
	});
	const [error, setError] = React.useState<string | null>(null);

	const onSourceChange = (next: string) => {
		setSource(next);
		try {
			setParsed(sanitizeParsedJson(JSON.parse(next)));
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Invalid JSON');
		}
	};

	return (
		<Grid gap={4} templateColumns="repeat(auto-fit, minmax(280px, 1fr))">
			<Box>
				<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="11px" fontWeight={700} marginBottom={1.5}>
					the thing (as stored in Mongo)
				</Text>
				<Textarea
					value={source}
					onChange={(event) => onSourceChange(event.target.value)}
					fontFamily="var(--tt-font-mono, monospace)"
					fontSize="12px"
					minHeight="320px"
					background="var(--tt-card, #ffffff)"
					borderColor={error ? 'var(--tt-danger, #d6455a)' : 'var(--tt-border, #ececef)'}
					spellCheck={false}
				/>
				{error ? (
					<Text color="var(--tt-danger, #d6455a)" fontSize="xs" marginTop={1}>
						{error}
					</Text>
				) : null}
			</Box>
			<Box>
				<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="11px" fontWeight={700} marginBottom={1.5}>
					what everyone sees
				</Text>
				<Box
					background="var(--tt-surface, #fafafb)"
					border="1px dashed var(--tt-border, #ececef)"
					borderRadius="var(--tt-radius-md, 12px)"
					minHeight="320px"
					padding={4}
				>
					{parsed !== null ? (
						<RenderThing
							thing={parsed}
							fallback={
								<Text color="var(--tt-muted, #9a9aa6)" fontSize="sm">
									No renderer matched — a feed would fall back to a nested viewer here.
								</Text>
							}
						/>
					) : null}
				</Box>
			</Box>
		</Grid>
	);
};

const RegistryStory = (_args: ConceptStoryArgs) => (
	<Box overflowX="auto">
		<Box as="table" width="100%" style={{ borderCollapse: 'collapse' }}>
			<Box as="thead">
				<Box as="tr">
					{['Kind', 'Category', 'Aliases', 'Resolves by shape when…'].map((label) => (
						<Box as="th" key={label} borderBottom="1px solid var(--tt-border, #ececef)" paddingX={2} paddingY={1.5} textAlign="left">
							<Text color="var(--tt-muted, #9a9aa6)" fontSize="11px" fontWeight={700} letterSpacing="0.06em" textTransform="uppercase">
								{label}
							</Text>
						</Box>
					))}
				</Box>
			</Box>
			<Box as="tbody">
				{getKindRenderers().map((renderer) => (
					<Box as="tr" key={renderer.kind} borderBottom="1px solid var(--tt-border-light, #f0f0f2)">
						<Box as="td" paddingX={2} paddingY={2} whiteSpace="nowrap">
							<Text fontSize="sm" fontWeight={750} color="var(--tt-ink, #16161a)">
								{renderer.emoji} {renderer.kind}
							</Text>
						</Box>
						<Box as="td" paddingX={2} paddingY={2} whiteSpace="nowrap">
							<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" fontWeight={700}>
								{renderer.category || '—'}
							</Text>
						</Box>
						<Box as="td" paddingX={2} paddingY={2}>
							<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="12px">
								{renderer.aliases?.join(', ') || '—'}
							</Text>
						</Box>
						<Box as="td" paddingX={2} paddingY={2}>
							<Text color="var(--tt-text, #5a5a66)" fontSize="sm">
								{renderer.description}
							</Text>
						</Box>
					</Box>
				))}
			</Box>
		</Box>
	</Box>
);

export const pipelineStories: ConceptStory[] = [
	{
		id: 'pipeline-json-to-page',
		title: 'JSON in, page out (live)',
		description:
			'Edit the JSON on the left — it renders on the right through the same RenderThing dispatcher a feed would use. Set kind to "element" and you are literally building html/css as data; every tag, prop, and style passes a sanitising whitelist before it touches the DOM.',
		render: (args) => <JsonToPageStory {...args} />,
		note: 'Try changing kind to "recipe" or "chart" and reshaping the JSON — the registry re-resolves on every keystroke.'
	},
	{
		id: 'pipeline-registry',
		title: 'The registry',
		description: 'Everything currently registered. New kinds are one registerKindRenderer() call — templates can serve many shapes through their adapt() function.',
		render: (args) => <RegistryStory {...args} />
	}
];
