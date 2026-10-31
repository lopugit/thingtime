import type { DesignSystemEntry } from '../entries';
import { optimisticRenderingStories } from './OptimisticRenderingStories';
import { typographyAndSpacingStories } from './TypographyAndSpacingStories';
import { clearanceStories } from './ClearanceStories';
import { touchA11yStories } from './TouchA11yStories';

// Practices group: the house rules that are not a single component but govern
// every surface — optimistic rendering, the type/spacing scales, nav
// clearance + safe areas, and the touch/a11y conventions. All Reference
// status: they document conventions, and the stories demonstrate them with
// the real tokens and recipes.

export const practicesEntries: DesignSystemEntry[] = [
	{
		slug: 'optimistic-rendering',
		title: 'Optimistic rendering',
		status: 'Reference',
		summary:
			'THE house rule: never flash a loading screen, spinner, or skeleton when prior or cached state exists. Render the last-known value instantly from the synchronous localCache tier (localStorage, tt-<domain> keys), refetch in the background, reconcile when fresh data lands, and revert on failure. A loading state is legal only on a true cold start with nothing to show.',
		notes:
			'Live everywhere state repeats: the account switcher paints its last-known roster from tt-accounts-roster instead of “Checking accounts…”; post reactions toggle before the API returns and revert on failure; the emoji picker’s Recently Used paints from tt-recent-reactions while the server list loads; messenger, schemas, search, and admin panels seed from their tt-* mirrors; the builder’s site pages render from routeCache/globalCache resolve maps; and HydrateFallback holds a blank themed surface — deliberately not a spinner — while the router resolves.',
		anatomy: [
			'The rule — prior or cached state renders NOW; the network is a background detail. Spinners are reserved for true cold starts (cache === null), not for “I am refetching”.',
			'Tier 0: HydrateFallback (routes.tsx) — while the initial navigation resolves, an empty min-height surface holds the themed background steady. Blank, never a skeleton.',
			'Tier 1: ~/hooks/localCache — synchronous, SSR-safe localStorage JSON (readLocalCache/writeLocalCache), keys namespaced tt-<domain> to match the tt-theme-vars pre-paint snapshot. The ONLY tier fast enough to gate first paint.',
			'Tier 2: async stores — the localforage “thingtime” blob (ThingtimeProvider) and module-memory caches (SiteBlocksHost routeCache/globalCache). For large state that does not gate first paint; hydrates after mount.',
			'The seed — readLocalCache() inside a useState LAZY INITIALIZER, so the last-known value is present on the very first render, not one effect later.',
			'The commit funnel — every state update flows through one function that setStates AND rewrites the mirror (commitAccounts in useAccountSwitcher), so cache and UI can never drift.',
			'The reconcile — background fetch lands, fresh data replaces the cached paint; optimistic mutations reconcile with the server’s answer (reaction counts) or fetch the truth on ambiguous failures.',
			'The revert — a failed optimistic mutation rolls back to the pre-tap state and says so (Lopu toast); it never leaves a lie on screen and never freezes the control while deciding.'
		],
		stories: optimisticRenderingStories,
		propTables: [
			{
				title: 'localCache (the synchronous tier)',
				source: 'remix/app/hooks/localCache.ts',
				rows: [
					{
						name: 'readLocalCache<T>(key)',
						type: '(key: string) => T | null',
						description: 'SSR-safe JSON read — returns null on the server, on a missing key, or on parse/storage errors. Call it inside a useState lazy initializer to seed the first render.'
					},
					{
						name: 'writeLocalCache(key, value)',
						type: '(key: string, value: unknown) => void',
						description: 'JSON.stringify into localStorage; quota/storage failures are swallowed (non-fatal — you just lose the seed). Call it from the same commit path that setStates.'
					},
					{
						name: 'clearLocalCache(key)',
						type: '(key: string) => void',
						description: 'Removes a mirror — e.g. on sign-out, when last-known state would belong to nobody.'
					},
					{
						name: 'key convention',
						type: 'tt-<domain>[:scope]',
						description: 'Namespaced like the theme snapshot: tt-accounts-roster, tt-recent-reactions:<userId|anon>, tt-messenger-chats:<userId>, tt-schemas-<userId>, tt-search. Per-user data ALWAYS scopes the key by userId so account switches can’t leak another account’s cache.'
					}
				]
			},
			{
				title: 'The seeding recipe (useAccountSwitcher)',
				source: 'remix/app/components/Account/useAccountSwitcher.tsx',
				rows: [
					{
						name: 'seed',
						type: 'useState(() => readLocalCache(KEY) || [])',
						description: 'The lazy initializer paints the last-known roster at 0ms. Never seed in a useEffect — that is one blank frame too late.'
					},
					{
						name: 'loading gate',
						type: 'useState(() => readLocalCache(KEY) === null)',
						defaultValue: 'false when cached',
						description: 'loading is true ONLY when the mirror is empty — the spinner is reserved for a true cold start.'
					},
					{
						name: 'commitAccounts(next)',
						type: '(next) => void',
						description: 'The single funnel: setAccounts(next) + writeLocalCache(KEY, next), so the mirror stays in lockstep with every roster change (including overwriting to [] on full sign-out).'
					},
					{
						name: 'apiRef / lopuRef',
						type: 'React.useRef',
						description: 'useApi()’s return object is rebuilt per render — refs keep the background-refresh callbacks stable without refetch loops (same pattern as Feed.tsx).'
					}
				]
			},
			{
				title: 'Optimistic mutation (PostCard reactions)',
				source: 'remix/app/components/Feed/PostCard.tsx',
				rows: [
					{
						name: 'repaint',
						type: 'applyReactionToggle → onChanged',
						description: 'The tap flips counts/viewer state immediately against the FRESHEST copy of the post, and notes the local mutation so background fetches snapshotted before it merge through instead of clobbering.'
					},
					{
						name: 'reconcile',
						type: 'api.v1.things.react → reconcileReactionToken',
						description: 'The server’s counts replace the optimistic guess when the response lands.'
					},
					{
						name: 'revert / truth-fetch',
						type: 'shouldReconcileReactionFailure',
						description: 'Known failures fetch the server truth and reconcile; unknown outcomes keep the optimistic copy and tell the viewer to refresh — never silently guess a rollback.'
					},
					{
						name: 'in-flight guard',
						type: 'inFlightReactionTokensRef',
						description: 'The endpoint is a toggle, so two same-token requests cannot safely race — duplicate taps are ignored until the first settles; distinct tokens stay independent.'
					}
				]
			},
			{
				title: 'HydrateFallback (the blank surface)',
				source: 'remix/app/routes.tsx',
				rows: [
					{
						name: 'HydrateFallback',
						type: '() => <div/>',
						description: 'Rendered while the router resolves the initial navigation. A min-height 100vh div carrying only the themed body background — deliberately an empty surface, because the house rule bans flashing a loading state and React Router would otherwise render nothing (a white flash on a themed page).'
					}
				]
			}
		],
		guidelines: {
			intro:
				'The user’s last-known world is almost always still true — show it. Every open, navigation, and toggle should paint from what the device already knows, then let the network catch up quietly. The question to ask before adding any spinner: “does the device have NOTHING to show here?” If prior state exists anywhere, rendering a loading indicator instead of it is a bug by house rule.',
			dos: [
				'Seed with readLocalCache() in a useState lazy initializer — the cached value must exist on the very first render.',
				'Gate loading on cache absence (readLocalCache(key) === null), never on “a fetch is in flight”.',
				'Funnel every commit through one function that updates state AND the mirror together (the commitAccounts pattern).',
				'Scope per-user keys by userId (tt-recent-reactions:<userId|anon>) so account switching never paints someone else’s cache.',
				'Flip optimistic mutations immediately, reconcile with the server’s response, and revert (with a Lopu toast) on failure.',
				'Guard racy toggles with an in-flight set — optimism does not mean firing the same toggle twice concurrently.'
			],
			donts: [
				'Don’t show a spinner, skeleton, or “Checking…” when a cached value exists — that is the anti-pattern this rule exists to kill.',
				'Don’t seed first paint from the async localforage blob or a fetch-in-useEffect — both arrive a frame (or a round-trip) too late; the sync tier is the only legal seed.',
				'Don’t write the mirror from anywhere except the commit funnel — a setState that forgets writeLocalCache leaves the next open painting stale data.',
				'Don’t block the control while an optimistic request settles — disabled-while-saving buttons are the same flash in different clothes.',
				'Don’t guess a rollback on an unknown failure — fetch the truth or keep the optimistic copy and say so; silently reverting a mutation that actually succeeded is worse than the wait.',
				'Don’t cache secrets or private payloads client-side just to render faster — mirrors hold only what the client already legitimately renders.'
			]
		},
		accessibility: [
			'Cached-first paint is an assistive win: screen-reader users get real content on open instead of a live-region announcing an indeterminate spinner, and focus has somewhere real to land.',
			'Reconciliation must not steal focus or collapse the control the user is interacting with — fresh data merges under the cursor, it does not remount the surface.',
			'Optimistic reverts pair the visual rollback with a Lopu toast so the correction is announced, not just repainted.',
			'HydrateFallback keeps the background at the themed colour, avoiding the white flash that is jarring at high contrast and in dark themes.',
			'When a true cold-start spinner IS shown, it carries a text label (“Checking accounts…”), never a bare animation.'
		],
		keyboard: [{ keys: '—', action: 'A rendering practice — no keyboard surface of its own; it exists so keyboard focus always has real content to land on.' }],
		tokens: [
			{ token: '--tt-surface-alt', usedFor: 'Active/selected rows in cached lists (switcher active account)', preview: 'color' },
			{ token: '--tt-card', usedFor: 'The panels cached content paints into', preview: 'color' },
			{ token: '--tt-muted', usedFor: 'The true-cold-start spinner label', preview: 'color' },
			{ token: '--tt-accent-tint', usedFor: 'Optimistically-active reaction pills', preview: 'color' },
			{ token: '--tt-danger', usedFor: 'Failure/revert messaging', preview: 'color' },
			{ token: '--tt-font-mono', usedFor: 'Cache-key and status annotations in these stories', preview: 'font' }
		],
		adoption: [
			'Done — the rule is written into the project instructions (“Optimistic rendering at all times”) and ~/hooks/localCache documents the two-tier contract in its header.',
			'Done — account switcher (tt-accounts-roster), emoji recents (tt-recent-reactions), messenger (tt-messenger-* family), schemas/search/components browse pages, notification prefs, passkeys, token minter, CI control, and the builder’s resolve caches all seed from mirrors.',
			'Done — HydrateFallback replaced the router’s white flash with a themed blank surface.',
			'Ongoing — any surface still spinner-gating a repeat visit is a bug to fix on sight; new features budget their cache key (tt-<domain>) in the same PR that adds the fetch.'
		]
	},
	{
		slug: 'typography-and-spacing',
		title: 'Typography + spacing',
		status: 'Reference',
		summary:
			'How text and space are rationed: four font-role tokens (display / heading / body / mono) each with a fixed working range, the mono eyebrow recipe (10–11px · 600–700 · 0.08–0.14em tracking · uppercase · --tt-muted), the closed content width scale (680–1400), and the Chakra 0.25rem space ramp. None of these are suggestions — they are the reason two unrelated pages read as one product.',
		notes:
			'The roles live as --tt-font-* tokens (theme/tokens.ts) so themes swap faces without touching a single component; the eyebrow recipe ships in PageHeader and is re-derived nowhere; the width scale is the PageShellWidth union type, enforced by the compiler; spacing is written in Chakra units with a small working set (4 everywhere, 5 in cards, 12 at page tails).',
		anatomy: [
			'Display — --tt-font-display, 800–900, clamp(44px, 7vw, 74px), −0.03em. Landing hero and marketing headlines only; it never appears in product chrome.',
			'Heading — --tt-font-heading, 700, −0.02em: the page h1 at 2xl (one per page, rainbow or ink), card/section titles at ~19px.',
			'Body — --tt-font-body: reading copy at 16px/1.65, UI copy (subtitles, hints, card text) at 13–13.5px/1.6. Body never letter-spaces.',
			'Mono — --tt-font-mono for everything machine-shaped: paths (13px), shortcut chips (11px), and the eyebrow register (10–11px). Mono is the only role that tracks OUT.',
			'The eyebrow — the design language’s signature label: mono, 10–11px, 600–700, letter-spacing 0.08em (page headers, row labels) / 0.12em (dense panel sections) / 0.14em (docs group labels), uppercase via CSS from lowercase source text, --tt-muted.',
			'Width scale — 680 · 760 · 860 · 920 · 1100 · 1180 · 1280 · 1400: reading columns → status pages → content+meta → form/panel pages → card grids → report tables → admin tables → full workbenches. A closed union type (PageShellWidth).',
			'Space ramp — Chakra units at 0.25rem each: 4 (16px) is the workhorse column gap and gutter, 5 pads cards, 2.5 paddings hairline rows, 3 gaps grids, 12 (48px) is the page tail.',
			'Measure caps — subtitles cap at 720px, body samples around 560px: width steps size the COLUMN, max-widths keep the LINE readable inside it.'
		],
		stories: typographyAndSpacingStories,
		propTables: [
			{
				title: 'Font roles (as shipped)',
				source: 'remix/app/theme/tokens.ts · docs/design/DESIGN_LANGUAGE.md',
				rows: [
					{ name: '--tt-font-display', type: 'font token', description: '800–900 weight, clamp(44px, 7vw, 74px), −0.03em, line-height ~1.05. System stack by default; marketing surfaces only.' },
					{ name: '--tt-font-heading', type: 'font token', description: '600/700, −0.02em. Space Grotesk in the default theme. The h1 (2xl) and card titles (~19px).' },
					{ name: '--tt-font-body', type: 'font token', description: '400–600. Hanken Grotesk default. 16px/1.65 for reading copy, sm/1.6 for UI copy.' },
					{ name: '--tt-font-mono', type: 'font token', description: 'JetBrains Mono default. Keys, paths, shortcuts, code, and the whole eyebrow register.' },
					{ name: 'Fable collapse', type: 'theme behaviour', description: 'The Fable theme collapses display+heading+body onto the system stack at 800/900 — sizes and tracking hold, faces change. Weight/size choices must survive that swap.' }
				]
			},
			{
				title: 'The eyebrow recipe',
				source: 'remix/app/components/Layout/PageShell.tsx (PageHeader) · design-system story labels',
				rows: [
					{ name: 'fontFamily', type: 'var(--tt-font-mono, …)', description: 'Always mono — the eyebrow is a machine label, not a heading.' },
					{ name: 'fontSize', type: '10px – 11px', defaultValue: '10px', description: '10px on page headers and docs labels; 11px where the surface runs larger.' },
					{ name: 'fontWeight', type: '600 – 700', defaultValue: '600', description: '600 standard; 700 only when sitting on a busy background.' },
					{ name: 'letterSpacing', type: '0.08em – 0.14em', defaultValue: '0.08em', description: '0.08em page eyebrows + hairline row labels · 0.12em dense panel sections · 0.14em docs group labels.' },
					{ name: 'textTransform', type: "'uppercase'", description: 'CSS uppercases — source text stays lowercase with middot hierarchy (“settings · appearance”) so copy/paste and find-in-page stay sane.' },
					{ name: 'color', type: 'var(--tt-muted, #9a9aa6)', description: 'Always muted. An eyebrow is never the loudest thing in its block.' }
				]
			},
			{
				title: 'PageShellWidth (the closed width scale)',
				source: 'remix/app/components/Layout/PageShell.tsx',
				rows: [
					{ name: '680', type: 'PageShellWidth', defaultValue: 'default', description: 'The reading column — settings, feed, /p pages, apps data. Most pages live here.' },
					{ name: '760 / 860', type: 'PageShellWidth', description: 'Status/report pages with denser rows; content pages that add side metadata.' },
					{ name: '920', type: 'PageShellWidth', description: 'Form-and-panel pages — builder, migrations, vercel, crypto.' },
					{ name: '1100 / 1180 / 1280', type: 'PageShellWidth', description: 'Card grids and dashboards; test/report tables; admin dashboard tables.' },
					{ name: '1400', type: 'PageShellWidth', description: 'Full workbench surfaces — the raw data explorer. The ceiling.' },
					{ name: '(anything else)', type: 'type error', description: 'The union type rejects in-between numbers at compile time — widening a page is a deliberate step up the scale.' }
				]
			},
			{
				title: 'The space ramp working set',
				source: 'Chakra spacing scale (1 unit = 0.25rem = 4px) as used across PageShell/CARD_STYLES pages',
				rows: [
					{ name: '4 (16px)', type: 'unit', description: 'THE workhorse: PageShell column rowGap and px gutters, gaps between cards.' },
					{ name: '5 (20px)', type: 'unit', description: 'Card padding (CARD_STYLES sections).' },
					{ name: '2.5 (10px)', type: 'unit', description: 'Hairline label/value row paddingY.' },
					{ name: '3 (12px)', type: 'unit', description: 'Grid gaps in swatch/card grids.' },
					{ name: '12 (48px)', type: 'unit', description: 'The page tail — PageShell pb, so pages never end flush at the fold.' },
					{ name: 'raw px strings', type: 'escape hatch', description: 'Reserved for optical values the ramp can’t express: 7px control padding, 44px tap minimums, 54px nav clearance. If a number is on the ramp, write it as a unit.' }
				]
			}
		],
		guidelines: {
			intro:
				'Typography and spacing are budget systems: four faces, six-or-so text settings, eight column widths, one 4px grid. Designing a page means choosing FROM these scales, not inventing adjacent values — the moment a 15px heading or a 700px column appears, the page stops rhyming with the rest of the app. The scales are deliberately closed (a union type, a fixed recipe) so drift is a compile error or an obvious diff, not a slow leak.',
			dos: [
				'Resolve every text setting to one of the four role tokens — if a string doesn’t know its role, decide that first.',
				'Write eyebrows with the exact recipe (mono/10px/600/tracking/uppercase/--tt-muted) and lowercase middot-separated source text.',
				'Pick the narrowest PageShellWidth that fits the page’s densest row; cap the MEASURE separately (subtitles 720px).',
				'Write spacing as Chakra units from the working set — 4 for gaps and gutters, 5 in cards, 2.5 on hairline rows, 12 at the tail.',
				'Keep negative tracking to headings (−0.02em) and display (−0.03em); keep positive tracking to the mono eyebrow register.',
				'Let the tokens carry the faces — a theme swap (Fable’s system-stack collapse) must change no component code.'
			],
			donts: [
				'Don’t use display type in product chrome — it is the marketing voice; the app’s biggest text is the 2xl h1.',
				'Don’t type eyebrow text in uppercase or bolt on ad-hoc separators — CSS transforms, source stays lowercase with middots.',
				'Don’t invent widths between the scale steps or nest a second max-width fighting the shell’s column.',
				'Don’t letter-space body copy, and don’t track mono IN — the eyebrow’s 0.08–0.14em range is the only sanctioned tracking-out.',
				'Don’t mix raw px and ramp units for the same kind of gap in one file — pick the ramp unless the value is genuinely optical (44px targets, 54px nav).',
				'Don’t reach past the four roles for a novelty face — new fonts enter through the theme document’s curated list, never a component.'
			]
		},
		accessibility: [
			'Reading copy holds 16px/1.65 — UI copy may drop to 13px, but paragraphs users actually read never do.',
			'Uppercase is applied via text-transform on lowercase source, so screen readers receive normal words (typed uppercase can be spelled out letter-by-letter) and find-in-page matches.',
			'The 10px eyebrow register is legal only because eyebrows are redundant locator labels — never the sole carrier of essential information at that size.',
			'The width scale plus measure caps keep line length in the readable range on every step; wide steps are for tables and grids, not for 1400px-long text lines.',
			'Spacing on the 4px grid keeps tap targets and row heights consistent, which is what lets the 44px minimum be met systematically rather than per-surface.',
			'All four roles end in real system fallback stacks, so text renders correctly before webfonts arrive and under any user theme.'
		],
		keyboard: [{ keys: '—', action: 'Purely presentational conventions; no keyboard surface of their own.' }],
		tokens: [
			{ token: '--tt-font-display', usedFor: 'Marketing hero type (800–900, clamped)', preview: 'font' },
			{ token: '--tt-font-heading', usedFor: 'The h1 and card titles (700, −0.02em)', preview: 'font' },
			{ token: '--tt-font-body', usedFor: 'Reading copy 16/1.65, UI copy sm/1.6', preview: 'font' },
			{ token: '--tt-font-mono', usedFor: 'Paths, shortcuts, and the eyebrow register', preview: 'font' },
			{ token: '--tt-ink', usedFor: 'Headings and primary labels', preview: 'color' },
			{ token: '--tt-text', usedFor: 'Body copy', preview: 'color' },
			{ token: '--tt-muted', usedFor: 'Eyebrows and meta text', preview: 'color' },
			{ token: '--tt-faint', usedFor: 'Disabled text and shortcut labels', preview: 'color' }
		],
		adoption: [
			'Done — the four roles are tokens; the default theme loads Space Grotesk / Hanken Grotesk / JetBrains Mono and Fable proves the swap works.',
			'Done — the eyebrow recipe ships once in PageHeader; docs, cards, and panels quote the same spec at their three tracking widths.',
			'Done — PageShellWidth is the compiler-enforced width scale; every conforming page picks a step.',
			'Ongoing — surfaces predating the scaffold still carry off-ramp values (odd px paddings, 15px headings); they migrate to the scales as they are touched.'
		]
	},
	{
		slug: 'clearance-and-safe-area',
		title: 'Clearance + safe area',
		status: 'Reference',
		summary:
			'How content clears the fixed chrome on every device: one blessed constant, PAGE_TOP_CLEARANCE = calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px)), built from the nav-height token and the iOS safe-area inset vars. Nothing re-derives it. Full-bleed surfaces (FULL_BLEED_PATHS) opt out of document flow entirely, and every page inherits Main’s global pre-wrap unless it resets it.',
		notes:
			'The vars live on :root in GlobalStyles.tsx — --tt-nav-clearance: 54px and the four --thingtime-safe-area-* insets mapped from env(safe-area-inset-*) — plus the native-webview bottom padding (--thingtime-visual-bottom-padding + safe-area-bottom on the footer) and the Electron titlebar family. PAGE_TOP_CLEARANCE is exported from PageShell.tsx precisely so bespoke surfaces that cannot use the shell still never hand-roll clearance: the pt 28/32, 90px, 108px, and 200px-margin variants it replaced were each a bug on some device.',
		anatomy: [
			'--tt-nav-clearance (54px) — the height of the fixed global nav, defined once on :root. Any surface that needs to clear the nav reads this, never a magic number.',
			'--thingtime-safe-area-top/right/bottom/left — env(safe-area-inset-*) mapped onto app-owned vars, so notches and home indicators are ordinary tokens components can calc() with.',
			'PAGE_TOP_CLEARANCE — the sum: safe-area-top + nav-clearance. PageShell applies it as paddingTop; bespoke surfaces import the constant.',
			'Bottom clearance — the native webview adds --thingtime-visual-bottom-padding (72px) + safe-area-bottom to the footer (html.thingtime-native-webview rules), keeping content above the home indicator.',
			'Electron chrome — --thingtime-electron-titlebar-* vars turn the nav into a draggable titlebar on desktop; same pattern, different fixed chrome.',
			'FULL_BLEED_PATHS (Main.tsx) — currently [\'/messages\']: surfaces that own the whole viewport as fixed-height panes with internal scroll. Main drops the footer and its tail spacer for them.',
			'The pre-wrap reset — Main sets whiteSpace: pre-wrap on EVERY descendant (its sx \'*\' rule) so thing values keep authored line breaks; PageShell resets its column to normal. Bespoke surfaces must remember this reset or inherit staircase text.',
			'TopSpacing (legacy) — the old safe-area-top + 108px spacer; superseded by PAGE_TOP_CLEARANCE and kept only where not yet migrated.'
		],
		stories: clearanceStories,
		propTables: [
			{
				title: 'The blessed constant',
				source: 'remix/app/components/Layout/PageShell.tsx',
				rows: [
					{
						name: 'PAGE_TOP_CLEARANCE',
						type: 'string (exported const)',
						description: "'calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))' — the one way to clear the fixed nav. PageShell applies it automatically; anything that cannot use PageShell imports it."
					}
				]
			},
			{
				title: 'Root variables',
				source: 'remix/app/globals/GlobalStyles.tsx',
				rows: [
					{ name: '--tt-nav-clearance', type: 'CSS var', defaultValue: '54px', description: 'Fixed global nav height. Landing sub-nav, /themes, and every clearance calc read it instead of a magic number.' },
					{ name: '--thingtime-safe-area-top/right/bottom/left', type: 'CSS vars', defaultValue: 'env(safe-area-inset-*, 0px)', description: 'The iOS notch/home-indicator insets as app-owned tokens — calc()-able anywhere, 0 on devices without insets.' },
					{ name: '--thingtime-visual-bottom-padding', type: 'CSS var', defaultValue: '72px', description: 'Native-webview footer padding; the .thingtimeFooter rule adds safe-area-bottom on top of it.' },
					{ name: '--thingtime-electron-titlebar-height / -left-inset / -nav-start', type: 'CSS vars', defaultValue: '0px / 0px / 34px', description: 'Electron desktop chrome geometry — the nav becomes the draggable titlebar; traffic lights get their left inset.' }
				]
			},
			{
				title: 'Full bleed + the pre-wrap rule',
				source: 'remix/app/components/Layout/Main.tsx',
				rows: [
					{
						name: 'FULL_BLEED_PATHS',
						type: 'string[]',
						defaultValue: "['/messages']",
						description: 'Surfaces that own the whole viewport (fixed-height panes with internal scroll). Main renders no footer/tail spacer for them — a chat that scrolls the page under its composer is unusable.'
					},
					{
						name: "sx={{ '*': { whiteSpace: 'pre-wrap' } }}",
						type: 'global descendant rule',
						description: 'Applied on mainFlexRoot so thing values keep their authored line breaks app-wide. Every page inherits it; PageShell resets its column with whiteSpace="normal".'
					},
					{
						name: 'drawer split-view padding',
						type: 'behaviour',
						description: 'Main also owns drawer geometry: desktop content resizes beside the pinned drawer (padding = clamped drawer width), mobile content translates sideways instead — both on a 0.28s ease-out that suspends during live resize.'
					}
				]
			},
			{
				title: 'Legacy spacer',
				source: 'remix/app/components/Layout/TopSpacing.tsx',
				rows: [
					{
						name: '<TopSpacing/>',
						type: 'mt = safe-area-top + 108px',
						description: 'The pre-scaffold clearance idiom. Do not use it in new code — it over-clears by 54px on most screens; surfaces still carrying it migrate to PAGE_TOP_CLEARANCE/PageShell as they are touched.'
					}
				]
			}
		],
		guidelines: {
			intro:
				'Fixed chrome (nav, notch, home indicator, titlebar) is device- and shell-dependent, so clearance must be computed from variables — never measured by eye on one laptop. The whole practice is one habit: read the tokens, use the exported constant, and treat any literal clearance number in a diff as a bug. The historical evidence is blunt — every hand-rolled variant (pt 28/32, 90px, 108px, 200px margins) shipped broken on some device.',
			dos: [
				'Start pages with PageShell — clearance is then not your problem at all.',
				'Import PAGE_TOP_CLEARANCE for bespoke surfaces (overlays, canvases, fixed panels) that cannot use the shell.',
				'calc() with the --thingtime-safe-area-* vars for anything pinned to a viewport edge — bottom bars add safe-area-bottom, right-edge rails add safe-area-right.',
				'Add a path to FULL_BLEED_PATHS when a surface truly owns the viewport — and give it internal scroll plus its own bottom clearance.',
				'Reset whiteSpace to normal at the root of any bespoke surface (PageShell already does) and opt back into pre-wrap locally for actual preformatted content.',
				'Test clearance by toggling the insets (the story’s notch toggle, or iOS simulator) — if your surface reads the vars, it just works.'
			],
			donts: [
				'Don’t hand-roll top clearance — no pt={28}, no marginTop="90px", no measuring the nav in DevTools.',
				'Don’t use TopSpacing in new code — it is the legacy 108px spacer the scaffold replaced.',
				'Don’t hardcode 54px — the nav height is a token; if the nav changes, --tt-nav-clearance changes once.',
				'Don’t fake full-bleed with 100vh boxes on a normal page — the footer and tail spacer will fight you; add the path to FULL_BLEED_PATHS instead.',
				'Don’t forget the pre-wrap inheritance on hand-rolled surfaces — mystery line breaks are almost always Main’s rule, not your markup.',
				'Don’t pin anything to the raw viewport bottom on mobile — the home indicator eats it; add --thingtime-safe-area-bottom.'
			]
		},
		accessibility: [
			'Safe-area compliance is a reachability requirement: content under the notch or home indicator is unreadable and untappable on device, whatever the desktop preview shows.',
			'PAGE_TOP_CLEARANCE guarantees the h1 and first focusable content start below the fixed nav — keyboard focus never lands under glass.',
			'Full-bleed surfaces keep their composer/input pinned and reachable while ONLY the content pane scrolls — the page never scrolls controls away mid-conversation.',
			'The native-webview footer padding keeps the last interactive elements above the home-indicator swipe zone, where taps would otherwise trigger system gestures.',
			'The pre-wrap reset matters for screen readers too: unintended pre-wrap turns one sentence into many visual lines, breaking the correspondence between what is seen and what is read out.'
		],
		keyboard: [{ keys: '—', action: 'Layout practice — no keyboard surface of its own; it exists so focusable content is never positioned under fixed chrome.' }],
		tokens: [
			{ token: '--tt-nav-clearance', usedFor: 'Fixed nav height — the 54px every clearance calc reads' },
			{ token: '--thingtime-safe-area-top', usedFor: 'iOS notch inset (env(safe-area-inset-top))' },
			{ token: '--thingtime-safe-area-bottom', usedFor: 'Home-indicator inset — bottom bars and footers add it' },
			{ token: '--thingtime-safe-area-left', usedFor: 'Landscape notch inset, left edge' },
			{ token: '--thingtime-safe-area-right', usedFor: 'Landscape notch inset, right edge' },
			{ token: '--thingtime-visual-bottom-padding', usedFor: 'Native-webview footer padding base (72px)' },
			{ token: '--thingtime-electron-titlebar-height', usedFor: 'Electron draggable-titlebar height' },
			{ token: '--tt-surface', usedFor: 'The wash the cleared page sits on', preview: 'color' },
			{ token: '--tt-border-light', usedFor: 'The nav’s bottom hairline', preview: 'color' }
		],
		adoption: [
			'Done — PAGE_TOP_CLEARANCE is exported from PageShell and used by the shell and conforming bespoke surfaces; the hand-rolled variants it replaced are gone from conforming pages.',
			'Done — the safe-area env() mapping, native-webview footer padding, and Electron titlebar vars all live in GlobalStyles.tsx as one geometry vocabulary.',
			'Done — /messages runs full-bleed through FULL_BLEED_PATHS with its own internal scroll and pinned composer.',
			'Ongoing — surfaces still carrying TopSpacing or literal clearance numbers migrate as they are touched; any clearance value that is not PAGE_TOP_CLEARANCE is a bug to fix on sight.'
		]
	},
	{
		slug: 'touch-and-a11y',
		title: 'Touch + accessibility',
		status: 'Reference',
		summary:
			'The builder’s round-3 interaction rules, now house-wide: every interactive target hits 44px minimum (pad the hit area, not the glyph); chrome carries the CHROME_TOUCH_SX recipe (no selection, no callout, transparent tap highlight, touch-action: manipulation); coarse pointers get always-visible affordances because touch has no hover; pickers become bottom sheets under 640px; Escape closes, arrows navigate, and every icon-only control has an aria-label.',
		notes:
			'The reference implementations live in the builder — CHROME_TOUCH_SX and useCoarsePointer in WebpageBlocksRenderer.tsx, the 44px InsertZone strip, and BlockInsertMenu’s under-640 bottom sheet (with its 44×5 grab handle and deliberate no-autofocus, since the mobile keyboard would cover the sheet). The same conventions govern the ThingContextMenu (Esc = back-then-close, roving arrows, long-press = right-click via the native contextmenu event) and every icon-only button in the app.',
		anatomy: [
			'44px tap minimum — the HIT AREA of every interactive control is at least 44×44px. Glyphs stay small; padding does the work. The InsertZone pattern: a slim visual line whose whole 44px strip is the button.',
			'CHROME_TOUCH_SX — five properties for interactive chrome: userSelect/WebkitUserSelect none (long-press must not select a drag handle), WebkitTouchCallout none (no iOS copy sheet), WebkitTapHighlightColor transparent, touchAction manipulation (taps fire without the double-tap-zoom delay).',
			'Coarse-pointer visibility — matchMedia(\'(pointer: coarse)\') with a live change listener; anything revealed on hover for mouse users is simply visible on touch. A canvas must never look like there is nothing to do.',
			'Bottom sheets under 640px — pickers anchored to cramped zones become full-width bottom sheets: thumb-reachable, 44px rows, a 44×5px grab handle, no input autofocus. Desktop keeps the anchored popover, flipping upward when space runs out.',
			'Keyboard conventions — Escape closes (or backs out one level, then closes); arrows rove within menus; Enter/Space activate; modals trap Tab; hover-opened surfaces never steal focus.',
			'aria-labels on icon-only buttons — every glyph button names its action (“Add a block here”, “Delete block”, “Move block up”, “Close builder”); the visible emoji/icon is decoration over a real accessible name.',
			'Long-press = context menu — touch reaches right-click surfaces through the native contextmenu event, not a bespoke gesture recogniser.',
			'Focus reveals — :focus-visible shows the same affordances hover does, so the hover reveal is sugar, never a gate.'
		],
		stories: touchA11yStories,
		propTables: [
			{
				title: 'CHROME_TOUCH_SX',
				source: 'remix/app/components/Builder/WebpageBlocksRenderer.tsx (module const, line 58)',
				rows: [
					{ name: 'userSelect / WebkitUserSelect', type: "'none'", description: 'Long-pressing or drag-scrubbing chrome must not start a text selection — selection is for content.' },
					{ name: 'WebkitTouchCallout', type: "'none'", description: 'Suppresses the iOS long-press callout (copy/share sheet) on controls.' },
					{ name: 'WebkitTapHighlightColor', type: "'transparent'", description: 'Kills the grey tap flash; feedback comes from the control’s own hover/active states.' },
					{ name: 'touchAction', type: "'manipulation'", description: 'Opts out of double-tap-to-zoom so taps dispatch immediately (no 300ms heuristic wait).' },
					{ name: '(scope)', type: 'controls only', description: 'Applied per-control via sx — never on content containers; page text stays selectable.' }
				]
			},
			{
				title: 'useCoarsePointer()',
				source: 'remix/app/components/Builder/WebpageBlocksRenderer.tsx (module hook, line 68)',
				rows: [
					{ name: 'returns', type: 'boolean', description: "matchMedia('(pointer: coarse)').matches, tracked live via the media query’s change event — a tablet gaining a trackpad flips it at runtime." },
					{ name: 'try/catch shell', type: 'SSR/embedded safety', description: 'matchMedia can be absent (SSR) — the hook defaults to false rather than throwing.' },
					{ name: 'usage', type: 'visible = active || alwaysVisible || coarse', description: 'The InsertZone’s visibility formula: hover state, structural always-on zones (empty containers, end of root), or a coarse pointer.' }
				]
			},
			{
				title: 'InsertZone (the 44px strip)',
				source: 'remix/app/components/Builder/WebpageBlocksRenderer.tsx (line ~89)',
				rows: [
					{ name: 'height', type: "'44px' visible / '18px' collapsed", description: 'The WHOLE strip is the tap target when visible; the slim line is only the resting hint. The pill is just the label.' },
					{ name: 'alwaysVisible', type: 'boolean', description: 'Empty containers and the end of the root list keep their zone visible — a canvas must never look like there is nothing to do.' },
					{ name: 'aria-label', type: '"Add a block here"', description: 'A real button element with a real name — the + affordance is never a bare clickable div.' }
				]
			},
			{
				title: 'BlockInsertMenu (the responsive picker)',
				source: 'remix/app/components/Builder/BlockInsertMenu.tsx',
				rows: [
					{ name: 'sheet', type: 'window.innerWidth < 640', description: 'Below 640px the picker renders as a bottom sheet (Squarespace-style) — a popover anchored to a cramped zone is exactly what made mobile taps miserable.' },
					{ name: 'grab handle', type: '44×5px pill', description: 'The sheet leads with the standard drag affordance (line 153) so it reads as a sheet at a glance.' },
					{ name: 'autofocus', type: 'desktop only', description: 'The search input focuses on desktop; on the sheet it deliberately does not — the mobile keyboard would pop over the sheet.' },
					{ name: 'placement', type: 'flip-aware', description: 'Desktop opens below the anchor, flipping above when space below < 260px and above has more room; maxHeight clamps 180–380px so it never grows past the viewport.' },
					{ name: 'dismissal', type: 'outside-press + Escape', description: 'mousedown outside the menu and event.code === "Escape" both close it — the standard pair for every transient surface.' }
				]
			}
		],
		guidelines: {
			intro:
				'These rules exist because the builder’s first two rounds shipped mouse-first: hover-only affordances, glyph-sized targets, popovers pinned to cramped corners, long-presses selecting chrome text. Round 3 fixed them systematically and the fixes are now the house baseline for EVERY interactive surface: assume a thumb, assume no hover, assume a screen reader — the mouse experience falls out fine, and the reverse is never true.',
			dos: [
				'Give every control a ≥44px hit area — pad small glyphs with transparent button area (the InsertZone trick) rather than inflating icons.',
				'Spread CHROME_TOUCH_SX (or its five properties) onto interactive chrome: handles, zones, chips, toolbars, pills.',
				'Check useCoarsePointer (or :focus-visible) before hiding an affordance behind hover — touch and keyboard users must see it too.',
				'Render pickers and option menus as bottom sheets under 640px, with 44px rows and no autofocus.',
				'Label every icon-only button with aria-label naming the ACTION (“Delete block”), not the icon (“trash”).',
				'Close every transient surface on Escape and outside-press; let modals trap Tab and menus rove with arrows.'
			],
			donts: [
				'Don’t apply userSelect: none to content — the recipe is for controls; a page you cannot copy from is broken.',
				'Don’t gate any capability behind hover, drag, or long-press alone — each needs a visible/keyboard-reachable equivalent.',
				'Don’t autofocus inputs inside bottom sheets — the keyboard covers the sheet you just opened.',
				'Don’t ship a bare clickable Box/div where a button belongs — real <button> elements bring focus, Enter/Space, and semantics for free.',
				'Don’t rely on the tap-highlight flash for feedback after making it transparent — the control’s own active/hover state must respond.',
				'Don’t detect touch by user-agent or screen width — pointer: coarse is the signal, and it can change at runtime.'
			]
		},
		accessibility: [
			'44px targets are a motor-accessibility floor, not just a touch nicety — they serve tremor, stylus, and low-vision zoom users equally.',
			'aria-labels on icon-only buttons give every glyph control a real accessible name; the builder’s full set (“Add a block here”, “Move block up/down”, “Delete block”, “Open the builder inspector”, “Close builder”) is the model.',
			'touch-action: manipulation removes the tap delay without disabling pinch-zoom on the page — never use touch-action: none on anything scrollable.',
			'Coarse-pointer always-visible affordances double as cognitive-accessibility wins: capabilities are discoverable without knowing to hover.',
			'Focus-visible reveals mean keyboard users get the same affordances hover users do, in the same places.',
			'Escape-to-close and outside-press-to-dismiss are consistent across sheets, popovers, and menus — muscle memory transfers, and no surface strands focus.'
		],
		keyboard: [
			{ keys: 'Tab / Shift+Tab', action: 'Move between controls (native order); modals trap the cycle' },
			{ keys: 'Enter / Space', action: 'Activate the focused control (real buttons make this free)' },
			{ keys: 'Esc', action: 'Close the sheet/popover/menu — or back out one drill level first (ThingContextMenu)' },
			{ keys: '↓ / ↑', action: 'Rove within menus and pickers' },
			{ keys: 'focus-visible', action: 'Reveals the same affordances hover does — hover is never the only way in' }
		],
		tokens: [
			{ token: '--tt-accent', usedFor: 'Primary affordances — insert lines, active targets', preview: 'color' },
			{ token: '--tt-accent-tint', usedFor: 'Active/hover washes on touch affordances', preview: 'color' },
			{ token: '--tt-surface-hover', usedFor: 'Row hover/active feedback (replacing the tap flash)', preview: 'color' },
			{ token: '--tt-surface-alt', usedFor: 'Resting icon-button fills', preview: 'color' },
			{ token: '--tt-border', usedFor: 'The bottom sheet’s grab handle fill', preview: 'color' },
			{ token: '--tt-radius-pill', usedFor: 'Grab handles and chip affordances', preview: 'radius' },
			{ token: '--tt-shadow-panel', usedFor: 'Bottom sheet elevation', preview: 'shadow' },
			{ token: '--tt-shadow-popover', usedFor: 'Anchored picker elevation', preview: 'shadow' }
		],
		adoption: [
			'Done — the builder’s round-3 pass shipped the reference implementations: CHROME_TOUCH_SX on all chrome, the 44px InsertZone strip, coarse-pointer always-visible zones, and the under-640 bottom sheet with no autofocus.',
			'Done — the ThingContextMenu follows the same conventions: Esc back-then-close, roving arrows, long-press-as-contextmenu, generous drag/resize handles that gate nothing.',
			'Done — icon-only buttons across builder surfaces carry action-naming aria-labels.',
			'Ongoing — pre-round-3 surfaces (older hover-revealed row actions, glyph-sized icon buttons) adopt the rules as they are touched; a hover-only affordance or a sub-44px target in new code is a review blocker.'
		]
	}
];
