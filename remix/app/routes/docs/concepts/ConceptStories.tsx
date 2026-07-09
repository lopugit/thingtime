import React from 'react';
import { Box, Flex, Grid, Text, Textarea } from '@chakra-ui/react';

import { RenderThing, getKindRenderers, sampleKindThings } from '~/components/Kinds';
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

const KindGalleryStory = ({ variant }: ConceptStoryArgs) => (
	<Grid gap={4} templateColumns={variant === 'mobile' ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))'}>
		{sampleKindThings.map((sample) => (
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
);

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
					{['Kind', 'Aliases', 'Resolves by shape when…'].map((label) => (
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
