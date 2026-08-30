import React from 'react';
import { Box, Text } from '@chakra-ui/react';

import { WebpageBlocksRenderer } from '~/components/Builder/WebpageBlocksRenderer';
import type { ComponentThingLike } from '~/components/Builder/WebpageBlocksRenderer';
import type { WebpageBlock } from '~/components/Builder/webpageBlocks';
import type { DesignSystemStory } from './ThingContextMenuStories';

// Live stories for the Builder blocks entry. Each story feeds the REAL
// WebpageBlocksRenderer a small inline tree — no chrome (builder interactions
// live in /builder), no resolve fetch: componentsByRef is supplied inline, the
// same shape /api/v1/webpages/resolve produces via buildComponentsByRef().

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

const Canvas = (props: { children: React.ReactNode }) => (
	<Box
		background="var(--tt-card, #ffffff)"
		border="1px solid var(--tt-border, #ececef)"
		borderRadius="var(--tt-radius-md, 12px)"
		padding={{ base: 4, md: 6 }}
	>
		{props.children}
	</Box>
);

const cell = (id: string, text: string): WebpageBlock => ({ id, type: 'text', style: 'body', text });

const STRUCTURAL_TREE: WebpageBlock[] = [
	{ id: 'eyebrow', type: 'text', style: 'eyebrow', text: 'garden club · newsletter' },
	{ id: 'heading', type: 'text', style: 'heading', text: 'Everything grows here 🌱' },
	{
		id: 'intro',
		type: 'text',
		style: 'body',
		text: 'Three text styles (eyebrow, heading, body) and two container shapes (row, grid) are enough for most pages — no markup anywhere, just typed blocks.'
	},
	{
		id: 'row',
		type: 'container',
		direction: 'row',
		gap: 4,
		children: [
			cell('row-a', '🌻 A row container lays its children out horizontally and wraps on small screens.'),
			cell('row-b', '🌷 Each child is itself a block — rows can hold text, components, or more containers.')
		]
	},
	{
		id: 'grid',
		type: 'container',
		direction: 'grid',
		columns: 2,
		gap: 4,
		children: [
			cell('grid-a', '🥕 Grid cell one'),
			cell('grid-b', '🍅 Grid cell two'),
			cell('grid-c', '🫐 Grid cell three'),
			cell('grid-d', '🌶 Grid cell four')
		]
	}
];

const StructuralBlocksStory = () => (
	<Canvas>
		<WebpageBlocksRenderer blocks={STRUCTURAL_TREE} componentsByRef={{}} />
	</Canvas>
);

// An inline component thing — the exact ComponentThingLike shape the resolve
// endpoint returns: an element-shaped crystal.render template plus arg specs.
// defaults → savedArgs → block.args layer left to right at render time.
const BADGE_CARD_COMPONENT: ComponentThingLike = {
	id: 'demo-badge-card',
	crystal: {
		name: 'Badge card',
		args: [
			{ name: 'eyebrow', type: 'string', default: 'component' },
			{ name: 'title', type: 'string', default: 'Untitled' },
			{ name: 'body', type: 'text', default: 'No description yet.' },
			{ name: 'tone', type: 'color', default: 'var(--tt-accent, hotpink)' }
		],
		savedArgs: { eyebrow: 'demo · saved arg' },
		render: {
			type: 'chakra',
			chakra: 'Box',
			props: {
				padding: 5,
				background: 'var(--tt-card, #ffffff)',
				border: '1px solid var(--tt-border, #ececef)',
				borderTop: '3px solid {tone}',
				borderRadius: 'var(--tt-radius-lg, 16px)',
				boxShadow: 'var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))'
			},
			children: [
				{
					chakra: 'Text',
					props: {
						fontFamily: 'var(--tt-font-mono, ui-monospace, monospace)',
						fontSize: '10px',
						fontWeight: 700,
						letterSpacing: '0.14em',
						textTransform: 'uppercase',
						color: '{tone}'
					},
					rawChildren: ['{eyebrow}']
				},
				{
					chakra: 'Heading',
					props: { fontSize: 'lg', marginTop: 1, letterSpacing: '-0.02em', color: 'var(--tt-ink, #16161a)' },
					rawChildren: ['{title}']
				},
				{
					chakra: 'Text',
					props: { fontSize: 'sm', lineHeight: '1.6', marginTop: 2, color: 'var(--tt-text, #5a5a66)' },
					rawChildren: ['{body}']
				}
			]
		}
	}
};

const COMPONENT_TREE: WebpageBlock[] = [
	{
		id: 'pair',
		type: 'container',
		direction: 'grid',
		columns: 2,
		gap: 4,
		children: [
			{
				id: 'card-1',
				type: 'component',
				component: 'demo/badge-card',
				args: {
					title: 'Sunflowers',
					body: 'block.args win the merge: this card overrides title, body, and tone per placement.',
					tone: 'var(--tt-rainbow-2, #ffbc48)'
				}
			},
			{
				id: 'card-2',
				type: 'component',
				component: 'demo/badge-card',
				args: {
					title: 'Tomatoes',
					body: 'Same component ref, different args — one template, many placements.',
					tone: 'var(--tt-rainbow-1, #f34a4a)'
				}
			}
		]
	}
];

const ComponentBlockStory = () => (
	<Canvas>
		<WebpageBlocksRenderer blocks={COMPONENT_TREE} componentsByRef={{ 'demo/badge-card': BADGE_CARD_COMPONENT }} />
		<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)" marginTop={4}>
			arg layering: spec defaults → crystal.savedArgs (the shared eyebrow) → block.args (per-placement title/body/tone)
		</Text>
	</Canvas>
);

const NOT_FOUND_TREE: WebpageBlock[] = [
	{
		id: 'gone',
		type: 'component',
		component: 'demo/vanished-component'
	}
];

const NotFoundStory = () => (
	<Canvas>
		<WebpageBlocksRenderer blocks={NOT_FOUND_TREE} componentsByRef={{ 'demo/vanished-component': null }} />
	</Canvas>
);

export const builderBlocksStories: DesignSystemStory[] = [
	{
		id: 'structural-blocks',
		title: 'Text + container blocks',
		description:
			'The structural half of the block vocabulary, rendered by the real WebpageBlocksRenderer from an inline tree: three text styles (eyebrow / heading / body, each mapped to the token typography) and containers in row and grid direction nesting more blocks. componentsByRef is empty — structural blocks resolve nothing.',
		render: StructuralBlocksStory,
		note: 'This is the exact viewer render path — the builder adds chrome (frames, insert zones, drag) around the SAME output, so what you edit is what viewers see.'
	},
	{
		id: 'component-block',
		title: 'Component blocks resolve args live',
		description:
			'A component block carries only a ref + per-placement args. The referenced component thing’s crystal.render is an element-shaped template ({argName} tokens over allowlisted nodes); values layer defaults → savedArgs → block.args and the resolved tree draws through the sanitising renderer. Two placements of one component, re-toned per block.',
		render: ComponentBlockStory,
		note: 'Live pages get componentsByRef from /api/v1/webpages/resolve via buildComponentsByRef(); this story inlines the identical shape so it renders offline.'
	},
	{
		id: 'not-found',
		title: 'Missing component placeholder',
		description:
			'When a ref resolves to null — the component was deleted, or is not visible to this viewer — the block degrades to a quiet dashed placeholder naming the ref instead of erroring the page. Visibility is resolved server-side per viewer, so the same page can show a card to one person and this placeholder to another.',
		render: NotFoundStory
	}
];
