import type { ConceptStory } from './ConceptStories';
import {
	columnsStories,
	documentStories,
	focusStories,
	formStories,
	galaxyStories,
	kindGalleryStories,
	longTextStories,
	pipelineStories
} from './ConceptStories';

// Registry for /docs/concepts — alternative nested data viewer/editor concepts
// plus the kind-renderer system. Every entry's stories run the real components
// (components/Thingtime/concepts + components/Kinds), so adopting one is a
// wiring job, not a rebuild.

export type ConceptEntryStatus = 'Concept' | 'Gallery' | 'Architecture' | 'Adopted';

export type ConceptEntry = {
	slug: string;
	title: string;
	emoji: string;
	status: ConceptEntryStatus;
	// one-line drawer/summary copy
	summary: string;
	// the principle: why this shape makes nested data friendly
	why: string;
	desktop: string[];
	mobile: string[];
	editing: string[];
	// where the real code lives
	source: string;
	// how to put it on the site
	adoption: string;
	stories: ConceptStory[];
};

export const conceptStatusColors: Record<ConceptEntryStatus, { bg: string; color: string }> = {
	Concept: { bg: '#e8e9ff', color: '#2f356b' },
	Gallery: { bg: '#fde2f1', color: '#8a2f61' },
	Architecture: { bg: '#fef3c7', color: '#78350f' },
	Adopted: { bg: 'var(--tt-docs-accent-soft, #d7f5df)', color: 'var(--tt-docs-accent-ink, #0f5132)' }
};

