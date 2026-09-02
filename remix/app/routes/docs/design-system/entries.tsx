import type { DesignSystemStory } from './ThingContextMenuStories';
import { thingContextMenuStories } from './ThingContextMenuStories';
import { coreControlsEntries } from './entries/coreControls';
import { surfacesEntries } from './entries/surfaces';
import { navigationEntries } from './entries/navigation';
import { identityEntries } from './entries/identity';
import { practicesEntries } from './entries/practices';
import { brutalButtonStories } from './BrutalButtonStories';
import { builderBlocksStories } from './BuilderBlocksStories';
import { foundationsStories } from './FoundationsStories';
import { pageScaffoldStories } from './PageScaffoldStories';

// Registry for the design-system tab of the docs UI — storybook-style entries
// for Thingtime components. Each entry carries its stories plus the reference
// documentation tabs (API, guidelines, accessibility, tokens).

export type DesignSystemStatus = 'Proposed' | 'Reference' | 'Adopted';

export type PropRow = {
	name: string;
	type: string;
	defaultValue?: string;
	description: string;
};

export type PropTable = {
	title: string;
	source: string;
	rows: PropRow[];
};

export type KeyboardRow = {
	keys: string;
	action: string;
};

export type TokenRow = {
	token: string;
	usedFor: string;
	// swatch preview kind
	preview?: 'color' | 'shadow' | 'radius' | 'font';
};

export type DesignSystemEntry = {
	slug: string;
	title: string;
	status: DesignSystemStatus;
	summary: string;
	notes: string;
	anatomy: string[];
	stories: DesignSystemStory[];
	propTables: PropTable[];
	guidelines: {
		intro: string;
		dos: string[];
		donts: string[];
	};
	accessibility: string[];
	keyboard: KeyboardRow[];
	tokens: TokenRow[];
	adoption: string[];
};

export const designSystemStatusColors: Record<DesignSystemStatus, { bg: string; color: string }> = {
	Proposed: { bg: '#eef2f7', color: '#374151' },
	Reference: { bg: '#e8e9ff', color: '#2f356b' },
	Adopted: { bg: 'var(--tt-docs-accent-soft, #d7f5df)', color: 'var(--tt-docs-accent-ink, #0f5132)' }
};

