import type { DesignSystemEntry } from '../entries';
import { avatarIdentityStories } from './AvatarIdentityStories';
import { brandMarkStories } from './BrandMarkStories';
import { iconStories } from './IconStories';
import { rainbowMotionStories } from './RainbowMotionStories';

// Identity group: how Thingtime looks like ITSELF — the dual icon language,
// the rainbow avatar circles, the rainbow/motion system, and the brand marks.

export const identityEntries: DesignSystemEntry[] = [
	{
		slug: 'icons',
		title: 'Icons',
		status: 'Adopted',
		summary:
			'Thingtime speaks two icon languages from one vocabulary: emoji first (the playful default — every icon IS an emoji), with a curated coloured Lucide twin behind a theme switch for surfaces that want the professional register. <Icon/> resolves semantic names ("wizard", "boolean", "trash") to emoji, then the theme’s iconStyle decides which language renders — and anything without a Lucide twin simply stays emoji, so the system degrades gracefully and the twin map grows lazily.',
		notes:
			'Live everywhere an icon appears: thing type badges, the context-menu rows, the drawer menu (every item carries an emoji icon), the nav cluster (👀 🎨 🌈 🦄), toasts, and the seedling/wizard triggers. The twin map (LUCIDE_FOR_EMOJI, ~66 pairs) and curated palette (LUCIDE_ICONS) live in ~/theme/icons.tsx; the switch is theme → general.iconStyle, read per-instance by useTtIconStyle().',
		anatomy: [
			'Resolver — Icon.tsx maps the name prop (an emoji glyph or a semantic alias like "wizard"/"crystal"/"boolean") to one emoji; plain glyphs (▸ ▾ ▢) pass through; unknown names render the 🤷‍♂️ shrug, never an error.',
			'Language switch — useTtIconStyle() reads theme overrides general.iconStyle (\'emoji\' default | \'lucide\'); in lucide mode the resolved emoji is swapped for its twin via LUCIDE_FOR_EMOJI.',
			'Curated palette — LUCIDE_ICONS maps kebab names → { Icon, color }: semantic theme vars where one fits (danger hearts, positive checks, muted chrome), rainbow stops 4/5 and a literal amber for flavour.',
			'Contextual override — an action/type row’s `lucide` field names a twin for the MEANING in context (string 💬 → "quote" not "message-circle"; collapse-all 🍂 → folding chevrons, not a leaf); unknown lucide names fall back to the emoji twin.',
			'Optical size — emoji fill their em box, Lucide strokes do not: twins render at ×1.15 of the requested px size, strokeWidth 2, so both languages carry the same weight.',
			'Personality layer — the "thingtime" name is a deterministic 🎄 on Dec 25, a 1% 🦄 roll, then the 🌳/🌀 everyday flip; "random" picks from the full emojis-list; secret names reward the curious.',
			'Wrapper — everything renders inside a Chakra <Center> with a 0.2s ease-out transition; size sets fontSize, chakras merge last for styling overrides.'
		],
		stories: iconStories,
		propTables: [
			{
				title: '<Icon/>',
				source: 'remix/app/components/Icon/Icon.tsx',
				rows: [
					{
						name: 'name',
						type: 'string',
						description:
							'An emoji glyph ("🌈"), a semantic alias ("wizard", "crystal", "boolean", "trash", "seedling", …), or a plain glyph (▸ ▾ ▢). Unknown names render 🤷‍♂️. The resolution is memoised on [name].'
					},
					{
						name: 'lucide',
						type: 'string',
						description:
							'Contextual Lucide twin by LUCIDE_ICONS key — wins over the emoji’s default twin in lucide mode only. Names missing from LUCIDE_ICONS silently fall back to LUCIDE_FOR_EMOJI[emoji].'
					},
					{
						name: 'size',
						type: 'string | number',
						defaultValue: "'14' (lucide px basis)",
						description:
							'Emoji font-size. Lucide twins draw at Math.round((parseFloat(size) || 14) × 1.15) px to match optical size.'
					},
					{
						name: 'chakras',
						type: 'Chakra props',
						description: 'Merged onto the Center wrapper after the top-level props, so they win (opacity, transforms, cursor).'
					},
					{
						name: '…props',
						type: 'Chakra props',
						description: 'Everything else spreads onto the Center (transform, onClick via a wrapping trigger, etc.).'
					}
				]
			},
			{
				title: 'Icon language data',
				source: 'remix/app/theme/icons.tsx',
				rows: [
					{
						name: 'LUCIDE_ICONS',
						type: 'Record<string, TtLucideIconDef>',
						description:
							'The curated palette: ~90 kebab names → { Icon, color }. Colours are semantic theme vars (accent/ink/text/muted/link/positive/danger/warning), rainbow stops 4/5 for blue/purple, plus one literal amber.'
					},
					{
						name: 'LUCIDE_FOR_EMOJI',
						type: 'Record<string, string>',
						description:
							'The bridge: emoji → twin name (~66 mappings, 🎨→palette, 🗑️→trash-2, 🍂→chevrons-down-up…). Emoji not in the map stay emoji in both modes — deliberate for one-offs like 🦄.'
					},
					{
						name: 'TtLucideIconDef',
						type: '{ Icon: ComponentType; color: string }',
						description: 'A Lucide component plus its assigned colour; consumers render <def.Icon size color strokeWidth={2}/>.'
					}
				]
			},
			{
				title: 'useTtIconStyle()',
				source: 'remix/app/hooks/useTtTheme.tsx',
				rows: [
					{
						name: 'returns',
						type: "'emoji' | 'lucide'",
						defaultValue: "'emoji'",
						description:
							'The active icon language, read straight from thingtime.settings.theme.overrides.general.iconStyle without a full theme resolve — cheap enough for the hundreds of Icon instances a thing tree renders. Every builtin preset defaults to emoji.'
					}
				]
			}
		],
		guidelines: {
			intro:
				'Emoji are the voice, Lucide is the register. Components always render icons through <Icon/> with a meaningful name and let the theme pick the language — never branch on iconStyle yourself, and never import a Lucide component directly into product chrome. When an icon’s emoji is a metaphor (🍂 for collapse-all, 📚 for arrays), give the row a contextual `lucide` name that draws the meaning, not the object.',
			dos: [
				'Render every UI icon through <Icon/> so the theme switch, optical sizing, and fallback chain apply everywhere at once.',
				'Prefer semantic names ("wizard", "seedling", "trash") over raw glyphs in callers — intent survives icon-art changes.',
				'Add a `lucide` field to menu/type rows whose emoji is metaphorical — pick the Lucide icon for the meaning in context.',
				'Grow the maps lazily: a new emoji works immediately; add its twin to LUCIDE_FOR_EMOJI (and LUCIDE_ICONS if new) when the lucide register needs it.',
				'Colour new palette entries with semantic theme vars first (danger/positive/muted…), rainbow stops only for flavour.',
				'Pair icons with visible text labels in menus and rows — the icon seasons the label, it never replaces it.'
			],
			donts: [
				'Don’t import lucide-react directly in product surfaces — the curated LUCIDE_ICONS palette is the only Lucide entry point, so colours stay consistent.',
				'Don’t branch on useTtIconStyle() in feature code — <Icon/> owns the switch; callers stay language-agnostic.',
				'Don’t map every emoji to a twin for completeness — deliberately unmapped glyphs (🦄) are part of the language: some things are only themselves.',
				'Don’t use an icon as the sole carrier of meaning or state — the accessibility rule from the token system applies to glyphs too.',
				'Don’t hand-scale Lucide twins — the ×1.15 compensation lives in Icon.tsx; other factors drift the optical weight.'
			]
		},
		accessibility: [
			'Emoji are announced by screen readers with their Unicode names — fine as decoration beside a visible label, unpredictable alone; every menu row and drawer item pairs its icon with text.',
			'The Center wrapper carries no role: icons are presentational by default, and interactive wrappers (the wizard trigger, nav links) own the semantics, titles, and labels.',
			'Lucide twins inherit curated colours from theme vars, so contrast follows the active theme; twins render at strokeWidth 2 for legibility at 12–16px UI sizes.',
			'The 🤷‍♂️ unknown-name fallback keeps a broken name visible in review instead of silently rendering nothing.',
			'The seasonal/random "thingtime" glyphs are decorative brand play on non-interactive marks — never on controls whose icon must stay recognisable.'
		],
		keyboard: [{ keys: '—', action: 'Icons are presentational; interaction belongs to the wrapping trigger/control.' }],
		tokens: [
			{ token: '--tt-accent', usedFor: 'Twin colour — brand/celebration icons (palette, heart-pulse, gift)', preview: 'color' },
			{ token: '--tt-ink', usedFor: 'Twin colour — eye', preview: 'color' },
			{ token: '--tt-text', usedFor: 'Twin colour — clipboard, copy', preview: 'color' },
			{ token: '--tt-muted', usedFor: 'Twin colour — chrome icons (settings, chevrons, search, user)', preview: 'color' },
			{ token: '--tt-link', usedFor: 'Twin colour — link, mail, share, save, users', preview: 'color' },
			{ token: '--tt-positive', usedFor: 'Twin colour — check, plus, thumbs-up, globe, sprout', preview: 'color' },
			{ token: '--tt-danger', usedFor: 'Twin colour — trash-2, x, hearts', preview: 'color' },
			{ token: '--tt-warning', usedFor: 'Twin colour — sparkles, star, sun, pencil, pin, alerts', preview: 'color' },
			{ token: '--tt-rainbow-4', usedFor: 'Twin colour — blue flavour (brackets, hash, image, rocket)', preview: 'color' },
			{ token: '--tt-rainbow-5', usedFor: 'Twin colour — purple flavour (gem, moon, music, wand)', preview: 'color' }
		],
		adoption: [
			'Done — <Icon/> is the single icon entry point across nav, drawer, context menus, type badges, and toasts; the lucide switch ships in theme settings (general.iconStyle).',
			'Done — context-menu and type rows carry contextual `lucide` names (contextMenuModel.ts) so the professional register reads meaning, not metaphor.',
			'Ongoing — the twin map grows lazily as surfaces are touched; unmapped emoji intentionally remain emoji in both modes.',
			'Next — audit the handful of legacy surfaces still rendering raw emoji strings outside <Icon/> so the language switch covers them too.'
		]
	},
	{
		slug: 'avatars-and-identity',
		title: 'Avatars + identity',
		status: 'Adopted',
		summary:
			'Who you are, drawn the same way everywhere: a 999px circle that shows your uploaded avatar when set and otherwise your initial in white 700-weight over the animated brand rainbow. The same idiom scales from the 22px feed byline to the 96px profile header (ringed in 4px of card colour over the banner), the profile banner falls back to the moving rainbow, and the nav marks the signed-in identity with the 🌈. Grey means nobody, rainbow means somebody.',
		notes:
			'Four sibling components share the recipe: UserAvatarCircle (nav/drawer, current user via useCurrentUser), ProfileAvatarCircle + ProfileBanner (profile header and EditProfileModal’s live preview), and AuthorAvatar (feed posts/comments, wraps itself in a /profile/:username link). All read RAINBOW from ~/theme/rainbow, so custom themes re-tint every avatar live.',
		anatomy: [
			'Circle — width = height = size, borderRadius 999px, flexShrink 0; an image avatar renders object-fit: cover inside, the fallback renders the initial centred.',
			'Rainbow fallback — background RAINBOW (blue-first gradient var), white initial at fontWeight 700; the profile-header variant animates it with var(--tt-rainbow-anim).',
			'Nobody state — no user/author: surface-alt background with "?" (feed) or the 🌈 icon (nav, signed out); temporary users read "Anonymous" via getUserDisplayName.',
			'Size ladder — 96px profile header (borderWidth 4px card ring) · 36px post headers, comments, composer · 28px nav + drawer · 22px shared-post bylines.',
			'Banner — ProfileBanner: uploaded image cover-fit, or the animated RAINBOW strip; radius-lg corners, heights [140px, 220px] on /profile.',
			'Author row — avatar + display name (xs/700 ink) + middot + muted relative timestamp that permalinks to /post/:id; the avatar itself links to the author’s profile.',
			'Nav cluster — display name at xs/600 beside the mirrored 🌈 (scaleX −100% on desktop) linking to /profile; signed out it reads "Login" at 0.5 opacity with the same 🌈.'
		],
		stories: avatarIdentityStories,
		propTables: [
			{
				title: '<UserAvatarCircle/> (nav + drawer)',
				source: 'remix/app/components/Nav/Drawer/DrawerContent.tsx',
				rows: [
					{ name: 'size', type: 'string', defaultValue: "'28px'", description: 'Circle diameter.' },
					{ name: 'fontSize', type: 'string', defaultValue: "'xs'", description: 'Initial size (also the 🌈 icon size when signed out).' },
					{
						name: '(data)',
						type: 'useCurrentUser()',
						description:
							'Reads the root-loader user — no fetch. Set avatarUrl always wins (with a 1px border); signed-in fallback is the rainbow initial; signed out renders the 🌈 icon on surface-alt.'
					}
				]
			},
			{
				title: '<ProfileAvatarCircle/> + <ProfileBanner/>',
				source: 'remix/app/components/Profile/ProfilePage.tsx',
				rows: [
					{ name: 'avatarUrl / name', type: 'string | null / string', description: 'Image wins; otherwise the first character of name, uppercased, over the rainbow.' },
					{ name: 'size / fontSize', type: "string / string", defaultValue: "— / '2xl'", description: 'Diameter and initial size; /profile uses 96px.' },
					{
						name: 'borderWidth',
						type: 'string',
						description: 'Optional ring in card colour (`4px` on the profile header) so the circle reads over banner imagery and rainbow alike.'
					},
					{
						name: 'ProfileBanner: bannerUrl / height / radius',
						type: 'string | null / string | string[] / string',
						defaultValue: "— / — / 'var(--tt-radius-lg)'",
						description:
							'Banner strip: cover-fit image when set, otherwise the animated rainbow (backgroundSize calc(100px + 200%), animation var(--tt-rainbow-anim)). Shared with EditProfileModal’s preview.'
					}
				]
			},
			{
				title: '<AuthorAvatar/> (feed)',
				source: 'remix/app/components/Feed/PostCard.tsx',
				rows: [
					{
						name: 'author',
						type: 'FeedAuthor | null',
						description: 'null renders the "?" circle on surface-alt with no link — the byline pairs it with "Anonymous 👻".'
					},
					{ name: 'size / fontSize', type: 'string / string', defaultValue: "'36px' / 'sm'", description: '22px/10px in shared-post sub-cards, 36px on post headers and comments.' },
					{
						name: '(behaviour)',
						type: 'Link wrap',
						description: 'When author.username exists the circle wraps itself in a Link to /profile/:username — callers never re-wrap. Images load lazily.'
					}
				]
			},
			{
				title: 'Identity helpers',
				source: 'remix/app/utils/userIdentity.ts',
				rows: [
					{
						name: 'getUserDisplayName(user)',
						type: '(PresentableUserIdentity) => string',
						description: 'temporary → "Anonymous", else displayName || username — the one naming rule every surface uses.'
					},
					{
						name: 'getUserIdentityDetail(user)',
						type: '(PresentableUserIdentity) => string',
						description: 'temporary → "Login to claim", else "@username" — the secondary line under display names.'
					}
				]
			}
		],
		guidelines: {
			intro:
				'One circle, one naming rule, one meaning. Identity surfaces compose the existing avatar components instead of redrawing the recipe, name people only through getUserDisplayName, and keep the colour semantics honest: the rainbow belongs to real signed-in identity, surface-alt grey to absence. The initial fallback means every user has a face from second one — avatars are never blank while an upload is missing.',
			dos: [
				'Reuse the sibling closest to your surface (AuthorAvatar in feed-shaped UI, ProfileAvatarCircle where you have explicit profile data, UserAvatarCircle for the current viewer).',
				'Stay on the size ladder — 96 / 36 / 28 / 22 — so identity reads consistently across surfaces.',
				'Name users through getUserDisplayName / getUserIdentityDetail; never concatenate username logic inline.',
				'Keep the 4px card-colour ring when a large avatar overlaps imagery (banner, cover) — it is what keeps the circle legible over the rainbow.',
				'Let AuthorAvatar own its profile link; add surrounding links to the name text, not around the avatar again.',
				'Animate the rainbow fallback only via var(--tt-rainbow-anim) so avatars freeze with the motion switch.'
			],
			donts: [
				'Don’t hand-roll a new avatar circle — the recipe (999px, cover image, white 700 initial over RAINBOW) already exists at every needed size.',
				'Don’t use the rainbow fill for anything that is not a person — grey "?" is the anonymous state; rainbow on empty states lies about presence.',
				'Don’t re-type the gradient hexes — import RAINBOW from ~/theme/rainbow so custom themes re-tint identity everywhere at once.',
				'Don’t show usernames where getUserDisplayName would show "Anonymous" — temporary accounts must not leak their claim names into UI.',
				'Don’t nest the avatar’s Link inside another anchor — wrap the row’s other elements instead.'
			]
		},
		accessibility: [
			'Image avatars carry the author’s display name as alt text (AuthorAvatar/UserAvatarCircle), so screen readers announce who is pictured; decorative banner images use empty alt.',
			'The initial fallback is real text (white, 700) over the rainbow — high contrast against every stop, and it scales with the circle.',
			'Avatar links are real <Link> anchors to /profile/:username: keyboard focusable, middle-clickable, announced as links.',
			'Presence is never colour-alone: the anonymous state pairs the grey circle with the visible "Anonymous 👻" label, and signed-out nav pairs the 🌈 with the word "Login".',
			'Banner and avatar rainbow animation rides var(--tt-rainbow-anim), so reduced-motion themes freeze identity surfaces along with everything else.'
		],
		keyboard: [
			{ keys: 'Tab', action: 'Focus avatar/name links in DOM order (avatar and name are separate links to the same profile)' },
			{ keys: 'Enter', action: 'Follow the focused profile / timestamp permalink' }
		],
		tokens: [
			{ token: '--tt-gradient-rainbow', usedFor: 'Avatar + banner fallback fill (via RAINBOW)', preview: 'color' },
			{ token: '--tt-rainbow-anim', usedFor: 'Banner/header rainbow motion (none when motion is off)' },
			{ token: '--tt-surface-alt', usedFor: 'Nobody state — “?” circle, image letterboxing', preview: 'color' },
			{ token: '--tt-border', usedFor: 'Hairline around uploaded nav avatars', preview: 'color' },
			{ token: '--tt-card', usedFor: 'The 4px profile-header avatar ring', preview: 'color' },
			{ token: '--tt-radius-lg', usedFor: 'Banner corners', preview: 'radius' },
			{ token: '--tt-ink', usedFor: 'Author names', preview: 'color' },
			{ token: '--tt-muted', usedFor: 'Timestamps, @username lines', preview: 'color' },
			{ token: '--tt-font-heading', usedFor: 'Profile display names', preview: 'font' },
			{ token: '--tt-font-mono', usedFor: '@username + joined metadata', preview: 'font' }
		],
		adoption: [
			'Done — the four siblings cover nav/drawer, profile (+ edit preview), and every feed surface; all fall back to the shared rainbow-initial recipe.',
			'Done — anonymous/temporary handling unified through getUserDisplayName ("Anonymous", grey circle, no link).',
			'Ongoing — the recipe is duplicated per sibling by design (each is a few lines); if a fifth surface appears, extract the circle into a shared component rather than copying a sixth time.',
			'Next — account-switcher and messenger rosters reuse UserAvatarCircle/AuthorAvatar as they grow rather than inventing local variants.'
		]
	},
	{
		slug: 'rainbow-and-motion',
		title: 'Rainbow + motion',
		status: 'Adopted',
		summary:
			'The brand’s pulse: three canonical gradient forms (RAINBOW for tiles and borders, RAINBOW_TEXT for animated headlines, RAINBOW_CONIC for rings) panned by one shared keyframe vocabulary (moving-rainbow + the tt-* set in GlobalStyles.tsx), all governed by one theme switch — general.motion writes --tt-rainbow-anim for CSS and --tt-motion for JS, so every decorative animation in the app freezes from a single toggle. Celebration is a bus: burstAtEvent() fires the app-root ConfettiCanvas, which self-gates on the same switch.',
		notes:
			'Live on the landing hero, page-scaffold rainbow headlines, avatar/banner fallbacks, the Lopu toast frame, DevKit trigger ring, and the nav unicorn’s tt-gallop easter egg. The gradients are exported once from ~/theme/rainbow; the keyframes are registered once in GlobalStyles.tsx (see docs/design/DESIGN_LANGUAGE.md); the switch is written once in themeToCssVars().',
		anatomy: [
			'RAINBOW — var(--tt-gradient-rainbow): blue-first 90deg loop for borders, buttons, bars; starts and ends on the same stop so the tile wraps seamlessly.',
			'RAINBOW_TEXT — var(--tt-gradient-rainbow-x): red-first loop for headline text via background-clip: text.',
			'RAINBOW_CONIC — conic sweep over the five stop vars for spinner/trigger rings; animates by rotation, not background-position.',
			'The pan recipe — backgroundSize: calc(100px + 200%) + animation: var(--tt-rainbow-anim, moving-rainbow 5s linear infinite); the var resolves to none when motion is off.',
			'tt-* keyframes — one global vocabulary: tt-pop (content enter), tt-toast-in (toast drop), tt-blink (carets), tt-bob (floaters), tt-pan (shimmer), tt-gallop (the 🥚 nav unicorn), all registered in GlobalStyles.tsx.',
			'The switch — theme general.motion → --tt-rainbow-anim (shorthand | none) + --tt-motion (1 | 0); --tt-anim-speed (animSpeed ms, default 200) is the separate base duration for functional UI transitions.',
			'motionOK gating — imperative effects use the ConfettiCanvas recipe: prefers-reduced-motion OR --tt-motion === "0" means do nothing.',
			'Confetti — burstConfetti/burstAtEvent dispatch a tt:confetti CustomEvent; the single app-root ConfettiCanvas draws square confetti (celebration palette, ≤200 particles/burst) and owns the gate.'
		],
		stories: rainbowMotionStories,
		propTables: [
			{
				title: 'Rainbow gradients',
				source: 'remix/app/theme/rainbow.ts',
				rows: [
					{ name: 'RAINBOW', type: 'string', description: 'var(--tt-gradient-rainbow, …) — blue-first 90deg looping gradient. Borders, buttons, bars, avatar fills.' },
					{ name: 'RAINBOW_TEXT', type: 'string', description: 'var(--tt-gradient-rainbow-x, …) — red-first loop for background-clip headline text.' },
					{ name: 'RAINBOW_CONIC', type: 'string', description: 'Conic sweep of the five stop VARS (blue → purple → red → amber → green → blue) — rings and spinners.' },
					{ name: 'RAINBOW_VARS', type: 'string[5]', description: 'Individual stops as var() strings with literal fallbacks — dots, depth guides, accents.' },
					{ name: 'RAINBOW_PALETTE', type: '[string ×5]', description: 'Raw default hexes — only for seeding theme documents, never for component styling.' }
				]
			},
			{
				title: 'Shared keyframes',
				source: 'remix/app/globals/GlobalStyles.tsx',
				rows: [
					{ name: 'moving-rainbow', type: '@keyframes', description: 'background-position 0 → calc(100px + 200%) — the gradient pan; always reached through var(--tt-rainbow-anim).' },
					{ name: 'tt-pop', type: '@keyframes', description: 'opacity 0 + translateY(10px) → rest. Content entering; play once with `both` fill.' },
					{ name: 'tt-toast-in', type: '@keyframes', description: 'opacity 0, translateY(−12px) scale(0.97) → rest. Toast arrival.' },
					{ name: 'tt-blink', type: '@keyframes', description: '50% opacity 0, steps(1) — text carets and typing indicators.' },
					{ name: 'tt-bob', type: '@keyframes', description: 'translateY 0 → 6px → 0 — floating decorative accents; decorative, gate it.' },
					{ name: 'tt-pan', type: '@keyframes', description: 'background-position → 200% center — shimmer text over a 200%-wide gradient.' },
					{ name: 'tt-gallop', type: '@keyframes', description: '🥚 translateX/rotate romp — the nav unicorn’s 7-click victory gallop.' }
				]
			},
			{
				title: 'The motion switch',
				source: 'remix/app/theme/tokens.ts (themeToCssVars)',
				rows: [
					{ name: 'general.motion', type: 'boolean', defaultValue: 'true', description: 'The theme’s master decorative-motion switch.' },
					{ name: '--tt-rainbow-anim', type: 'CSS var', description: "'moving-rainbow 5s linear infinite' when motion is on, 'none' when off — the shorthand every gradient animation rides." },
					{ name: '--tt-motion', type: "CSS var ('1' | '0')", description: 'The JS-readable flag; imperative effects check it before animating.' },
					{ name: '--tt-anim-speed', type: 'CSS var (ms)', defaultValue: "'200ms'", description: 'Base duration for functional UI transitions — independent of the decorative switch.' }
				]
			},
			{
				title: 'Confetti bus',
				source: 'remix/app/components/Landing/confetti.ts · ConfettiCanvas.tsx',
				rows: [
					{ name: 'burstConfetti(x, y, count?)', type: 'fn', defaultValue: 'count 60', description: 'Dispatches the tt:confetti CustomEvent at viewport coordinates; safe no-op outside the browser.' },
					{ name: 'burstAtEvent(event, count?)', type: 'fn', description: 'Convenience: bursts from a pointer event’s clientX/Y (centre-screen fallback).' },
					{ name: '<ConfettiCanvas/>', type: 'component', description: 'The single app-root listener: draws square confetti in the celebration palette, caps bursts at 200 particles, and refuses to fire when reduced-motion or --tt-motion: 0.' }
				]
			}
		],
		guidelines: {
			intro:
				'Motion is one vocabulary with one off switch. Decorative movement (gradient pans, bobs, shimmer, confetti) must be stoppable from the theme toggle without touching any component; functional feedback (enters, toasts, ~200ms transitions on --tt-anim-speed) plays regardless because it communicates state, not personality. If an animation cannot say which of the two it is, it is decorative — gate it.',
			dos: [
				'Reach every gradient through ~/theme/rainbow and animate it only via var(--tt-rainbow-anim, …) with backgroundSize: calc(100px + 200%).',
				'Use the shared tt-* keyframes by name; register a genuinely new move in GlobalStyles.tsx so the vocabulary stays in one file.',
				'Gate imperative/JS-driven motion with the ConfettiCanvas recipe: prefers-reduced-motion OR --tt-motion === "0" → do nothing.',
				'Ride --tt-anim-speed for functional transitions so themes can tune UI tempo independently of the decorative switch.',
				'Fire confetti through burstAtEvent from the user’s own click, on real milestones, and let the canvas own the gate.',
				'Keep one animated rainbow element per screen — the headline OR a hero tile, not a chorus.'
			],
			donts: [
				'Don’t write literal `animation: moving-rainbow …` — without the var wrapper the motion switch cannot stop it.',
				'Don’t register private @keyframes for moves the tt-* set already covers — duplicate vocab drifts timing and easing.',
				'Don’t animate layout properties for decoration — the language is background-position, transform, and opacity.',
				'Don’t mount extra ConfettiCanvas instances or draw your own particles — one root canvas, one event bus.',
				'Don’t celebrate on the app’s behalf: no confetti on page load, on errors, or on anything the user didn’t just do.',
				'Don’t re-order or re-type the five stops — blue-first (RAINBOW) vs red-first (RAINBOW_TEXT) exists so each tile loops seamlessly.'
			]
		},
		accessibility: [
			'One toggle stops everything decorative: theme motion off resolves --tt-rainbow-anim to none and flips --tt-motion to 0 — CSS and JS obey the same switch.',
			'ConfettiCanvas additionally honours prefers-reduced-motion, so OS-level preferences win even before the user finds the theme toggle.',
			'Gradient headlines keep real text under background-clip — screen readers, selection, and find-in-page are unaffected by the paint.',
			'Functional animations are short, play once, and move elements at most ~12px — feedback without vestibular load; nothing decorative flashes (tt-blink is a caret at 1Hz, well under seizure thresholds).',
			'The confetti canvas is pointer-events: none decoration over the page; it never intercepts input or focus.'
		],
		keyboard: [{ keys: '—', action: 'Motion is presentational; the confetti demo button is a normal focusable button (Enter/Space).' }],
		tokens: [
			{ token: '--tt-gradient-rainbow', usedFor: 'RAINBOW — tiles, borders, bars', preview: 'color' },
			{ token: '--tt-gradient-rainbow-x', usedFor: 'RAINBOW_TEXT — headline clip fill', preview: 'color' },
			{ token: '--tt-rainbow-1', usedFor: 'Stop — red (conic + dots)', preview: 'color' },
			{ token: '--tt-rainbow-2', usedFor: 'Stop — amber', preview: 'color' },
			{ token: '--tt-rainbow-3', usedFor: 'Stop — green', preview: 'color' },
			{ token: '--tt-rainbow-4', usedFor: 'Stop — blue (both gradients start/end here or on red)', preview: 'color' },
			{ token: '--tt-rainbow-5', usedFor: 'Stop — purple', preview: 'color' },
			{ token: '--tt-rainbow-anim', usedFor: 'The animation shorthand every gradient pan rides (none when motion is off)' },
			{ token: '--tt-motion', usedFor: 'JS-readable 0/1 motion flag (ConfettiCanvas, gated effects)' },
			{ token: '--tt-anim-speed', usedFor: 'Base functional transition duration (200ms default)' }
		],
		adoption: [
			'Done — gradients unified in ~/theme/rainbow; keyframes unified in GlobalStyles.tsx; the motion switch writes --tt-rainbow-anim/--tt-motion from themeToCssVars().',
			'Done — ConfettiCanvas mounted once at the app root with the event-bus API; landing celebrations fire through burstAtEvent.',
			'Ongoing — decorative loops written before the switch migrate onto var(--tt-rainbow-anim)/motionOK gating as surfaces are touched.',
			'Next — a shared rotate keyframe for spinning conic rings if a real spinner ships; today RAINBOW_CONIC renders static.'
		]
	},
	{
		slug: 'brand-marks',
		title: 'Brand marks',
		status: 'Adopted',
		summary:
			'The Thingtime mark is data: logoMatrix.ts holds the voxel matrices (LOGO_ICON_MATRIX — the 3×3 plus — and LOGO_FULL_MATRIX, the wordmark), named colour maps, and a pure SVG builder, so the live DOM logo, the /branding previews, and the PNG export path all render the identical mark from one source. Around it sits the environment honesty convention: every non-production tab title is prefixed [LC]/[VC]/[TS]/[DEV] from the request hostname, so production is the only unprefixed Thingtime.',
		notes:
			'Live on the landing page (<Logo icon theme="nature"/> at several voxel sizes), the /branding press-kit page (buildLogoSvg previews + SVG/PNG exports with per-side padding), and every document title via root.tsx. The emoji marks (🌀/🌳 via the "thingtime" icon name, 🦄 in the nav) are the casual register of the same identity — see the Icons entry.',
		anatomy: [
			'Matrices — rows of colour-key strings; commas separate multi-glyph cells and render nothing ("111,020,030" = three voxels). LOGO_ICON_MATRIX is 3×3; LOGO_FULL_MATRIX is the 5-row wordmark.',
			'Colour maps — key → CSS colour; 0 is transparent; unknown keys fall back to colourMap[1] (resolveLogoColour), which is how the 3-entry pink map recolours the whole mark.',
			'Themes — LOGO_THEMES: default/nature/tt/thingtime share the 10-colour voxel palette; pink is the hotpink monochrome; a value of "random" re-rolls per voxel from the default palette.',
			'Trim — trimLogoCells strips fully-transparent outer rows/columns so every preview and export hugs the artwork (branding rule: assets ship with zero whitespace).',
			'Builder — buildLogoSvg({ matrix, colourMap, background?, trim?, padding?, pixelWidth? }) → one <rect> per voxel in cell units, shape-rendering: crispEdges, optional baked background and per-side cell padding, explicit width/height attrs when pixelWidth is set.',
			'DOM logo — <Logo/> renders the same matrix as hoverable voxel Boxes (voxelSize × unit squares) for the landing/nav presence.',
			'Title prefix — root-data.server.ts: thingtime.com → none, localhost/127.0.0.1 → [LC], *.vercel.app → [VC], *.ts.net → [TS], otherwise [DEV] (or [LC] in dev builds); root.tsx prepends it to every route title.'
		],
		stories: brandMarkStories,
		propTables: [
			{
				title: 'logoMatrix.ts (single source of truth)',
				source: 'remix/app/components/Branding/logoMatrix.ts',
				rows: [
					{ name: 'LOGO_ICON_MATRIX / LOGO_FULL_MATRIX', type: 'LogoMatrix', description: 'The 3×3 plus icon and the voxel wordmark; rows are strings of colour keys with comma cell-separators.' },
					{ name: 'LOGO_DEFAULT_COLOURS', type: 'LogoColourMap', description: 'The 10-colour voxel palette (keys 1–9, x) plus transparent 0.' },
					{ name: 'LOGO_THEMES', type: 'Record<string, LogoColourMap>', description: 'Named colourways: default/nature/tt/thingtime (shared palette) and pink (keys 0–2 only — fallback recolours everything).' },
					{ name: 'logoMatrixToCells(matrix)', type: 'fn', description: 'Matrix → string[][] cells, dropping comma separators — mirrors Logo.tsx exactly.' },
					{ name: 'resolveLogoColour(col, map)', type: 'fn', description: 'map[col] ?? map[1]; transparent/empty → undefined (no rect emitted).' },
					{ name: 'trimLogoCells(cells, map)', type: 'fn', description: 'Strips fully-transparent outer rows/columns — the zero-whitespace export rule.' },
					{
						name: 'buildLogoSvg({ matrix, colourMap, background?, trim?, padding?, pixelWidth? })',
						type: 'fn → { svg, columns, rows, totalColumns, totalRows, pixelHeight? }',
						defaultValue: 'trim: true',
						description:
							'The pure builder: cell-unit viewBox, crispEdges rects, optional baked background, per-side cell padding (fractional ok), explicit pixel size when pixelWidth is given.'
					}
				]
			},
			{
				title: '<Logo/> (live DOM logo)',
				source: 'remix/app/components/Branding/Logo.tsx',
				rows: [
					{ name: 'icon', type: 'boolean', description: 'Render LOGO_ICON_MATRIX instead of the full wordmark.' },
					{ name: 'theme', type: 'string', defaultValue: "'pink'", description: 'LOGO_THEMES key; landing uses "nature". Unknown themes fall back to pink.' },
					{ name: 'voxelSize / unit', type: 'number / string', defaultValue: "25 / 'px'", description: 'Square size per voxel — landing renders 6–15px depending on placement.' },
					{ name: 'matrix / colourMap', type: 'LogoMatrix / LogoColourMap', description: 'Full overrides for custom marks (the /branding playground).' },
					{ name: 'space / opacity', type: 'string / number', description: 'Margin+padding shorthand (space="0px" for flush placement) and opacity passthrough.' }
				]
			},
			{
				title: 'titlePrefix (environment honesty)',
				source: 'remix/app/root-data.server.ts · remix/app/root.tsx',
				rows: [
					{ name: 'thingtime.com', type: "→ ''", description: 'Production is the only unprefixed title.' },
					{ name: 'localhost / 127.0.0.1', type: "→ '[LC]'", description: 'Local dev (also the NODE_ENV=development fallback for other hostnames).' },
					{ name: '*.vercel.app', type: "→ '[VC]'", description: 'Vercel previews.' },
					{ name: '*.ts.net', type: "→ '[TS]'", description: 'Tailscale funnel shares.' },
					{ name: '(anything else)', type: "→ '[DEV]'", description: 'Unknown non-prod hosts in production builds.' },
					{
						name: 'root.tsx title effect',
						type: 'document.title',
						description: 'Writes "<prefix> Thingtime" plus the route suffix ("- Feed", "docs", "- Settings", …) on every navigation; statusEnvironment.ts mirrors the same host rules for /status badges.'
					}
				]
			}
		],
		guidelines: {
			intro:
				'The mark is edited as data and rendered by one builder. New colourways are colour maps, new lockups are matrices, and every rendering path — DOM, SVG preview, PNG export — must go through logoMatrix.ts so the voxels can never drift between surfaces. The title prefix is part of the brand too: it is how Thingtime never impersonates itself — a tab that says plain “Thingtime” is production, full stop.',
			dos: [
				'Import matrices, themes, and the builder from ~/components/Branding/logoMatrix for anything that draws the mark.',
				'Add a colourway as a new LOGO_THEMES map (exploit the colourMap[1] fallback for monochromes) — never fork or hand-edit a matrix for colour.',
				'Keep trim on for exports and previews; add breathing room via the padding option, in cell units, not by editing the matrix.',
				'Use <Logo icon …/> for in-page presence (it scales by voxelSize) and buildLogoSvg for assets, favicons, and anything leaving the DOM.',
				'Preserve the [LC]/[VC]/[TS]/[DEV] hostname rules when adding environments, and update statusEnvironment.ts in the same change.'
			],
			donts: [
				'Don’t paste logo SVG/PNG snapshots into the repo or a component — generated marks drift; the matrix is the artwork.',
				'Don’t ship a mark with baked-in whitespace — trimLogoCells is the contract; padding is an explicit export option.',
				'Don’t recolour by editing matrix keys — keys are structure, maps are colour.',
				'Don’t add a title prefix to production or strip it from non-prod surfaces — the whole point is that the absence of a prefix is the production signal.',
				'Don’t scale the DOM logo with CSS transforms — set voxelSize; the voxels stay crisp because they are real boxes.'
			]
		},
		accessibility: [
			'SVG marks render as <img> with "Thingtime logo" alt text where they stand alone; purely decorative placements use empty alt.',
			'The mark never carries text content — the wordmark is imagery, and adjacent real text ("Thingtime") does the naming for assistive tech.',
			'crispEdges rendering keeps voxel edges sharp at favicon sizes, where anti-aliasing would smear the 3×3 plus into noise.',
			'The title prefix is plain text at the very start of document.title, so screen readers and tab tooltips announce the environment before the app name.',
			'The DOM logo’s per-voxel hover fade is decorative only — no information is gated behind hovering pixels.'
		],
		keyboard: [{ keys: '—', action: 'Marks are imagery; the nav logo links are ordinary anchors covered by their own components.' }],
		tokens: [
			{ token: '--tt-card', usedFor: 'Fake-tab chrome in the title-prefix story; export backgrounds default to transparent', preview: 'color' },
			{ token: '--tt-ink', usedFor: 'Single-colour (monochrome) mark demos', preview: 'color' },
			{ token: '--tt-border', usedFor: 'Preview-frame hairlines on /branding', preview: 'color' },
			{ token: '--tt-radius-sm', usedFor: 'Preview/tab chip corners', preview: 'radius' },
			{ token: '--tt-font-mono', usedFor: 'Asset metadata, host labels, export details', preview: 'font' }
		],
		adoption: [
			'Done — matrices, themes, and the builder consolidated into logoMatrix.ts (claude-todo/08 §3); Logo.tsx, /branding previews, and the PNG exporter all consume it.',
			'Done — the title-prefix convention ships in root-data.server.ts + root.tsx, mirrored by statusEnvironment.ts for /status.',
			'Done — /branding offers SVG + PNG export with per-side padding and optional baked background from the same builder (brandingExport.ts).',
			'Next — favicon generation from LOGO_ICON_MATRIX via buildLogoSvg(pixelWidth) so the tab icon is derived, not a checked-in bitmap.'
		]
	}
];