export const conceptEntries: ConceptEntry[] = [
	{
		slug: 'focus-cards',
		title: 'Focus — one thing at a time',
		emoji: '🎯',
		status: 'Concept',
		summary: 'The focused thing owns the screen; children are big friendly cards; breadcrumbs go back up.',
		why:
			'Left-to-right nested trees ask people to read structure — indentation, brackets, depth — before they can read their own data. Focus flips that: you are always looking at exactly one thing, its children are cards you can tap, and the only structural idea is "inside". That is an idea everyone already has. Depth becomes a journey (with breadcrumbs) instead of a diagram.',
		desktop: [
			'Children lay out as a responsive card grid (210px minimum), so a wide screen shows a whole level at a glance.',
			'Leaf cards edit in place — the value editor is right on the card, no modal, no mode switch beyond view/edit.',
			'Subtrees that carry a kind render their template as the hero with a ✨ Rendered / 🔍 Data flip.'
		],
		mobile: [
			'The identical component: the grid collapses to one column and cards become full-width rows.',
			'Drilling is a tap; the ← chip and breadcrumb trail handle the way back — the same gesture language as every mobile settings app.',
			'Because only one level is ever visible, nothing horizontal ever overflows, at any depth.'
		],
		editing: [
			'View/edit is a prop; in edit mode every leaf card becomes its editor (magic input, stepper, switch).',
			'🗑️ recycle on every card, 🌱 grow button on the focused branch — same verbs as the live tree.',
			'All mutations flow through onThingChange(nextThing) — wire it to setThingtime and it edits real things.'
		],
		source: 'remix/app/components/Thingtime/concepts/FocusCardsViewer.tsx',
		adoption:
			'Drop-in: <FocusCardsViewer thing={getThingtime(path)} onThingChange={next => setThingtime(path, next)} edit={editMode} />. It could become the default mobile presentation of /things while the tree stays the developer view.',
		stories: focusStories
	},
	{
		slug: 'miller-columns',
		title: 'Columns — Finder for your things',
		emoji: '🗂️',
		status: 'Concept',
		summary: 'Miller columns: each level of nesting is a column, the selection trail reads left to right.',
		why:
			'People have navigated file systems this way for forty years — macOS Finder proved you can walk arbitrarily deep trees without ever rendering a tree. Columns show a thing\'s siblings and its children simultaneously, which the current indented view can\'t do without visual noise. The trail is the mental model: where am I, how did I get here, what else is here.',
		desktop: [
			'Root column plus one column per selected branch; the newest column scrolls into view automatically.',
			'Selecting a leaf opens a detail pane as the final column — type emoji, value editor, and the full path in mono.',
			'Columns are fixed-width and horizontally scrollable, so depth costs scroll, never layout breakage.'
		],
		mobile: [
			'Same component below 560px container width: only the deepest column renders, with ← Back and breadcrumb chips.',
			'This is exactly the iOS Settings pattern, so the muscle memory is free.',
			'Row previews (value snippets, child counts) keep context that the hidden columns would have shown.'
		],
		editing: [
			'Every column gets a 🌱 grow row in edit mode; every row gets 🗑️ on hover.',
			'The leaf detail pane hosts the real editors (magic input / stepper / switch).',
			'Stale selections self-heal: deleting a selected branch trims the trail to the deepest valid prefix.'
		],
		source: 'remix/app/components/Thingtime/concepts/MillerColumnsViewer.tsx',
		adoption:
			'Strong candidate for the desktop editor: mount it as an alternative "Columns" mode next to the tree on /things. The mobile fallback comes free from the same component.',
		stories: columnsStories
	},
	{
		slug: 'outline-document',
		title: 'Document — data that reads like a page',
		emoji: '📖',
		status: 'Concept',
		summary: 'Objects become headed sections, leaves become labelled lines, uniform arrays become tables.',
		why:
			'A lot of personal data wants to be *read*, not navigated: a recipe, a plan, a profile. This concept typesets the thing like a document — headings shrink with depth, labels sit in small caps, and arrays of same-shaped objects (the classic "list of plants") become actual tables. It proves nesting can be communicated with typography instead of indentation.',
		desktop: [
			'Heading scale (xl → sm) carries hierarchy; content never indents more than one soft rule, so width is preserved.',
			'Arrays of objects sharing keys render as tables with column headers; arrays of simple values become chips.',
			'Sections collapse from the ▾ caret, echoing the tree\'s collapse affordance.'
		],
		mobile: [
			'Tables restack into per-item cards (label/value rows) below 560px — no pinch-zooming a wide table.',
			'Field labels move above values so long text wraps naturally at full width.',
			'Reading order is identical to desktop; nothing reorders, only re-flows.'
		],
		editing: [
			'Every value line is live: text edits inline, numbers step, booleans switch — even inside table cells.',
			'Chips take 🗑️ per item and an Add chip; sections take grow/recycle on the heading row.',
			'Great "reading mode with benefits": view mode is genuinely pleasant to read aloud.'
		],
		source: 'remix/app/components/Thingtime/concepts/OutlineDocViewer.tsx',
		adoption:
			'Ideal default for viewing a shared thing (e.g. /things links you send a friend) — readable first, editable when it\'s yours. Could also power a "print/export" view almost unchanged.',
		stories: documentStories
	},
	{
		slug: 'form-sheet',
		title: 'Form — every thing is a settings page',
		emoji: '📋',
		status: 'Concept',
		summary: 'Top-level branches are section cards; leaves are labelled fields with the right control per type.',
		why:
			'Nobody is scared of a settings screen. Forms are the one structured-data UI that every person on earth has already used, so the fastest route to "data for everyone" is to make a thing look like the form it would have been. The type system picks the control: switch, stepper, magic input — the same editors the live tree uses, arranged like a sheet.',
		desktop: [
			'Sections flow in a responsive card grid (320px minimum), giving a dashboard-of-forms feel for wide things.',
			'Nested branches inline up to three levels with a soft left rule, then hand off to a drill-down view.',
			'Top-level loose leaves collect into a ✨ General card so nothing floats unanchored.'
		],
		mobile: [
			'Cards stack full-width in source order — the classic single-column settings screen.',
			'Field labels are small caps above the control, sized for thumbs.',
			'Switches and steppers are native-feeling tap targets; no keyboard needed until you edit text.'
		],
		editing: [
			'This concept is edit-first: view mode is just the same sheet with the controls locked.',
			'Add within any section (🌱), recycle any field (🗑️), grow new sections at the root.',
			'Because it\'s the current edit mode\'s closest cousin, it can replace it incrementally, thing by thing.'
		],
		source: 'remix/app/components/Thingtime/concepts/FormSheetViewer.tsx',
		adoption:
			'The natural evolution of the screenshot\'s edit mode: mount FormSheetViewer as the Edit presentation on /things and keep the tree behind the {} code-view toggle for developers.',
		stories: formStories
	},
	{
		slug: 'orbit-galaxy',
		title: 'Galaxy — things orbit their parent',
		emoji: '🪐',
		status: 'Concept',
		summary: 'The focused thing is the sun; children orbit as moons; tapping a moon refocuses the system.',
		why:
			'Spatial memory is the strongest memory most people have — we remember where things are long after we forget what they were called. Galaxy makes containment literal: children physically surround their parent, going deeper feels like flying closer, and the ↑ Up chip zooms back out. It\'s also simply the most joyful of the five, which matters for a product whose brand is 🦄.',
		desktop: [
			'A measured square canvas (up to 520px) with a dashed orbit ring; moons space themselves evenly.',
			'Hover lifts a moon; clicking a branch animates it into the centre via CSS position transitions.',
			'A kind-carrying focus (like the marketplace listing) renders its template beneath the canvas.'
		],
		mobile: [
			'The canvas shrinks with its container — bubbles scale down, the idea doesn\'t.',
			'Leaves open in a bottom sheet (the value editor card below the canvas), a native mobile pattern.',
			'Orbits cap at nine moons plus a "+n more" bubble that opens a scrollable list — no overlapping bubbles.'
		],
		editing: [
			'Leaf sheet hosts the real editors plus 🗑️; structure edits (grow/rename) intentionally defer to other modes.',
			'Best paired with Focus or Columns as a "map" mode rather than the primary editor.',
			'Pure CSS transitions — no canvas/WebGL — so it ships anywhere Chakra does.'
		],
		source: 'remix/app/components/Thingtime/concepts/OrbitCanvasViewer.tsx',
		adoption:
			'Perfect for the landing page demo and as a delightful "map of my things" mode on /things. Ask to mount it behind a 🪐 toggle next to the existing modes.',
		stories: galaxyStories
	},
	{
		slug: 'kind-gallery',
		title: 'Kind gallery — things that know how to look',
		emoji: '🎨',
		status: 'Gallery',
		summary: '60 data-type renderers across Social, Media, Commerce, Planning, Knowledge, Life, and Builder — modelled on the shapes the internet already uses everywhere.',
		why:
			'The other half of "data for everyone": once a thing carries (or matches) a kind, it stops looking like data at all. These are the templates a feed, a search result page, or a shared link can pick from automatically — posts, videos, products, orders, flights, weather, polls, workouts, definitions, changelogs, and fifty more, each modelled on a data shape people already know from the wider internet. Templates adapt many shapes (polymorphism) instead of demanding one schema, so real, messy, user-grown things still render.',
		desktop: [
			'Cards are container-responsive: the same component renders in a feed column, a search grid, or full-width.',
			'Comparison renders as a real table on wide containers; dashboard tiles use auto-fit grids and SVG sparklines.',
			'Everything is theme-token driven (--tt-*), so all eleven re-skin with Thingtime themes automatically.'
		],
		mobile: [
			'Comparison flips from table to stacked per-item cards via context.size — the pattern for every width-sensitive kind.',
			'Media kinds (video, listing, place) keep 16:9 / cover-image geometry at any width.',
			'Cards are single-column friendly with no fixed widths anywhere.'
		],
		editing: [
			'Renderers are read views; editing happens by flipping to any viewer concept (the ✨/🔍 flip in Focus/Columns/Form).',
			'A renderer never touches data — it adapts and displays. Mutations stay in the viewers/API layer.',
			'registerKindRenderer() is the whole extension API: users (and Lopu) can add kinds without touching the core.'
		],
		source: 'remix/app/components/Kinds/kindRenderers.tsx',
		adoption:
			'Wire into the feed: in PostList, try <RenderThing thing={post} fallback={<PostCard …/>}/> — kinds render themselves, everything else keeps today\'s card. Search results and /things pages can use the same dispatcher.',
		stories: kindGalleryStories
	},
	{
		slug: 'long-text-editor',
		title: 'Long text — a block editor everywhere',
		emoji: '📝',
		status: 'Adopted',
		summary: 'Editor.js block editing for every long-text input: the tree, all viewer concepts, and the feed composer.',
		why:
			'Long text is where one-line inputs stop being honest: people write plans, notes, and stories, not values. The block editor (Editor.js) gives every long string real paragraphs, headings, lists, checklists, and quotes — while the stored thing stays a plain, readable string via a deterministic blocks↔text round-trip. Data stays simple; editing stops being cramped. And when a value already is a block document ({ blocks: [...] }), it edits natively and renders through the rich-text kind.',
		desktop: [
			'Any string over ~160 characters (or containing a newline) opens as a block document in edit mode — in the Thingtime tree, Focus, Columns, Document, and Form.',
			'The + menu and inline toolbar offer header, list, checklist, and quote blocks; everything serialises to markdown-ish plain text ("## ", "- ", "- [x]", "> ", "---").',
			'The feed composer (What\'s on your mind?) is the block editor by default — posts still store plain text.'
		],
		mobile: [
			'Editor.js is touch-native: the + block menu and toolbar work as tap targets, and blocks reflow at any width.',
			'Short strings keep the one-line magic input, so quick edits stay quick on a phone.',
			'The stored string stays readable in every view mode — no rich-text lock-in on small screens.'
		],
		editing: [
			'String mode: string in → string out, on every change. The editor owns the text while mounted; remount (key) to replace it externally.',
			'Block mode: { blocks: [...] } in → { blocks: [...] } out, preserving sibling fields like kind: "rich-text".',
			'Pressing Enter inside a one-line value creates a newline — which upgrades that value to the block editor on its next edit.'
		],
		source: 'remix/app/components/Editor/LongTextEditor.tsx',
		adoption:
			'Already wired across the board: Thingtime.tsx (tree edit mode), concepts/LeafValueEditor (all five viewers), and Feed/PostComposer. New surfaces just render <LongTextEditor value={text} onValueChange={...}/>.',
		stories: longTextStories
	},
	{
		slug: 'render-pipeline',
		title: 'The pipeline — JSON in, anything out',
		emoji: '🔮',
		status: 'Architecture',
		summary: 'Store plain JSON things in Mongo → fetch through the API → resolve a renderer by kind or shape → render.',
		why:
			'This is the architecture that makes the whole vision hold together: things are pure JSON documents in the things collection (FUNDAMENTALS §1–3 — everything through the API), kind is just a field, and rendering is a registry lookup at display time. Because templates adapt shapes rather than owning schemas, the same document can render as a card in the feed, a page at its URL, and raw data in the editor — one source of truth, three faces. The element kind closes the loop: even the templates\' own medium (html/css) is expressible as a thing.',
		desktop: [
			'resolveKindRenderer(): explicit kind → alias → structural match(), first registered wins.',
			'adapt() returns canonical props or null; null falls through to the fallback (a nested viewer), so bad data degrades gracefully, never crashes.',
			'The element renderer whitelists tags/props/styles, strips on* handlers and javascript: URLs, and caps node count/depth — user-built components stay sandboxed to safe HTML.'
		],
		mobile: [
			'Renderers receive context.size (compact/card/full) instead of reading the viewport, so the same registry serves every surface, including native WebViews.',
			'The live demo here works on a phone: the JSON editor stacks above the render.'
		],
		editing: [
			'Editing a rendered thing = editing its JSON with any viewer concept; the render updates live (try the demo).',
			'Next step: a kind field editor in the context menu ("Turn into… 📝 post / 🏪 listing / …") that stamps kind and scaffolds the template\'s expected fields.',
			'Later: user-defined templates stored as element things — templates that are themselves data, shareable like themes.'
		],
		source: 'remix/app/components/Kinds/kindRegistry.tsx',
		adoption:
			'The registry ships ready: import { RenderThing } from "~/components/Kinds" anywhere. To go end-to-end, seed a few kind-carrying things via POST /api/v1/things and point a feed filter at them.',
		stories: pipelineStories
	}
];

export const getConceptEntryBySlug = (slug?: string | null) =>
	conceptEntries.find((entry) => entry.slug === slug);