export const designSystemEntries: DesignSystemEntry[] = [
	{
		slug: 'foundations',
		title: 'Design tokens',
		status: 'Adopted',
		summary:
			'The --tt-* vocabulary every Thingtime surface is built from: the colour ramp, the five-stop rainbow and its gradients, four font roles, the radius scale, both shadow languages, and the motion switch. A theme is a JSON document; themeToCssVars() turns it into CSS custom properties on <html>, so the whole app re-skins at runtime without rebuilding anything.',
		notes:
			'Live everywhere: the ThemeHost writes themeToCssVars(resolveTheme(base, patch)) on <html>, mirrors a snapshot to localStorage for the pre-paint script, and the /api/v1/themes endpoints store/share the same document shape. The swatches in these stories read the live vars — switch themes in settings and this page re-paints.',
		anatomy: [
			'Text ramp — ink (headings) → text (body) → muted (hints/eyebrows) → faint (disabled/shortcuts): four steps, never ad-hoc greys.',
			'Chrome — border + border-light hairlines, the surface family (surface/alt/hover) for washes and insets, card for raised surfaces, page-bg behind everything.',
			'Accent + signals — accent/accent-tint/accent-contrast for CTAs and selection, link for URLs, positive/danger/warning for meaning.',
			'Rainbow — five stops (red amber green blue purple) plus two prebuilt gradients: --tt-gradient-rainbow (blue-first, seamless tile, for borders/buttons) and --tt-gradient-rainbow-x (red-first, for headline text).',
			'Typography — display / heading / body / mono roles as font tokens; the default theme loads Space Grotesk, Hanken Grotesk, and JetBrains Mono, Fable collapses to the system stack at 800/900.',
			'Radius scale — xs 7 · sm 9 · md 12 · lg 16 · xl 20 · 2xl 26 · pill, all multiplied by the theme radiusScale (Fable = 0 = square).',
			'Shadows — the themed elevation set (card/panel/popover/toast) follows the dialect (soft vs hard); the hard trio (3/5/8px ink offsets) is always brutalist.',
			'Motion — --tt-rainbow-anim carries the gradient animation (or none), --tt-anim-speed the UI transition base, --tt-motion a 0/1 flag for JS.',
			'Window chrome — traffic-light colours/radii for editor windows; unset colours follow rainbow stops 1/2/3.'
		],
		stories: foundationsStories,
		propTables: [
			{
				title: 'TtTheme (the theme document)',
				source: 'remix/app/theme/tokens.ts',
				rows: [
					{ name: 'colors', type: 'TtThemeColors', description: 'Every named colour above plus the rainbow: [string ×5] and the dark-panel set. Plain CSS strings, sanitised on the way in.' },
					{ name: 'fonts', type: '{ heading, body, mono, display }', description: 'Font family names from the curated list; empty string = system stack. Resolved to full stacks by fontFamilyCss().' },
					{ name: 'general.radiusScale', type: 'number', defaultValue: '1', description: 'Multiplies the whole radius scale. 0 = square (Fable), 1 = Prism, up to 2.5 for extra-soft themes.' },
					{ name: 'general.borderWidth', type: 'number', defaultValue: '1', description: 'Hairline width for app chrome → --tt-border-w (and --tt-border-w-bold = max(2, w)). Fable uses 2.' },
					{ name: 'general.shadow', type: "'soft' | 'hard'", defaultValue: "'soft'", description: 'The dialect switch: the themed shadow set renders soft blurs or hard ink offsets.' },
					{ name: 'general.motion / animSpeed', type: 'boolean / number', defaultValue: 'true / 200', description: 'Master switch for decorative motion (--tt-rainbow-anim: none when off) and the base UI transition in ms.' },
					{ name: 'general.pet', type: 'boolean', defaultValue: 'true', description: 'Mounts the app-wide decorative pet (components/Pets). Separate from motion: motion off leaves it still, pet off unmounts it. Two tiers, because it decides a first paint: --tt-pet-display carries it through the pre-paint snapshot, then the component unmounts once the stored value is readable. Custom CSS scopes to .tt-pet.' },
					{ name: 'general.iconStyle', type: "'emoji' | 'lucide'", defaultValue: "'emoji'", description: 'UI icon language for surfaces that support both.' },
					{ name: 'windows', type: 'TtThemeWindows', description: 'Editor-window traffic lights: per-button colour ("" = follow rainbow stop 1/2/3) and radius.' },
					{ name: 'resolveTheme(base, patch)', type: 'helper', description: 'Merges a user/API patch over a builtin, sanitising every value (colours through sanitizeCssValue, fonts against the curated list, numbers clamped). Shared themes are untrusted input.' },
					{ name: 'themeToCssVars(theme)', type: 'helper', description: 'The single mapping from document → --tt-* vars. New tokens are added HERE, nowhere else.' },
					{ name: 'BUILTIN_THEMES', type: 'TtTheme[]', description: 'Thingtime (default), Fable, Prism, Midnight — the presets the stories re-skin under.' }
				]
			},
			{
				title: 'Rainbow helpers',
				source: 'remix/app/theme/rainbow.ts',
				rows: [
					{ name: 'RAINBOW', type: 'string', description: 'var(--tt-gradient-rainbow, …) — blue-first 90deg looping gradient for borders, buttons, progress bars. Tiles seamlessly under the moving-rainbow animation.' },
					{ name: 'RAINBOW_TEXT', type: 'string', description: 'var(--tt-gradient-rainbow-x, …) — red-first gradient for animated headline text (background-clip: text).' },
					{ name: 'RAINBOW_CONIC', type: 'string', description: 'Conic gradient over the five stop vars — spinner rings.' },
					{ name: 'RAINBOW_VARS', type: 'string[5]', description: 'The individual stops as var() strings with literal fallbacks — depth guides, dot accents.' },
					{ name: 'RAINBOW_PALETTE', type: '[string ×5]', description: 'The raw default hexes. Only for seeding theme documents — components import the var() forms above instead.' }
				]
			}
		],
		guidelines: {
			intro:
				'One vocabulary, two dialects, any theme. Components never own colours, radii, shadows, or fonts — they read tokens, and every token read is written var(--tt-x, <literal>) with the Thingtime default as the fallback so first paint is right before the ThemeHost runs. Prism (soft chrome) and Fable (neo-brutalist) are not two component sets: they are the same tokens with different values, so a surface built honestly from tokens speaks both dialects for free.',
			dos: [
				'Read every colour/radius/shadow/font through its --tt-* var with the matching Thingtime literal fallback — var(--tt-ink, #16161a).',
				'Use the themed shadow + radius tokens (shadow-card/panel/popover, radius-xs…2xl) so your surface follows the dialect switch automatically.',
				'Import rainbow gradients from ~/theme/rainbow (RAINBOW / RAINBOW_TEXT / RAINBOW_CONIC) — one definition, themable stops.',
				'Animate gradients only via var(--tt-rainbow-anim, …) so the theme motion switch (and reduced-motion themes) can turn everything off in one place.',
				'Stay on the four-step text ramp (ink/text/muted/faint) — if a grey is not one of those four, it is not in the system.',
				'Run every stored or shared theme through resolveTheme() — its sanitisers are what make user themes safe to inject as CSS.'
			],
			donts: [
				'Don’t hardcode the brand hexes (#f34a4a, hotpink, …) — they are theme values; use the var() forms.',
				'Don’t fall back to Chakra palette colours (gray.500, blackAlpha.*) — the fallback must be the Thingtime literal, or custom themes and the docs page drift apart.',
				'Don’t invent radii or shadows between the steps — the scale is the contract; Fable relies on every radius being a multiple of the scale to go square.',
				'Don’t use the always-hard trio (--tt-shadow-hard-sm/-lg, --tt-border-w-chunky) for product chrome — that is the marketing dialect; product surfaces use the themed set.',
				'Don’t add a --tt-* var anywhere except themeToCssVars() — scattered setProperty calls break the snapshot/pre-paint path.'
			]
		},
		accessibility: [
			'The default ramp keeps ink (#16161a) and text (#5a5a66) above WCAG AA on card and surface backgrounds; muted/faint are for secondary text and never the only carrier of essential information.',
			'general.motion: false resolves --tt-rainbow-anim to none — every decorative animation must ride that var so one switch stops the motion (pair it with prefers-reduced-motion in new surfaces).',
			'Rainbow gradients are decorative: headline text using background-clip keeps real text content underneath, so screen readers and find-in-page are unaffected.',
			'Colour never carries meaning alone — danger pairs with position (last section) and wording, positive/warning pair with icons or labels.',
			'Shared themes are sanitised (resolveTheme) but not contrast-checked — theme authors own their contrast; the builtin four are tuned.',
			'All four font roles end in real system fallback stacks, so the page is readable before webfonts arrive (and when a theme names no font).'
		],
		keyboard: [{ keys: '—', action: 'Tokens are purely presentational; no keyboard surface of their own.' }],
		tokens: [
			{ token: '--tt-ink', usedFor: 'Headings, primary labels, hard-shadow ink', preview: 'color' },
			{ token: '--tt-text', usedFor: 'Body copy', preview: 'color' },
			{ token: '--tt-muted', usedFor: 'Hints, eyebrows, meta text', preview: 'color' },
			{ token: '--tt-faint', usedFor: 'Disabled text, carets, shortcut labels', preview: 'color' },
			{ token: '--tt-border', usedFor: 'Card + control borders', preview: 'color' },
			{ token: '--tt-border-light', usedFor: 'Hairline dividers', preview: 'color' },
			{ token: '--tt-surface', usedFor: 'Page wash', preview: 'color' },
			{ token: '--tt-surface-alt', usedFor: 'Inset panels, pills, segmented controls', preview: 'color' },
			{ token: '--tt-surface-hover', usedFor: 'Row + control hover', preview: 'color' },
			{ token: '--tt-card', usedFor: 'Raised card surfaces', preview: 'color' },
			{ token: '--tt-page-bg', usedFor: 'Document background', preview: 'color' },
			{ token: '--tt-accent', usedFor: 'Primary CTA, selection, builder chrome', preview: 'color' },
			{ token: '--tt-accent-tint', usedFor: 'Accent hover wash', preview: 'color' },
			{ token: '--tt-accent-contrast', usedFor: 'Text on accent', preview: 'color' },
			{ token: '--tt-link', usedFor: 'Links, url values', preview: 'color' },
			{ token: '--tt-positive', usedFor: 'Success text', preview: 'color' },
			{ token: '--tt-positive-soft', usedFor: 'Success pill fill', preview: 'color' },
			{ token: '--tt-danger', usedFor: 'Destructive actions, errors', preview: 'color' },
			{ token: '--tt-warning', usedFor: 'Caution highlights', preview: 'color' },
			{ token: '--tt-rainbow-1', usedFor: 'Rainbow stop — red', preview: 'color' },
			{ token: '--tt-rainbow-2', usedFor: 'Rainbow stop — amber', preview: 'color' },
			{ token: '--tt-rainbow-3', usedFor: 'Rainbow stop — green', preview: 'color' },
			{ token: '--tt-rainbow-4', usedFor: 'Rainbow stop — blue', preview: 'color' },
			{ token: '--tt-rainbow-5', usedFor: 'Rainbow stop — purple', preview: 'color' },
			{ token: '--tt-gradient-rainbow', usedFor: 'Blue-first looping gradient (borders, buttons, progress)', preview: 'color' },
			{ token: '--tt-gradient-rainbow-x', usedFor: 'Red-first gradient for animated headline text', preview: 'color' },
			{ token: '--tt-dark-bg', usedFor: 'Dark panels (developer sections) — background', preview: 'color' },
			{ token: '--tt-dark-chrome', usedFor: 'Dark panels — chrome/code background', preview: 'color' },
			{ token: '--tt-dark-border', usedFor: 'Dark panels — borders', preview: 'color' },
			{ token: '--tt-dark-text', usedFor: 'Dark panels — text', preview: 'color' },
			{ token: '--tt-dark-muted', usedFor: 'Dark panels — muted text', preview: 'color' },
			{ token: '--tt-dark-accent', usedFor: 'Dark panels — accent (green)', preview: 'color' },
			{ token: '--tt-font-heading', usedFor: 'Headings + UI chrome (Space Grotesk default)', preview: 'font' },
			{ token: '--tt-font-body', usedFor: 'Body copy (Hanken Grotesk default)', preview: 'font' },
			{ token: '--tt-font-mono', usedFor: 'Keys, paths, eyebrows, code (JetBrains Mono default)', preview: 'font' },
			{ token: '--tt-font-display', usedFor: 'Landing display type (system stack default)', preview: 'font' },
			{ token: '--tt-radius-xs', usedFor: 'Chips, tiny controls (7 × scale)', preview: 'radius' },
			{ token: '--tt-radius-sm', usedFor: 'Inputs, rows (9 × scale)', preview: 'radius' },
			{ token: '--tt-radius-md', usedFor: 'Cards, buttons (12 × scale)', preview: 'radius' },
			{ token: '--tt-radius-lg', usedFor: 'Panels, content cards (16 × scale)', preview: 'radius' },
			{ token: '--tt-radius-xl', usedFor: 'Large panels (20 × scale)', preview: 'radius' },
			{ token: '--tt-radius-2xl', usedFor: 'Hero cards (26 × scale)', preview: 'radius' },
			{ token: '--tt-radius-pill', usedFor: 'Pills + badges (999px; 0 when radiusScale is 0)', preview: 'radius' },
			{ token: '--tt-border-w', usedFor: 'Hairline border width for app chrome' },
			{ token: '--tt-border-w-bold', usedFor: 'Emphasised border width (max(2px, border-w))' },
			{ token: '--tt-border-w-chunky', usedFor: 'The 3px Fable/marketing border' },
			{ token: '--tt-things-badge-padding', usedFor: 'Padding of the /things browse-control pills' },
			{ token: '--tt-shadow-card', usedFor: 'Resting card elevation (dialect-aware)', preview: 'shadow' },
			{ token: '--tt-shadow-panel', usedFor: 'Large panel elevation (dialect-aware)', preview: 'shadow' },
			{ token: '--tt-shadow-popover', usedFor: 'Popovers + menus (dialect-aware)', preview: 'shadow' },
			{ token: '--tt-shadow-toast', usedFor: 'Toasts (dialect-aware)', preview: 'shadow' },
			{ token: '--tt-shadow-hard-sm', usedFor: 'Always-hard 5px ink offset (brutalist CTAs)', preview: 'shadow' },
			{ token: '--tt-shadow-hard-lg', usedFor: 'Always-hard 8px ink offset (brutalist cards, hover lift)', preview: 'shadow' },
			{ token: '--tt-traffic-close', usedFor: 'Editor window close button (defaults to rainbow-1)', preview: 'color' },
			{ token: '--tt-traffic-minimise', usedFor: 'Editor window minimise button (defaults to rainbow-2)', preview: 'color' },
			{ token: '--tt-traffic-maximise', usedFor: 'Editor window maximise button (defaults to rainbow-3)', preview: 'color' },
			{ token: '--tt-anim-speed', usedFor: 'Base UI transition duration' },
			{ token: '--tt-rainbow-anim', usedFor: 'The moving-rainbow animation shorthand, or none when motion is off' },
			{ token: '--tt-motion', usedFor: '0/1 motion flag readable from JS' }
		],
		adoption: [
			'Done — tokens.ts is the single source of truth; the ThemeHost writes themeToCssVars() on <html> and mirrors the snapshot to localStorage (TT_THEME_SNAPSHOT_KEY) so the pre-paint script prevents theme flash.',
			'Done — themes are shareable documents through /api/v1/themes; resolveTheme() sanitises every stored/shared value before it becomes CSS.',
			'Done — the canonical gradients live in ~/theme/rainbow; the card recipe in ~/theme/card (CARD_STYLES).',
			'Ongoing — legacy surfaces still carrying hardcoded brand hexes or Chakra greys get migrated to var() reads as they are touched (the fallback-literal rule makes this a safe mechanical change).'
		]
	},
	{
		slug: 'page-scaffold',
		title: 'Page scaffold',
		status: 'Adopted',
		summary:
			'The canonical page skeleton: PageShell centres a width-scaled column on the --tt-surface wash and clears the fixed nav with PAGE_TOP_CLEARANCE; PageHeader stacks the mono eyebrow over the animated rainbow (or ink) h1; CARD_STYLES draws every content card the same way. One extraction of the idiom every conforming page used to hand-copy.',
		notes:
			'Live across the app: SettingsPage, Feed, post/media permalinks, status, migrations, builder, admin and the rest all render PageShell + PageHeader. It exists because top clearance and the surface wash had drifted into pt 28/32, 90px, 108px, and 200px-margin variants — now there is exactly one definition.',
		anatomy: [
			'Shell — full-width Flex on the surface wash (min-height 100vh), centring one column; paddingTop = PAGE_TOP_CLEARANCE = safe-area + var(--tt-nav-clearance, 54px), so content never slides under the fixed nav.',
			'Column — max-width from the closed PageShellWidth scale (680–1400), px 4 gutters, rowGap 4, whiteSpace normal (resetting Main’s global pre-wrap), pb 12 so pages never end flush at the fold.',
			'Header — mono uppercase eyebrow (10px, 0.08em) naming the place, then the h1: rainbow variant clips the animated --tt-gradient-rainbow-x into the text, ink variant is solid --tt-ink.',
			'After slot — optional right-aligned node on the title baseline (badges, counts, actions); wraps under the title on narrow screens.',
			'Subtitle — optional --tt-text sm/1.6 paragraph capped at 720px for measure.',
			'Cards — content sections are CARD_STYLES boxes (card bg, 1px --tt-border, radius-lg, shadow-card) with hairline (--tt-border-light) label/value rows inside.'
		],
		stories: pageScaffoldStories,
		propTables: [
			{
				title: '<PageShell/>',
				source: 'remix/app/components/Layout/PageShell.tsx',
				rows: [
					{ name: 'children', type: 'React.ReactNode', description: 'The page content, rendered inside the centred column.' },
					{ name: 'width', type: 'PageShellWidth', defaultValue: '680', description: 'Column max-width from the closed scale 680 | 760 | 860 | 920 | 1100 | 1180 | 1280 | 1400. Pick the narrowest step that fits the densest row — arbitrary numbers are a type error by design.' },
					{ name: 'background', type: 'string', defaultValue: "'var(--tt-surface, #fafafb)'", description: 'Override the page wash — only for deliberately different surfaces (e.g. a pure-white embed page).' },
					{ name: 'columnProps', type: 'Record<string, unknown>', description: 'Extra Chakra props for the inner column (rowGap, alignItems, minWidth: 0 for wide tables, …).' }
				]
			},
			{
				title: '<PageHeader/>',
				source: 'remix/app/components/Layout/PageShell.tsx',
				rows: [
					{ name: 'eyebrow', type: 'string', description: 'The place label above the title — lowercase source text, middot-separated hierarchy ("settings · appearance"); CSS uppercases it.' },
					{ name: 'title', type: 'React.ReactNode', description: 'The h1. Keep it short; it carries the gradient in the rainbow variant.' },
					{ name: 'variant', type: "'rainbow' | 'ink'", defaultValue: "'rainbow'", description: 'Rainbow clips the animated brand gradient into the text (respecting --tt-rainbow-anim); ink is solid — for utility/admin/secondary pages.' },
					{ name: 'subtitle', type: 'React.ReactNode', description: 'Optional supporting paragraph (--tt-text, sm, 1.6, max 720px).' },
					{ name: 'after', type: 'React.ReactNode', description: 'Optional right side of the title row — badges, counts, primary actions. Baseline-aligned, wraps on narrow screens.' }
				]
			},
			{
				title: 'Constants',
				source: 'remix/app/components/Layout/PageShell.tsx · remix/app/theme/card.ts',
				rows: [
					{ name: 'PAGE_TOP_CLEARANCE', type: 'string', description: 'calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px)) — the one blessed way to clear the fixed nav. Never re-derive it.' },
					{ name: 'PageShellWidth', type: 'type', description: 'The closed width scale as a union type — 680 · 760 · 860 · 920 · 1100 · 1180 · 1280 · 1400.' },
					{ name: 'CARD_STYLES', type: 'const (Chakra props)', description: 'The tt-card look: card bg, 1px --tt-border, radius-lg, shadow-card. Spread it ({...CARD_STYLES}) so a token change can’t leave sibling pages drifted.' }
				]
			}
		],
		guidelines: {
			intro:
				'Every standard page is the same three moves: shell, header, cards. The scaffold owns geometry (clearance, centring, width, gutters) so pages own only content. If a page needs different geometry, that is a conversation about the scaffold — not a hand-rolled copy with its own padding.',
			dos: [
				'Start every standard page with <PageShell width={…}><PageHeader …/> — including error and empty states.',
				'Use the rainbow header on primary destinations (feed, settings, docs) and the ink variant on utility/admin/secondary surfaces so the gradient stays special.',
				'Use PAGE_TOP_CLEARANCE for any bespoke surface that cannot use PageShell — it is exported precisely so nothing re-derives nav clearance.',
				'Build content sections from CARD_STYLES cards with --tt-border-light hairline rows inside; the card border is the strong line, hairlines are the quiet ones.',
				'Pick the narrowest PageShellWidth that fits your densest row; pass columnProps={{ minWidth: 0 }} when a wide table needs to shrink instead of overflow.'
			],
			donts: [
				'Don’t hand-roll top clearance — the pt 28/32, 90px, 108px, and 200px-margin variants this replaced were all bugs on some device.',
				'Don’t rely on Main’s global pre-wrap inside a page — the shell resets whiteSpace to normal; if you need pre-wrap for actual preformatted content, opt in locally.',
				'Don’t use Chakra grey fallbacks (gray.50 washes, gray.200 borders) — the scaffold is tokens + Thingtime literals; a Chakra grey breaks custom themes quietly.',
				'Don’t put a second rainbow headline on one page — one animated gradient per screen.',
				'Don’t invent widths between the scale steps or max-width your own column inside the shell — nested max-widths fight the scale.'
			]
		},
		accessibility: [
			'The title renders as a real h1 (one per page) with the eyebrow as a separate label — the heading text stays plain for screen readers even under the gradient clip.',
			'The rainbow animation rides var(--tt-rainbow-anim), so the theme motion switch stops it globally; the ink variant has no motion at all.',
			'PAGE_TOP_CLEARANCE includes the iOS safe-area inset, keeping content out of the notch/home-indicator regions in the wrapped app.',
			'Column gutters (px 4) keep text off screen edges at every viewport; subtitle measure is capped at 720px for readability.',
			'Hairline label/value rows are real text in a grid — not tables of divs pretending — so copy/paste and find-in-page behave.'
		],
		keyboard: [{ keys: '—', action: 'Layout only; the scaffold adds no keyboard surface of its own.' }],
		tokens: [
			{ token: '--tt-surface', usedFor: 'The page wash behind everything', preview: 'color' },
			{ token: '--tt-card', usedFor: 'Card surfaces (CARD_STYLES bg)', preview: 'color' },
			{ token: '--tt-border', usedFor: 'Card borders', preview: 'color' },
			{ token: '--tt-border-light', usedFor: 'Hairline rows inside cards', preview: 'color' },
			{ token: '--tt-radius-lg', usedFor: 'Card corner radius', preview: 'radius' },
			{ token: '--tt-shadow-card', usedFor: 'Card elevation', preview: 'shadow' },
			{ token: '--tt-ink', usedFor: 'Ink-variant titles, row values', preview: 'color' },
			{ token: '--tt-text', usedFor: 'Subtitles', preview: 'color' },
			{ token: '--tt-muted', usedFor: 'Eyebrows, row labels', preview: 'color' },
			{ token: '--tt-font-mono', usedFor: 'Eyebrows + hairline row labels', preview: 'font' },
			{ token: '--tt-font-heading', usedFor: 'The h1', preview: 'font' },
			{ token: '--tt-gradient-rainbow-x', usedFor: 'The rainbow headline fill', preview: 'color' },
			{ token: '--tt-rainbow-anim', usedFor: 'Headline gradient motion (none when motion is off)' },
			{ token: '--tt-nav-clearance', usedFor: 'Fixed-nav height the shell clears (54px default)' },
			{ token: '--thingtime-safe-area-top', usedFor: 'iOS safe-area inset added to the clearance' }
		],
		adoption: [
			'Done — PageShell/PageHeader extracted verbatim from the SettingsPage/Feed idiom and adopted by the conforming pages (settings, feed, permalinks, status, migrations, builder, admin, raw, …).',
			'Done — CARD_STYLES unified the tt-card look across Schemas, Search, and admin panels.',
			'Ongoing — remaining hand-rolled pages migrate to the scaffold as they are touched; any clearance value that is not PAGE_TOP_CLEARANCE is a bug to fix on sight.'
		]
	},
	...coreControlsEntries,
	...surfacesEntries,
	...navigationEntries,
	...identityEntries,
	{
		slug: 'brutal-button',
		title: 'Brutal Button',
		status: 'Adopted',
		summary:
			'The Fable-dialect CTA from the v2 landing: chunky --tt-ink border, hard offset shadow, and the signature hover lift — the button translates (-2px, -2px) while its shadow grows from 5px to 8px, so it lifts off the page instead of drifting. Three fills (primary accent / secondary white / ink) over one chassis; renders as <button> or, with href, as <a>.',
		notes:
			'Live on the landing page (waitlist CTA, demo links, docs/API buttons) and other marketing surfaces. It is deliberately NOT themed by the dialect switch: it always speaks Fable (hard trio + chunky border), which is exactly why it stays off product chrome.',
		anatomy: [
			'Chassis — inline-flex, 13px 20px padding, 800-weight display type at 15px, var(--tt-border-w-chunky, 3px) solid ink border, radius 0.',
			'Shadow — var(--tt-shadow-hard-sm, 5px 5px 0 ink) at rest; shadow={false} removes it (and the lift) for quiet placements.',
			'Fills — primary: --tt-accent bg with --tt-accent-contrast text; secondary: --tt-card bg, ink text, --tt-accent-tint hover wash; ink: --tt-ink bg, card text.',
			'Hover lift — transform translate(-2px, -2px) + shadow grows to --tt-shadow-hard-lg (8px): the shadow’s far edge stays planted, reading as lift.',
			'Element duality — href switches the underlying element to <a> (target/rel pass through); everything else renders a real <button>.',
			'Content — children flow with an 8px gap, so "label + emoji/arrow" pairs space themselves.'
		],
		stories: brutalButtonStories,
		propTables: [
			{
				title: '<BrutalButton/>',
				source: 'remix/app/components/Landing/BrutalButton.tsx',
				rows: [
					{ name: 'variant', type: "'primary' | 'secondary' | 'ink'", defaultValue: "'primary'", description: 'The fill: accent conversion CTA, white companion (accent-tint hover), or maximum-contrast ink. Unknown values fall back to primary.' },
					{ name: 'href', type: 'string', description: 'Renders the same styling as an <a> for CTAs that navigate — real link semantics (new tab, copy link, middle-click).' },
					{ name: 'target / rel', type: 'string / string', description: 'Passed through to the anchor form. Set rel="noopener noreferrer" yourself when target="_blank".' },
					{ name: 'onClick', type: '(event) => void', description: 'Click handler for the button form (also fires on the anchor form before navigation).' },
					{ name: 'shadow', type: 'boolean', defaultValue: 'true', description: 'false drops the hard shadow AND the hover lift — the quiet variant for dense placements.' },
					{ name: 'chakras / …props', type: 'Chakra props', description: 'Style overrides spread onto the Box (chakras last, so it wins). Use sparingly — the chassis is the identity.' }
				]
			}
		],
		guidelines: {
			intro:
				'BrutalButton is the marketing voice: loud, square, planted. It belongs on the landing page, launch/campaign surfaces, and docs-adjacent promos — anywhere Thingtime is selling itself. Product chrome (settings, menus, editors, dialogs) uses the default themed Button so it follows the active theme’s dialect; a brutal CTA inside the app would shout Fable in a Prism room.',
			dos: [
				'Use it for marketing CTAs: waitlist, “Open the app”, docs/API keys, campaign buttons.',
				'Reserve exactly one primary (accent) button per section; support it with secondary/ink so the hierarchy reads at a glance.',
				'Use href for CTAs that navigate — link semantics matter for “Read the docs” more than button semantics.',
				'Keep labels short and 800-weight-worthy — two to four words, optionally one emoji or arrow.',
				'Use shadow={false} when several buttons sit tightly together and six hard shadows would tartan the layout.'
			],
			donts: [
				'Don’t use it in product chrome — settings, context menus, toolbars, and dialogs use the themed Button (tt.Button) that follows the dialect switch.',
				'Don’t soften it — no border-radius overrides, no soft shadows; if it needs rounding it wanted the themed Button.',
				'Don’t re-implement the lift elsewhere with different offsets — rest 5px → hover 8px with (-2px, -2px) is the physics; other numbers read as drift.',
				'Don’t stack more than one accent-filled brutal CTA in a viewport section — primary means singular.'
			]
		},
		accessibility: [
			'Renders a native <button> (or <a> with href) — focus, Enter/Space activation, and form/link semantics come from the platform, not re-implemented handlers.',
			'The 3px ink border gives the control a hard visible boundary at every fill; primary text sits on --tt-accent-contrast for a tuned pair.',
			'The hover lift is transform + shadow only (~120ms) — no layout shift, nothing moves for keyboard users until they activate.',
			'The anchor form passes rel/target through untouched — callers own noopener on _blank links.',
			'Emoji in labels are decorative garnish after the words — the text carries the meaning on its own.'
		],
		keyboard: [
			{ keys: 'Tab', action: 'Focus the button (native order)' },
			{ keys: 'Enter / Space', action: 'Activate the button form (Enter follows the anchor form like any link)' }
		],
		tokens: [
			{ token: '--tt-accent', usedFor: 'Primary fill', preview: 'color' },
			{ token: '--tt-accent-contrast', usedFor: 'Primary label text', preview: 'color' },
			{ token: '--tt-accent-tint', usedFor: 'Secondary hover wash', preview: 'color' },
			{ token: '--tt-card', usedFor: 'Secondary fill / ink label text', preview: 'color' },
			{ token: '--tt-ink', usedFor: 'Border, ink fill, shadow colour', preview: 'color' },
			{ token: '--tt-border-w-chunky', usedFor: 'The 3px chassis border' },
			{ token: '--tt-shadow-hard-sm', usedFor: 'Resting shadow (5px 5px 0)', preview: 'shadow' },
			{ token: '--tt-shadow-hard-lg', usedFor: 'Hover-lift shadow (8px 8px 0)', preview: 'shadow' },
			{ token: '--tt-font-display', usedFor: 'The 800-weight label type', preview: 'font' }
		],
		adoption: [
			'Done — all landing-page CTAs (waitlist, live demo, ecosystem, developers, back-us sections) render BrutalButton.',
			'Done — the marketing-only rule holds: product chrome keeps the themed Button; no BrutalButton ships inside app surfaces.',
			'Next — campaign/launch pages reuse it as they land, importing from ~/components/Landing/BrutalButton rather than copying the chassis.'
		]
	},
	{
		slug: 'thing-context-menu',
		title: 'Thing Context Menu',
		status: 'Adopted',
		summary:
			'The generalised options menu for any thing: change its type, share it, apply default/template values, duplicate, copy, cut, paste, modify, change permissions, or recycle it — reachable by hover, right-click, or programmatically as a modal, with infinite drill-down submenus in one fixed window.',
		notes:
			'Live in the Thingtime UI: every thing header renders ThingContextMenuTrigger (hover/tap the wizard icon or right-click the thing row), and the new-child seedling row uses the same surface to pick a type. It replaced the old SettingsMenu.',
		anatomy: [
			'Header — mono thing path, its type, and pin (popover/context) or close (modal). The header is also the drag handle: grab it to move the window (made for pinned mode).',
			'Back row — appears when drilled below the root level; shows the level title and pops one level on click, ← or Esc.',
			'Sections — Mode, then Type, Value, Clipboard, Sharing, and Danger last. Section order is fixed by the model so muscle memory transfers between presentations.',
			'Action rows — emoji icon, label, optional hint line, optional shortcut label, a ✓ on the selected radio option, and a ▸ when the action drills into a submenu.',
			'Drill levels — submenus never fly out or indent: the whole surface navigates down a level, infinitely deep, inside one window. The size locks on the first drill; levels scroll inside the frame.',
			'Zones — every atomic thing has virtual bounding boxes (thingZones): key, value, and the whole thing. Right-click resolves the zone it hit (badged in the header; key-zone clicks lead with key verbs) and the same boxes are the geometry layer for drag/drop.',
			'Resize grip — bottom-right corner resizes the window; content scrolls inside whatever size it gets.',
			'Danger zone — destructive actions render in --tt-danger, always in the last section, separated by a divider.'
		],
		stories: thingContextMenuStories,
		propTables: [
			{
				title: '<ThingContextMenu/>',
				source: 'remix/app/components/Thingtime/ContextMenu/ThingContextMenu.tsx',
				rows: [
					{ name: 'model', type: 'ThingContextMenuModel', description: 'The sections + actions to render. Submenus recurse infinitely; build with buildThingContextMenuModel() or hand-craft.' },
					{ name: 'open', type: 'boolean', description: 'Whether the menu is visible. The component renders nothing when closed; reopening resets drill, drag, and size.' },
					{ name: 'presentation', type: "'popover' | 'context' | 'modal'", defaultValue: "'popover'", description: 'How the surface is placed: anchored under a trigger, fixed at a pointer position, or centred over a scrim.' },
					{ name: 'meta', type: '{ path?, type? }', description: 'Thing identity for the header.' },
					{ name: 'position', type: '{ x, y }', description: 'Pointer coordinates for the context presentation; clamped to the viewport automatically.' },
					{ name: 'pinned / onPinnedChange', type: 'boolean / (next) => void', description: 'Pin state keeps the menu open across actions and hover-out; hidden in the modal presentation.' },
					{ name: 'onAction', type: '({ action, section, path }) => void', description: 'Fired for every leaf activation. path is the drill trail (action ids); switch on action.command and read action.payload.' },
					{ name: 'onClose', type: '() => void', description: 'Requested by Escape at the root level, the close button, scrim clicks, and post-action auto-close.' },
					{ name: 'closeOnAction', type: 'boolean', defaultValue: 'true', description: 'Auto-close after a leaf action fires (unless pinned).' },
					{ name: 'defaultDrillPath', type: 'string[]', description: 'Open already drilled to this path of action ids (docs/tests).' },
					{ name: 'onSurfaceMouseEnter / Leave', type: '() => void', description: 'Hover-linger wiring; supplied by useThingContextMenu for popovers.' },
					{ name: 'width / zIndex', type: 'number / number', defaultValue: '264 / 1400', description: 'Initial surface width and stacking context; the resize grip takes over from there.' }
				]
			},
			{
				title: '<ThingContextMenuTrigger/> (live integration)',
				source: 'remix/app/components/Thingtime/ContextMenu/ThingContextMenuTrigger.tsx',
				rows: [
					{ name: 'variant', type: "'thing' | 'new-child'", defaultValue: "'thing'", description: 'Full options menu on thing headers, or the type picker on the new-child seedling row.' },
					{ name: 'editMode / setEditMode / readonly', type: 'boolean / updater / boolean', description: 'Mode state drives the model (read-only menus drop mutating sections).' },
					{ name: 'fullPath / path / parent / parentPath / thing / thingType', type: 'thing context', description: 'Everything the live commands need: duplicate, paste, share, and the header meta.' },
					{ name: 'onType / onAddChild / onDelete', type: 'handlers', description: 'Thingtime.tsx handlers: change-type → onChangeType, add-child → addNewChild, recycle/cut → deleteValue.' },
					{ name: 'collapsible / collapsibleChildren / collapsed', type: 'boolean / boolean / boolean', description: 'Shows row-level Collapse/Expand for any hideable value; descendant cascade actions appear only for containers.' },
					{ name: 'contextTargetRef', type: 'RefObject<HTMLElement>', description: 'Element that opens this menu on right-click (the whole thing row); the deepest thing under the pointer wins.' },
					{ name: 'opacity / transition / iconSize', type: 'trigger styling', description: 'Wizard-icon reveal styling, matching the old SettingsMenu behaviour.' }
				]
			},
			{
				title: 'useThingContextMenu()',
				source: 'remix/app/components/Thingtime/ContextMenu/useThingContextMenu.tsx',
				rows: [
					{ name: 'hoverTriggerProps', type: 'spread props', description: 'onMouseEnter/onMouseLeave for the hover trigger (opens the popover, schedules close with a linger).' },
					{ name: 'contextTriggerProps', type: 'spread props', description: 'onContextMenu for right-click / long-press targets (opens at the pointer).' },
					{ name: 'openModal / openPopover / openAtPointer', type: '() => void / (e) => void', description: 'Programmatic openers for each presentation.' },
					{ name: 'closeMenu', type: '() => void', description: 'Closes and unpins.' },
					{ name: 'menuProps', type: 'spread props', description: 'Everything <ThingContextMenu/> needs: open, presentation, position, pin state, close + hover-linger handlers.' },
					{ name: 'options.hoverCloseDelay', type: 'number', defaultValue: '555', description: 'Grace period (ms) before a hover-opened menu hides.' }
				]
			},
			{
				title: 'thingZones (virtual bounding boxes)',
				source: 'remix/app/components/Thingtime/thingZones.ts',
				rows: [
					{ name: 'data-tt-zone', type: "'key' | 'value'", description: 'DOM markers Thingtime stamps on the property-name row and the atomic value box; everything else in a thing is the thing zone.' },
					{ name: 'resolveThingZone(target, thing)', type: '(Element, Element) => ThingZone', description: 'Hit-test an event target against one thing’s zones (nested things own their zones — the deepest handler wins first).' },
					{ name: 'getThingZoneBoxes(thing)', type: '(HTMLElement) => { key?, value?, thing }', description: 'Measure the zone boxes in viewport coordinates; the thing box is the key + value union — the atomic thing’s virtual bounding box, ready for drag/drop.' }
				]
			},
			{
				title: 'buildThingContextMenuModel()',
				source: 'remix/app/components/Thingtime/ContextMenu/contextMenuModel.ts',
				rows: [
					{ name: 'editMode', type: 'boolean', defaultValue: 'false', description: 'Reflects the current mode in the toggle item (label + icon).' },
					{ name: 'readonly', type: 'boolean', defaultValue: 'false', description: 'Drops every mutating section: type, value, cut/paste, danger.' },
					{ name: 'canDelete', type: 'boolean', defaultValue: 'true', description: 'Hides Recycle when there is no parent to remove the thing from.' },
					{ name: 'collapsible / collapsibleChildren / collapsed', type: 'boolean / boolean / boolean', defaultValue: 'false / collapsible / false', description: 'Adds Collapse/Expand for the current row and, for containers, Collapse all/Expand all.' },
					{ name: 'types / templates / permissions', type: 'option lists', defaultValue: 'DEFAULT_*', description: 'Override the drill-level contents; the live menu feeds types from thingtime.settings.types. Templates carry real starter values; nested children make deeper levels.' },
					{ name: 'selectedPermissionKey', type: 'string', defaultValue: "'private'", description: 'Which permission renders checked.' },
					{ name: 'buildTypesSubmenu(types, opts)', type: 'helper', description: "Types drill level; opts.command ('change-type' | 'add-child') and opts.wrapLevels control the leaves. Wrappable types drill to Replace/Wrap." },
					{ name: 'resolveDrillPath(model, path)', type: 'helper', description: 'Turns an array of action ids into the drill stack (used by defaultDrillPath).' }
				]
			}
		],
		guidelines: {
			intro:
				'One action model, three presentations, one window. The menu is data first: buildThingContextMenuModel() decides what a thing can do, and hover/right-click/modal only decide where that model appears. Submenus are drill-down levels — the surface navigates, it never grows, indents, or spawns secondary surfaces — so the same tree works at any depth, in any presentation, on any input.',
			dos: [
				'Anchor hover popovers to the thing header (path row); wire right-click on the whole thing row and let the deepest thing win.',
				'Use the modal presentation for deliberate, button-triggered flows (e.g. a Share button, mobile toolbars).',
				'Keep Danger actions last, red, and separated — never adjacent to Duplicate/Copy.',
				'Reflect state in the model: edit-mode toggles relabel, the active permission is checked, disabled actions stay visible but inert.',
				'Give every leaf a command + payload and switch on command in one dispatcher (see ThingContextMenuTrigger) — presentations stay dumb.',
				'Route the resulting mutations through the Thingtime data layer (setThingtime / API endpoints) — the menu itself never touches data.'
			],
			donts: [
				'Don’t add flyout submenus or indentation — drill-down navigation is the pattern; it survives modals, touch, small viewports, and infinite depth.',
				'Don’t let drilling change the window size — the frame locks on the first drill and levels scroll inside it.',
				'Don’t auto-close a pinned menu after an action; pinning means “I’m doing several of these” — that’s what drag exists for.',
				'Don’t reproduce browser-native clipboard semantics loosely — Copy/Cut/Paste operate on things (structured values), and say so in hints when ambiguous.'
			]
		},
		accessibility: [
			'The surface is role="menu"; actions are role="menuitem"; radio-style options are role="menuitemradio" with aria-checked.',
			'Drill parents expose aria-haspopup="menu"; the back row is a focusable menuitem labelled Back.',
			'Focus is roving: arrow keys move between every row of the current level including the back row; drilling lands focus on the first action (not the back row).',
			'Hover/right-click menus never steal focus on open — a window-level fallback still honours Escape (back/close) and pulls focus in on ArrowDown/ArrowUp; the modal focuses the first item and traps Tab.',
			'Right-click opens the thing menu everywhere — including property names and values — except on selected text or an editor the user was already focused in, where the native menu (copy, caret paste, spellcheck) passes through.',
			'Hover popovers stay open while the pointer is over the surface and linger ~555ms after leaving, so travel gaps don’t dismiss them.',
			'Right-click maps to long-press on touch via the native contextmenu event; the trigger icon also opens on tap.',
			'Drag and resize use pointer events with generous handles (whole header / 15px grip) and never trap keyboard users — every capability they gate is also reachable without them.',
			'Danger styling pairs colour with position (always last section) so colour is never the only signal.'
		],
		keyboard: [
			{ keys: '↓ / ↑', action: 'Move focus to the next / previous row (wraps)' },
			{ keys: 'Home / End', action: 'First / last row' },
			{ keys: 'Enter / Space', action: 'Activate the focused row (leaf fires, parent drills in)' },
			{ keys: '→', action: 'Drill into the focused parent' },
			{ keys: '← ', action: 'Back one level' },
			{ keys: 'Esc', action: 'Back one level, then close at the root (works before focus enters the menu too)' },
			{ keys: 'Tab', action: 'Trapped inside the modal presentation; cycles rows' }
		],
		tokens: [
			{ token: '--tt-card', usedFor: 'Menu surface background', preview: 'color' },
			{ token: '--tt-border', usedFor: 'Surface border', preview: 'color' },
			{ token: '--tt-border-light', usedFor: 'Section dividers + header rule', preview: 'color' },
			{ token: '--tt-surface', usedFor: 'Inline submenu background', preview: 'color' },
			{ token: '--tt-surface-alt', usedFor: 'Hover / focused row background', preview: 'color' },
			{ token: '--tt-ink', usedFor: 'Action labels', preview: 'color' },
			{ token: '--tt-muted', usedFor: 'Path, hints, section headers', preview: 'color' },
			{ token: '--tt-faint', usedFor: 'Shortcut labels, disclosure carets', preview: 'color' },
			{ token: '--tt-danger', usedFor: 'Danger actions (Recycle)', preview: 'color' },
			{ token: '--tt-radius-md', usedFor: 'Surface corner radius', preview: 'radius' },
			{ token: '--tt-radius-sm', usedFor: 'Row + submenu radius', preview: 'radius' },
			{ token: '--tt-shadow-popover', usedFor: 'Surface elevation (hard-offset in Fable theme)', preview: 'shadow' },
			{ token: '--tt-font-mono', usedFor: 'Path, type, section headers, shortcuts', preview: 'font' }
		],
		adoption: [
			'Done — ThingContextMenuTrigger replaced SettingsMenu on every thing header (hover/tap + right-click on the row) and on the new-child seedling row, keeping the settings-menu-hide single-open protocol.',
			'Done — live commands: change-type/wrap → onChangeType, add-child → addNewChild, toggle-edit-mode → setEditMode, recycle → deleteValue, plus real duplicate, copy, cut, paste, apply-template, modify (focus the editor), and share (copies the /things link).',
			'Next — permissions: set-permission / invite-person currently toast “coming soon”; they wire up when the things permissions API lands.',
			'Next — keyboard shortcuts shown in the menu (⌘C/⌘X/⌘V/⌘D/⌘E) are display-only; bind them on focused things once a focus model exists.'
		]
	},
	{
		slug: 'builder-blocks',
		title: 'Builder blocks',
		status: 'Adopted',
		summary:
			'The block-based webpage system: a page is a typed tree of blocks — text (eyebrow/heading/body), containers (column/row/grid), component refs, and native app screens — never markup. Component blocks reference component things resolved per viewer and drawn through the sanitising allowlist renderers, one render budget per block, which is what makes user pages safe at page scale.',
		notes:
			'Live as the /builder editor, user site pages, and public /p/ pages — all three call the same WebpageBlocksRenderer. The builder only ADDS chrome (boundary frames, insert zones, drag/drop) around the identical render path, so what you edit is exactly what viewers see.',
		anatomy: [
			'Block — { id, type, … }: a typed node, no markup anywhere. Optional align/maxWidth give any block its own layout envelope inside the column.',
			'Text block — text + style (body / heading / eyebrow), each mapped to the token typography; the only place raw strings live.',
			'Container block — direction column, row (wrapping), or grid (columns × equal tracks) with a gap; children are more blocks, up to depth 8.',
			'Component block — component: a ref string + optional per-placement args. The referenced component thing’s crystal.render template resolves (defaults → savedArgs → block.args) and draws through the Chakra/Html allowlist renderer.',
			'Native block — native: a key naming an app screen; the hosting site page supplies renderNative, builders show a locked placeholder, /p/ pages render nothing.',
			'Missing-component placeholder — a ref that resolves to null (deleted, or not visible to this viewer) degrades to a quiet dashed chip naming the ref.',
			'Builder chrome (optional) — hover/selected boundary frames with a drag-handle label chip, "+ add block" insert zones between every sibling pair, and drag/drop moves; native blocks render locked.',
			'Caps — 120 blocks, depth 8, 48KB serialised per page (server gate in sanitizeWebpageCrystal, mirrored client-side for optimistic edits).'
		],
		stories: builderBlocksStories,
		propTables: [
			{
				title: '<WebpageBlocksRenderer/>',
				source: 'remix/app/components/Builder/WebpageBlocksRenderer.tsx',
				rows: [
					{ name: 'blocks', type: 'WebpageBlock[]', description: 'The root block list of the page tree.' },
					{ name: 'componentsByRef', type: 'Record<string, ComponentThingLike | null>', description: 'ref → resolved component thing (null = not found / not visible). Build it from a /api/v1/webpages/resolve response with buildComponentsByRef(); {} is valid for purely structural trees.' },
					{ name: 'interactive', type: 'boolean', defaultValue: 'false', description: 'Wires ttAction clicks inside component blocks. Owner-viewing surfaces only (the PreviewModal trust rule): interactive for the page owner, inert for everyone else.' },
					{ name: 'renderNative', type: '(key, block) => ReactNode', description: 'How native blocks render: site pages pass the real app screen, builders pass a placeholder, /p/ pages omit it (native blocks render nothing).' },
					{ name: 'chrome', type: 'BuilderChrome | null', description: 'Builder-mode wiring: hover/select state + onInsert/onMove callbacks. Presence of chrome turns on frames, insert zones, and drag — the underlying render path is unchanged.' },
					{ name: 'buildComponentsByRef(payload)', type: 'helper', description: 'Folds the resolve endpoint’s { components, refs } payload into the ref → thing map, preserving null for unresolvable refs.' }
				]
			},
			{
				title: 'WebpageBlock (the union)',
				source: 'remix/app/components/Builder/webpageBlocks.ts',
				rows: [
					{ name: 'id / type', type: "string / 'component' | 'container' | 'text' | 'native'", description: 'Every block has a tree-unique id and one of the four types; per-type fields below are optional on the shared interface.' },
					{ name: 'align / maxWidth', type: "'start' | 'center' | 'end' | 'stretch' / number", description: 'Any block’s layout envelope: alignSelf in the column plus an optional px cap (center + maxWidth auto-centres).' },
					{ name: 'component / args', type: 'string / Record<string, string | number | boolean>', description: 'Component blocks: the ref plus per-placement arg overrides (highest layer of defaults → savedArgs → block.args).' },
					{ name: 'direction / gap / columns / children', type: "'column' | 'row' | 'grid' / number / number / WebpageBlock[]", description: 'Container blocks: layout direction, Chakra gap, grid column count (grid only), nested blocks.' },
					{ name: 'text / style', type: "string / 'body' | 'heading' | 'eyebrow'", description: 'Text blocks: the string and its typographic role.' },
					{ name: 'native', type: 'string', description: 'Native blocks: the app-screen key the hosting page interprets.' },
					{ name: 'MAX_BLOCKS / MAX_BLOCK_DEPTH', type: '120 / 8', description: 'Client mirrors of the server caps (plus 48KB serialised) enforced by sanitizeWebpageCrystal.' },
					{ name: 'insertBlock / removeBlock / updateBlock / moveBlock', type: 'pure tree ops', description: 'Immutable tree operations for optimistic editing; moveBlock refuses moves into a block’s own subtree and targets container blocks only.' },
					{ name: 'WebpageCrystal', type: '{ name, pageKey?, siteRoute?, version?, forkOf?, blocks }', description: 'The stored page document: the block tree plus routing identity and fork lineage (forkOf points at the doc a personalised copy came from).' }
				]
			}
		],
		guidelines: {
			intro:
				'Blocks are data, components are the only vocabulary, and the renderer is the only voice. A page can never smuggle markup: text blocks carry strings, component blocks carry refs + scalar args, and everything drawable goes through the sanitising allowlist renderers with one node budget per block — so a hostile page is bounded block by block and a hostile component is bounded by its own budget, never the page’s. The builder is chrome around the viewer render, not a second renderer.',
			dos: [
				'Keep every page a typed tree: text for words, containers for layout, component refs for anything richer.',
				'Resolve refs through /api/v1/webpages/resolve and buildComponentsByRef() — visibility is decided server-side per viewer, and null refs must reach the renderer so the placeholder can show.',
				'Rely on the per-block budget: many small component blocks scale where one mega-component would truncate (each block gets its own renderer instance and 600-node budget).',
				'Pass renderNative only where the surface really hosts app screens (site pages); builders show the locked placeholder, /p/ pages omit it.',
				'Respect the caps in tooling (120 blocks / depth 8 / 48KB) — the server gate will reject what the client lets through.',
				'Fork-and-edit for personalisation: a viewer’s forked webpage doc for a site route outranks the system doc at resolve time, so customising a page never mutates the shared original.'
			],
			donts: [
				'Don’t add a block type that carries markup, style strings, or arbitrary props — args are scalars and templates live in component things behind the sanitiser.',
				'Don’t render component crystals with anything but the allowlist renderers (ChakraThingRenderer/HtmlThingRenderer) — there is no trusted-HTML path, not even for system pages.',
				'Don’t wire builder interactions outside /builder — this catalog renders chrome-less on purpose; frames, insert zones, and drag belong to the builder surface.',
				'Don’t set interactive on surfaces viewed by anyone but the page owner — ttAction clicks run as the viewer, and the PreviewModal trust rule exists so pages can’t phish clicks.',
				'Don’t bypass the pure tree ops for edits — hand-spliced trees break the id-uniqueness and depth invariants the caps assume.'
			]
		},
		accessibility: [
			'Text blocks render real semantic elements — headings are h2s, body text is paragraphs — so page outlines and screen readers get structure from the typed tree.',
			'Container order is DOM order: row/grid layouts read left-to-right, top-to-bottom in the same order the tree stores.',
			'The missing-component placeholder is visible text naming the ref, not an empty hole — viewers and owners can both tell something is absent.',
			'Component output passes the same sanitiser as everywhere else: no event handlers, no out-of-flow positioning, so an embedded component cannot overlay or trap anything.',
			'Builder chrome is mouse/touch sugar; every mutation it performs (insert, move, edit) is equally available through the block list panel in /builder.'
		],
		keyboard: [{ keys: '—', action: 'The viewer render is inert; builder editing interactions (and their keys) live in /builder, not in this catalog.' }],
		tokens: [
			{ token: '--tt-font-heading', usedFor: 'Heading text blocks', preview: 'font' },
			{ token: '--tt-font-body', usedFor: 'Body text blocks', preview: 'font' },
			{ token: '--tt-font-mono', usedFor: 'Eyebrow blocks, placeholders, chrome chips', preview: 'font' },
			{ token: '--tt-ink', usedFor: 'Heading colour', preview: 'color' },
			{ token: '--tt-text', usedFor: 'Body colour', preview: 'color' },
			{ token: '--tt-muted', usedFor: 'Eyebrows, placeholders, locked-native chrome', preview: 'color' },
			{ token: '--tt-border', usedFor: 'Placeholder dashed borders', preview: 'color' },
			{ token: '--tt-radius-md', usedFor: 'Placeholder corner radius', preview: 'radius' },
			{ token: '--tt-radius-xs', usedFor: 'Builder frame outline radius', preview: 'radius' },
			{ token: '--tt-radius-pill', usedFor: 'Chrome label + insert-zone chips', preview: 'radius' },
			{ token: '--tt-accent', usedFor: 'Builder chrome — frames, insert lines, drag chips', preview: 'color' },
			{ token: '--tt-accent-tint', usedFor: 'Insert-button hover wash', preview: 'color' },
			{ token: '--tt-accent-contrast', usedFor: 'Text on chrome chips', preview: 'color' },
			{ token: '--tt-card', usedFor: 'Insert-button background', preview: 'color' }
		],
		adoption: [
			'Done — /builder edits, site pages host, and /p/ pages publish through the ONE WebpageBlocksRenderer; chrome presence is the only difference.',
			'Done — component blocks resolve through /api/v1/webpages/resolve with per-viewer visibility, and the server write gate (sanitizeWebpageCrystal) enforces the 120/8/48KB caps.',
			'Done — site personalisation: viewer forks (forkOf lineage) outrank the system doc for a route at resolve time.',
			'Next — the native-block screen vocabulary grows as more app surfaces become embeddable; each new key ships with its site-page renderNative wiring.'
		]
	},
	...practicesEntries
];

export const getDesignSystemEntryBySlug = (slug?: string | null) =>
	designSystemEntries.find((entry) => entry.slug === slug);
