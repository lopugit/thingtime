import type { DesignSystemEntry } from '../entries';
import { cardsAndSectionsStories } from './CardsAndSectionsStories';
import { modalsAndPopoversStories } from './ModalsAndPopoversStories';
import { toastsStories } from './ToastsStories';

// Surfaces group: the raised/flat card language, the floating-surface stack
// (popovers, modals, sheets and their z ladder), and the Lopu toast — the
// three layers everything in Thingtime is presented on.

export const surfacesEntries: DesignSystemEntry[] = [
	{
		slug: 'cards-and-sections',
		title: 'Cards & sections',
		status: 'Adopted',
		summary:
			'The card language every content surface speaks: CARD_STYLES (~/theme/card) is the one raised-card recipe — --tt-card bg, 1px --tt-border, --tt-radius-lg, dialect-aware --tt-shadow-card — spread, never copied. Inside cards live two row idioms: SettingsSection/SettingRow (flat eyebrow sections with a control pinned right, whitespace-separated) and hairline label/value rows (borderTop --tt-border-light, first row borderless), plus the status readout-table variant that leads values with a meaning dot.',
		notes:
			'Live everywhere: CARD_STYLES cards on Schemas, Search, status, and the admin panels; SettingsSection/SettingRow across /settings (AlgorithmManager, NotificationSettings, PasskeysManager, TokenMinter); the same settingRow geometry hand-mirrored inside UserSettingsModal; hairline rows on the scaffolded pages; the readout table as StatusRow in components/Status/statusSections.tsx driving /status and the vercel panels. One nuance is intentional: SettingsSection is a FLAT card (border, no shadow) while CARD_STYLES is the elevated one — settings pages stack many sections and a page of shadows would rumble.',
		anatomy: [
			'CARD_STYLES — the elevated content card: bg --tt-card, border 1px solid --tt-border, borderRadius --tt-radius-lg, boxShadow --tt-shadow-card. Spread as {...CARD_STYLES}; padding is the caller’s (usually 5).',
			'SettingsSection — a flat card variant for stacked settings: same bg/border/radius, padding [5, 6], rowGap 3, deliberately shadowless. Header is the mono 10px/600/0.08em uppercase --tt-muted eyebrow plus an optional xs --tt-text description.',
			'SettingRow — label + hint left (sm --tt-ink over xs --tt-muted, minWidth 0), one control pinned right via marginLeft auto + flexShrink 0; columnGap 4, paddingY 2. Rows separate by whitespace, never rules.',
			'Hairline label/value rows — a 120px mono uppercase --tt-muted label column against sm --tt-ink values; each row borderTop 1px --tt-border-light EXCEPT the first, so the card border stays the only strong line.',
			'Readout table (status pattern) — space-between + baseline alignment instead of a fixed column; mono xs labels at 0.06em tracking; values lead with an 8–10px status dot (--tt-positive / --tt-warning / --tt-danger / --tt-muted) next to the word that actually carries the meaning.',
			'RainbowButton — the section-level primary CTA: white 600-weight heading text on the RAINBOW gradient, backgroundSize calc(100px + 200%), animated only through var(--tt-rainbow-anim) so the motion switch reaches it.'
		],
		stories: cardsAndSectionsStories,
		propTables: [
			{
				title: 'CARD_STYLES',
				source: 'remix/app/theme/card.ts',
				rows: [
					{ name: 'bg', type: 'string', defaultValue: "'var(--tt-card, #ffffff)'", description: 'The raised-card background.' },
					{ name: 'border / borderColor', type: 'string', defaultValue: "'1px solid' / 'var(--tt-border, #ececef)'", description: 'The card’s strong line — hairlines inside use --tt-border-light instead.' },
					{ name: 'borderRadius', type: 'string', defaultValue: "'var(--tt-radius-lg, 16px)'", description: 'Lg step; follows the theme radiusScale (square under Fable).' },
					{ name: 'boxShadow', type: 'string', defaultValue: "'var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))'", description: 'Resting elevation; the dialect switch renders it soft or hard.' },
					{ name: '(usage)', type: 'as const', description: 'Spread it — {...CARD_STYLES} — so one definition keeps sibling pages from drifting. Copying the values defeats the const’s whole purpose.' }
				]
			},
			{
				title: '<SettingsSection/> · <SettingRow/> · <RainbowButton/>',
				source: 'remix/app/components/Settings/SettingsSection.tsx',
				rows: [
					{ name: 'SettingsSection.eyebrow', type: 'string', description: 'The section’s mono uppercase header — names the group ("Notifications", "Passkeys").' },
					{ name: 'SettingsSection.description', type: 'string', description: 'Optional xs --tt-text paragraph under the eyebrow (whiteSpace normal, resetting Main’s pre-wrap).' },
					{ name: 'SettingsSection.children', type: 'React.ReactNode', description: 'Usually a stack of SettingRows; the section provides rowGap 3.' },
					{ name: 'SettingRow.label', type: 'React.ReactNode', description: 'The sm --tt-ink row label.' },
					{ name: 'SettingRow.hint', type: 'string', description: 'Optional xs --tt-muted line under the label — what the setting actually does.' },
					{ name: 'SettingRow.children', type: 'React.ReactNode', description: 'The control, pinned right (marginLeft auto, flexShrink 0): a Switch, segmented buttons, an input.' },
					{ name: 'RainbowButton', type: 'ButtonProps', description: 'Chakra Button pass-through over the RAINBOW gradient idiom (mirrors profile.tsx); animation rides var(--tt-rainbow-anim).' }
				]
			},
			{
				title: 'StatusRow (readout-table idiom)',
				source: 'remix/app/components/Status/statusSections.tsx (line ~77)',
				rows: [
					{ name: 'label', type: 'string', description: 'Mono xs 600 uppercase --tt-muted, letterSpacing 0.06em, flexShrink 0.' },
					{ name: 'first', type: 'boolean', description: 'True suppresses the borderTop hairline — the first-row-borderless rule.' },
					{ name: 'children', type: 'ReactNode', description: 'The value cell — free-form, typically a dot + text pair or a mono link. Rows are justify space-between, baseline-aligned, py 2.5.' }
				]
			}
		],
		guidelines: {
			intro:
				'One card recipe, two row voices. The card border is the strong line and everything inside stays quiet: settings rows separate by whitespace, readouts by --tt-border-light hairlines with the first row borderless. Elevation is a statement — CARD_STYLES cards float on the page wash, SettingsSection stacks flat — so pick the variant by how many siblings share the screen, not by taste.',
			dos: [
				'Spread {...CARD_STYLES} for any raised content card; add only padding and layout on top.',
				'Build settings-style surfaces from SettingsSection + SettingRow so /settings, modals, and future panels stay one idiom.',
				'Keep the first hairline row borderless and use borderTop (not borderBottom) — the last row then never doubles up with the card edge.',
				'Label readout rows in mono uppercase --tt-muted and keep values in --tt-ink; the value column is where the eye lands.',
				'Pair every status dot with the word it colours (Ready, Building…, Unreachable) — the dot is emphasis, the word is the information.',
				'Pin exactly one control per SettingRow to the right with marginLeft auto; wrap multi-button controls in their own Flex.'
			],
			donts: [
				'Don’t copy CARD_STYLES values into local styles — a token change then leaves your card drifted, which is the exact bug the const removed.',
				'Don’t add a shadow to SettingsSection or stack many elevated cards in a column — a page of shadows rumbles; flat sections exist for that.',
				'Don’t draw hairlines with --tt-border — that is the card’s line; inside rows use --tt-border-light or the hierarchy collapses.',
				'Don’t mix the two row voices in one card: a card is either a settings surface (whitespace rows, controls right) or a readout (hairline label/value), not both.',
				'Don’t rebuild the primary CTA gradient by hand — import RainbowButton so the motion switch and gradient stay themable.'
			]
		},
		accessibility: [
			'Row labels and values are real text in Flex/Grid layouts — copy/paste, find-in-page, and screen-reader linearisation follow the visual order.',
			'SettingRow hints sit directly under their labels in the same flow, so assistive tech reads label then hint before reaching the control.',
			'Status dots never carry meaning alone: every dot is adjacent to the state word, and the tone colours also differ in lightness.',
			'The default ramp keeps sm --tt-ink values and --tt-muted labels above AA on --tt-card; hints are secondary text, never the only carrier of essential information.',
			'RainbowButton animates only via var(--tt-rainbow-anim), so themes with motion off (and reduced-motion users on those themes) get a static gradient.'
		],
		keyboard: [{ keys: '—', action: 'Layout idioms only; controls inside rows keep their own native keyboard behaviour.' }],
		tokens: [
			{ token: '--tt-card', usedFor: 'Card and section backgrounds', preview: 'color' },
			{ token: '--tt-border', usedFor: 'Card borders (the strong line)', preview: 'color' },
			{ token: '--tt-border-light', usedFor: 'Hairline row separators', preview: 'color' },
			{ token: '--tt-radius-lg', usedFor: 'Card corner radius', preview: 'radius' },
			{ token: '--tt-shadow-card', usedFor: 'CARD_STYLES elevation (dialect-aware)', preview: 'shadow' },
			{ token: '--tt-ink', usedFor: 'Row labels and values', preview: 'color' },
			{ token: '--tt-text', usedFor: 'Section descriptions', preview: 'color' },
			{ token: '--tt-muted', usedFor: 'Eyebrows, hints, readout labels', preview: 'color' },
			{ token: '--tt-font-mono', usedFor: 'Eyebrows + readout labels', preview: 'font' },
			{ token: '--tt-positive', usedFor: 'Readout dot — healthy', preview: 'color' },
			{ token: '--tt-warning', usedFor: 'Readout dot — in progress', preview: 'color' },
			{ token: '--tt-danger', usedFor: 'Readout dot — failing', preview: 'color' },
			{ token: '--tt-rainbow-anim', usedFor: 'RainbowButton gradient motion (none when motion is off)' }
		],
		adoption: [
			'Done — CARD_STYLES unified the raised card across Schemas, Search, status sections, and admin panels; BlockInsertMenu and other floating surfaces reuse it as their base.',
			'Done — SettingsSection/SettingRow extracted as the shared /settings building blocks, mirroring the settingRow idiom UserSettingsModal established.',
			'Done — the readout table ships as StatusRow in statusSections.tsx (the /status page IS its section list, one source of truth with the site doc).',
			'Ongoing — UserSettingsModal still carries its own local settingRow copy and some blackAlpha hairlines; converging it onto SettingRow + --tt-border-light is a touch-it-fix-it migration.'
		]
	},
	{
		slug: 'modals-and-popovers',
		title: 'Modals & popovers',
		status: 'Adopted',
		summary:
			'The floating-surface stack: one exported z-index ladder (useDrawer.tsx) gives every layer its rung — 9999 nav, 10000 drawer, 10120 hovered drawer, 10220 popups, 10230 trigger, 10240/10250 modal overlay + modal — with editor windows layering AROUND the drawer in bands and DevKit above all. Popovers are CARD_STYLES cards at md radius wearing --tt-shadow-popover; desktop modals are 560px --tt-shadow-panel cards over a 0.4-alpha scrim; and below the mobile breakpoint both collapse into bottom sheets — flush edges, top-only --tt-radius-xl corners, grab handle, safe-area padding.',
		notes:
			'The ladder lives as exported constants in components/Nav/Drawer/useDrawer.tsx (lines ~7–25) — import them, never hardcode a z-index. UserSettingsModal is the canonical modal: desktop centre card / mobile 88dvh slide-up sheet, two-frame mount for the open transition, Escape + overlay close, body scroll lock. PreviewModal (ThingsDialogs.tsx) is the canonical Chakra-Modal variant and carries the trust rule: ownership decides whether a previewed component renders interactive or inert, checked INSIDE the modal so no caller can forget it. BlockInsertMenu is the popover→bottom-sheet shape-shifter (anchored popover ≥640px, Squarespace-style sheet below).',
		anatomy: [
			'Z ladder — 9900+ editor windows below the drawer · 9999 fixed nav · 10000 DRAWER_Z · 10040+ editor windows above (their default) · 10120 DRAWER_HOVER_Z (drawer takes the front while hovered, hands it back) · 10190 drag ghosts · 10220 DRAWER_POPUP_Z · 10230 DRAWER_TRIGGER_Z · 10240 DRAWER_MODAL_OVERLAY_Z · 10250 DRAWER_MODAL_Z · 99999+ DevKit.',
			'Popover surface — CARD_STYLES base stepped to --tt-radius-md, elevated by --tt-shadow-popover; rows hover --tt-surface-alt; sections split by --tt-border-light; mono uppercase section headers. ThingContextMenu, the footer environment menu, and BlockInsertMenu all wear it.',
			'Anchoring — fixed-position, measured from the trigger’s rect, clamped to the viewport with an 8px gutter; flips upward when space below runs out (BlockInsertMenu: openUp when spaceBelow < 260 and above beats below; maxHeight clamps 180–380 and content scrolls).',
			'Desktop modal — rgba(0,0,0,0.4) overlay at the overlay rung, the card centred above it: 560px, maxWidth 100%, maxHeight 86vh with inner scroll, --tt-radius-lg, --tt-shadow-panel; scale 0.96→1 + fade on a two-frame visible flip.',
			'Mobile sheet — position fixed, left/right/bottom 0, height 88vh (88dvh where supported) or maxHeight min(70vh, 520px) for the insert sheet; borderTopRadius --tt-radius-xl only; 44×5px --tt-border grab pill; paddingBottom adds var(--thingtime-safe-area-bottom); translateY(100%)→0 slide.',
			'Dismissal — Escape and scrim/outside-click everywhere; the modal locks body scroll while open and restores the previous overflow on close.',
			'Chakra-Modal variant — ThingsDialogs spreads a local modalCard const (card bg, --tt-border, --tt-radius-lg) onto ModalContent so even library modals speak the token language.'
		],
		stories: modalsAndPopoversStories,
		propTables: [
			{
				title: 'Z-ladder constants',
				source: 'remix/app/components/Nav/Drawer/useDrawer.tsx (lines 7–25)',
				rows: [
					{ name: 'DRAWER_Z', type: 'number', defaultValue: '10000', description: 'The drawer panel. The fixed nav sits just under it at 9999 (literal in Nav).' },
					{ name: 'DRAWER_HOVER_Z', type: 'number', defaultValue: '10120', description: 'The drawer while the pointer is over it — outranks the 10040+ editor-window band, then hands the front back.' },
					{ name: 'DRAWER_POPUP_Z', type: 'number', defaultValue: '10220', description: 'Dropdowns and popups. BlockInsertMenu uses it directly (scrim at −1).' },
					{ name: 'DRAWER_TRIGGER_Z', type: 'number', defaultValue: '10230', description: 'The drawer trigger button — reachable even over popups.' },
					{ name: 'DRAWER_MODAL_OVERLAY_Z', type: 'number', defaultValue: '10240', description: 'The modal scrim.' },
					{ name: 'DRAWER_MODAL_Z', type: 'number', defaultValue: '10250', description: 'The modal card/sheet itself — top of app chrome; only DevKit (99999+) goes higher.' }
				]
			},
			{
				title: '<UserSettingsModal/> (canonical modal)',
				source: 'remix/app/components/Nav/Drawer/UserSettingsModal.tsx',
				rows: [
					{ name: '(open state)', type: 'AccountModalContext', description: 'No props — accountModalOpen/setAccountModalOpen come from useDrawer(). Deliberately ephemeral React state, never persisted to thingtime/localforage (no restore flash, no tree serialise on toggle).' },
					{ name: 'isMobile branch', type: 'useIsMobileViewport()', description: 'Below 48em (Chakra md) the centre card becomes the full-width 88dvh slide-up sheet.' },
					{ name: 'visible', type: 'two-frame state', description: 'Mounts hidden, flips visible on the next animation frame so opacity/scale/translate transitions actually run.' },
					{ name: 'dismissal', type: 'effects', description: 'window keydown Escape closes; overlay click closes; body overflow locked to hidden while open and restored after.' },
					{ name: 'content rows', type: 'settingRow(label, control, hint?)', description: 'The same SettingRow geometry as /settings — account, drawer prefs, theming — so modal and page read as one surface.' }
				]
			},
			{
				title: '<PreviewModal/> (canonical Chakra-Modal)',
				source: 'remix/app/components/Things/ThingsDialogs.tsx (line ~531)',
				rows: [
					{ name: 'thing', type: 'ThingsThing | null', description: 'Open while non-null (deep-linkable as /things?preview=<id>); posts open their own permalink page instead.' },
					{ name: 'onClose', type: '() => void', description: 'Chakra Modal dismissal — Escape, overlay, close button.' },
					{ name: 'onAction', type: "(thing, 'rename' | 'move' | 'share' | 'delete') => void", description: 'Footer actions hand off to the surrounding page’s dialogs.' },
					{ name: 'untrusted (internal)', type: 'boolean', description: 'Ownership IS the trust boundary: a component authored by someone else renders INERT (context.untrusted), checked inside the modal so no future caller can forget it.' },
					{ name: 'modalCard', type: 'const (Chakra props)', description: 'card bg + --tt-border + --tt-radius-lg spread onto ModalContent — the token skin for library modals.' }
				]
			},
			{
				title: '<BlockInsertMenu/> (popover ⇄ bottom sheet)',
				source: 'remix/app/components/Builder/BlockInsertMenu.tsx',
				rows: [
					{ name: 'anchor', type: 'HTMLElement', description: 'The insert zone clicked — the popover positions from its rect, clamped to the viewport, flipping up when space below < 260px.' },
					{ name: 'existingIds', type: 'Set<string>', description: 'Tree ids so picked blocks mint unique ids.' },
					{ name: 'onPick', type: '({ block, component? }) => void', description: 'Hands back a ready block AND the resolved component thing so the canvas renders instantly, no refetch.' },
					{ name: 'onClose', type: '() => void', description: 'Escape, outside mousedown, or scrim tap (sheet mode).' },
					{ name: 'sheet (internal)', type: 'window.innerWidth < 640', description: 'The mode switch: anchored popover on desktop, flush bottom sheet on small screens — bigger tap targets (13px pills, 10px padding), no input autofocus so the keyboard doesn’t bury the sheet.' }
				]
			}
		],
		guidelines: {
			intro:
				'One ladder, three presentations. Every floating surface imports its rung from useDrawer.tsx and wears the tokened elevation for its weight — shadow-popover for anchored transients, shadow-panel for blocking modals. Desktop anchors to the trigger; small screens get the same content as a bottom sheet with real tap targets. The invariant behind the numbers: everything transient or blocking sits above the editor-window bands and the hovered drawer, or frames would cover open menus.',
			dos: [
				'Import the z constants (DRAWER_POPUP_Z, DRAWER_MODAL_Z, …) — a hardcoded z-index is a stacking bug waiting for the next band.',
				'Build popovers as CARD_STYLES cards at --tt-radius-md with --tt-shadow-popover; keep --tt-shadow-panel for true modals.',
				'Clamp anchored surfaces to the viewport (8px gutters), flip upward when space runs out, and scroll content inside a maxHeight.',
				'Give every surface all three exits: Escape, scrim/outside click, and a visible close affordance.',
				'Collapse to a bottom sheet on small screens: flush edges, top-only xl radius, grab handle, safe-area paddingBottom, upsized tap targets.',
				'Keep modal open-state in ephemeral React state (context), not in persisted thingtime settings — modals must never restore themselves open.',
				'Mount hidden and flip a visible flag next frame so the open transition animates (scale/fade desktop, translateY sheet).'
			],
			donts: [
				'Don’t invent a z-index between the rungs — if a new layer genuinely needs one, it gets added to the ladder comment and exported like the rest.',
				'Don’t autofocus inputs inside a mobile sheet — the keyboard eats the sheet; focus on desktop popovers only.',
				'Don’t let a popover grow past the viewport or reposition itself while open — measure once, clamp, scroll inside.',
				'Don’t skip the body scroll lock on blocking modals, and don’t forget to restore the previous overflow value.',
				'Don’t render previewed/foreign interactive content trusted — PreviewModal’s ownership check is the pattern: decide trust inside the surface, not at call sites.',
				'Don’t reach for a raw Chakra Modal without the modalCard token skin — library chrome must still speak --tt-*.'
			]
		},
		accessibility: [
			'Escape closes every floating surface (UserSettingsModal and BlockInsertMenu listen on window; Chakra modals handle it natively) — keyboard users always have the exit.',
			'Blocking modals lock body scroll so focus and reading order stay inside the surface; Chakra-based modals add focus trapping and focus return for free.',
			'Scrim dismissal is a pointer convenience, never the only exit — a visible ✕ (aria-label "Close settings") pairs with it.',
			'The bottom-sheet grab handle is decorative; dismissal works via scrim tap and Escape, so the drag gesture is never required.',
			'Sheet paddingBottom includes var(--thingtime-safe-area-bottom), keeping the last controls above the iOS home indicator.',
			'The mobile keyboard is treated as an overlay hazard: sheets skip autofocus so assistive and touch users see the surface before an input claims it.',
			'Popover rows are real buttons with hover AND focus styles from Chakra defaults; hit areas on the sheet upsize to comfortable touch targets.'
		],
		keyboard: [
			{ keys: 'Esc', action: 'Close the open popover / sheet / modal' },
			{ keys: 'Tab', action: 'Move through the surface’s controls (Chakra modals trap and return focus)' },
			{ keys: 'Enter / Space', action: 'Activate the focused row or control (native button semantics)' }
		],
		tokens: [
			{ token: '--tt-card', usedFor: 'Popover, modal, and sheet surfaces', preview: 'color' },
			{ token: '--tt-border', usedFor: 'Surface borders + the sheet grab handle', preview: 'color' },
			{ token: '--tt-border-light', usedFor: 'Section dividers inside popovers', preview: 'color' },
			{ token: '--tt-surface-alt', usedFor: 'Row hover inside floating surfaces', preview: 'color' },
			{ token: '--tt-radius-md', usedFor: 'Popover corner radius', preview: 'radius' },
			{ token: '--tt-radius-lg', usedFor: 'Modal corner radius', preview: 'radius' },
			{ token: '--tt-radius-xl', usedFor: 'Bottom-sheet top corners', preview: 'radius' },
			{ token: '--tt-shadow-popover', usedFor: 'Anchored transient surfaces (menus, dropdowns, insert menu)', preview: 'shadow' },
			{ token: '--tt-shadow-panel', usedFor: 'Blocking modal elevation', preview: 'shadow' },
			{ token: '--tt-ink', usedFor: 'Surface titles and row labels', preview: 'color' },
			{ token: '--tt-muted', usedFor: 'Section headers, hints', preview: 'color' },
			{ token: '--tt-font-mono', usedFor: 'Section headers + control chips', preview: 'font' },
			{ token: '--thingtime-safe-area-bottom', usedFor: 'Sheet bottom padding above the iOS home indicator' }
		],
		adoption: [
			'Done — the ladder is exported from useDrawer.tsx and consumed by NavDrawer, DrawerTrigger, UserSettingsModal, BlockInsertMenu, and the editor-window layer system (EditorSplit bands layer around it).',
			'Done — UserSettingsModal ships both presentations (desktop card / mobile 88dvh sheet) with the two-frame open transition, Escape, scrim, and body scroll lock.',
			'Done — PreviewModal carries the ownership trust rule inside the surface; ThingsDialogs’ modalCard skins every Chakra modal in the family.',
			'Done — BlockInsertMenu shape-shifts popover ⇄ bottom sheet at 640px with sheet-grade tap targets and no mobile autofocus.',
			'Ongoing — a few older floating surfaces still carry literal z-indexes; they migrate onto the exported rungs as they are touched.'
		]
	},
	{
		slug: 'toasts',
		title: 'Toasts (Lopu)',
		status: 'Adopted',
		summary:
			'THE notification surface: every user-facing notification is a message from Lopu, the Thingtime AI 🦄 — a clean --tt-card note inside a 2px animated RAINBOW border, popping up bottom-left by default (Settings → Appearance → "Lopu messages" moves it to any of Chakra’s six corners). useLopu() returns a one-shot toast function ({ title, description, status, duration, link }); useLopuStream() pops instantly and types an AI musing in live from an NDJSON stream. House rule: never raw Chakra useToast, never alert() — one voice, one surface, one place users learn to look.',
		notes:
			'Live everywhere a surface talks to the user: login/logout and account switching, settings saves, share links, upload results, migration runs, error paths. Under the hood it IS Chakra’s toast manager (user-chosen position, custom render), which supplies stacking, timers, and dismissal — the house rule bans the raw look, not the plumbing. Placement is a preference at thingtime.settings.lopu.position (useLopuPosition, namespace lopu, cross-tab) mirrored into the synchronous tt-lopu-position cache that lopuToastPlacement() reads at fire time, so none of the ~86 callers subscribe to settings state. Every one-shot payload passes normalizeLopuMessage() (lopuMessage.ts) so a toast can never render as a bare status glyph; useDismissLopu() lets privacy-sensitive screens close every Lopu surface on unmount or account switch.',
		anatomy: [
			'Frame — a p="2px" wrapper painted with the RAINBOW gradient (the “unicorn vomit border”), radius --tt-radius-xl, elevation --tt-shadow-toast; 360px wide, maxWidth calc(100vw − 24px).',
			'Card — --tt-card inner at calc(--tt-radius-xl − 2px), px 4 / py 3; everything inside is quiet so the border does the branding.',
			'Header — 🦄, the gradient-clipped 800-weight "Lopu" wordmark, the mono 10px uppercase THINGTIME AI eyebrow, then a 20px faint ✕ that warms to ink on hover.',
			'Title — sm/600 --tt-ink, prefixed by the status emoji: ✨ success, 🌧️ error, nothing for info. Colour never changes with tone.',
			'Description — xs --tt-muted, pre-wrap, scrolling inside maxH min(55vh, 460px) for long payloads; optional link renders underlined below.',
			'Countdown ring — a 14px rainbow SVG ring bottom-right draining over the toast’s remaining lifetime via stroke-dashoffset (r=5, circumference 31.42) — a gentle "time left to read" cue.',
			'Placement — bottom-left by default; the Settings dropdown picks any Chakra corner (top-left / top centre / top right / bottom-left / bottom centre / bottom right). Centre positions get a full-viewport flex container so the card centres by flow (immune to ancestor transforms); corners shrink to the card and lean on Chakra’s safe-area-inset list edge; the top row adds translateY(70px) to clear the fixed nav without breaking Chakra’s tight stacking. pointerEvents none so the container eats no clicks; --toast-z-index 10260 keeps every note above the drawer, its popups, and modals.',
			'Streaming variant — pops as italic "Lopu is thinking…" with duration null, types deltas into the title with a blinking ▍ caret, credits the source (via Claude 🤖 / via ChatGPT 🤖 / from Lopu’s little book 📖), then starts a 16s read-timer from stream END; closing mid-stream aborts the fetch.'
		],
		stories: toastsStories,
		propTables: [
			{
				title: 'useLopu() → lopu(args)',
				source: 'remix/app/components/Lopu/useLopu.tsx',
				rows: [
					{ name: 'title', type: 'string', description: 'The headline. Optional — normalizeLopuMessage() supplies a friendly default when both title and description are empty.' },
					{ name: 'description', type: 'string', description: 'Supporting detail (xs, muted, pre-wrap, scrolls past min(55vh, 460px)). Errors should say what to do next.' },
					{ name: 'status', type: "'success' | 'error' | 'info'", description: 'Sets the title’s emoji prefix (✨ / 🌧️ / none) and the empty-payload fallback copy — never the colours.' },
					{ name: 'duration', type: 'number', defaultValue: '13000', description: 'Visible lifetime in ms; the countdown ring drains over exactly this window.' },
					{ name: 'link', type: '{ label, href }', description: 'Optional underlined link under the description (share URLs, release pages).' },
					{ name: 'announceDescription', type: 'boolean', defaultValue: 'true', description: 'The card is role="status" by default; false demotes it to a labelled, focusable region with aria-live off — for long payloads that shouldn’t be read out in full.' },
					{ name: 'descriptionLabel', type: 'string', description: 'aria-label for the demoted description region (defaults to "Additional Thingtime message detail").' },
					{ name: '(returns)', type: 'ToastId', description: 'Chakra’s toast id — usable with the underlying manager if a caller needs to update/close programmatically.' }
				]
			},
			{
				title: 'useLopuStream() → stream(url)',
				source: 'remix/app/components/Lopu/useLopu.tsx',
				rows: [
					{ name: 'url', type: 'string', description: 'An NDJSON endpoint (the live caller is /api/v1/lopu/musing): {type:"meta", source} then {type:"delta", text} events.' },
					{ name: '(loading)', type: 'behaviour', description: 'Pops instantly with "Lopu is thinking…" at duration null — the toast stays while the stream runs.' },
					{ name: '(deltas)', type: 'behaviour', description: 'Each delta re-renders the title with the accumulated text and a blinking caret; the source label sits in the description.' },
					{ name: '(finish)', type: 'behaviour', description: 'The 16s read-timer and countdown start when the stream ENDS, so the finished musing gets its full reading window.' },
					{ name: '(close/error)', type: 'behaviour', description: 'Closing aborts the fetch (AbortError leaves it closed); failures show "Lopu is daydreaming… try again 🔮" as an error toast.' }
				]
			},
			{
				title: 'Helpers',
				source: 'remix/app/components/Lopu/lopuMessage.ts · useLopu.tsx',
				rows: [
					{ name: 'normalizeLopuMessage({ title, description, status })', type: 'helper', description: 'Trims non-string/empty values and guarantees copy: empty error → "Something went wrong. Please try again.", empty success → "Done ✨", nothing → "Here when you need me 🦄". Runtime callers are not always type-safe; this is the guard.' },
					{ name: 'useDismissLopu()', type: '() => void', description: 'Closes every open Lopu surface — for privacy-sensitive screens on unmount or when the authenticated account changes.' }
				]
			}
		],
		guidelines: {
			intro:
				'One voice for everything the app says. Notifications are messages from Lopu — friendly, specific, and finished with the occasional ✨ — never system dialogs. The house rule is absolute: user-facing feedback goes through useLopu()/useLopuStream(), not raw Chakra useToast and not alert(); the rainbow border is the signature, so nothing else in the app wears an animated gradient frame.',
			dos: [
				'Import useLopu() for every user-facing result — success, failure, and the “that worked, here’s what changed” moments (e.g. "Logged out — switched to @nf ✨").',
				'Write titles as outcomes ("Menu order reset ✨", "Could not load URL") and put the what-to-do-next in the description.',
				'Match duration to weight: quick confirmations 5–6s, errors with reading 7–8s, payloads with paths/links 9s+, default 13s.',
				'Let normalizeLopuMessage() catch degenerate payloads — passing only a status is legal and yields friendly copy.',
				'Use link for share URLs and release pages instead of pasting URLs into the description.',
				'Use useDismissLopu() on privacy-sensitive screens so stale toasts can’t outlive the screen or the signed-in account.',
				'Set announceDescription: false for long diagnostic payloads so screen readers announce the title without the wall of text.'
			],
			donts: [
				'Don’t call Chakra useToast directly or alert()/confirm() for feedback — one banned pattern, zero exceptions (the house rule exists so users learn a single surface).',
				'Don’t stack a toast per item in a loop — one summary toast ("3 things moved 📁") beats three cards.',
				'Don’t use toasts for blocking decisions — confirmation belongs in a modal (DeleteConfirmDialog), a toast is fire-and-forget.',
				'Don’t colour toasts by tone — status is the emoji prefix and fallback copy, and the card stays --tt-card in every mood.',
				'Don’t fire toasts on mount or route load — a toast answers something the user just did (this catalog’s stories are static for exactly that reason).',
				'Don’t re-implement the card — the rainbow frame is Lopu’s signature; other surfaces borrowing it dilute the one place users look for messages.'
			]
		},
		accessibility: [
			'The card is role="status" (polite live region) — announced without stealing focus; with announceDescription: false the title alone carries role="status" and the description becomes a labelled, tabbable region with aria-live off.',
			'The close control is a real button with aria-label "Close"; the countdown ring and status emoji are aria-hidden decoration — timing and tone are also in the words.',
			'Dismissal is never required: toasts expire on their own, and everything a toast reports remains true on the page behind it.',
			'The description scrolls (maxH min(55vh, 460px)) rather than truncating, so long diagnostics stay reachable; overflowWrap anywhere keeps paths and URLs from bursting the card.',
			'Status pairs emoji + wording, never colour alone; title text stays --tt-ink on --tt-card at AA in every tone.',
			'The streaming caret and blinking ellipsis ride the shared tt-blink keyframes; the rainbow border animation follows the theme motion switch like every gradient.'
		],
		keyboard: [
			{ keys: 'Tab', action: 'Reach the toast’s close button (and the description region when announceDescription is false)' },
			{ keys: 'Enter / Space', action: 'Activate the focused close button or link' }
		],
		tokens: [
			{ token: '--tt-card', usedFor: 'The message card inside the rainbow frame', preview: 'color' },
			{ token: '--tt-radius-xl', usedFor: 'Frame radius (inner card at calc(−2px))', preview: 'radius' },
			{ token: '--tt-shadow-toast', usedFor: 'Toast elevation (dialect-aware)', preview: 'shadow' },
			{ token: '--tt-gradient-rainbow', usedFor: 'The 2px border frame + the Lopu wordmark (via RAINBOW)', preview: 'color' },
			{ token: '--tt-ink', usedFor: 'Titles + close-button hover', preview: 'color' },
			{ token: '--tt-muted', usedFor: 'Descriptions + the THINGTIME AI eyebrow', preview: 'color' },
			{ token: '--tt-faint', usedFor: 'Close button + streaming caret', preview: 'color' },
			{ token: '--tt-surface-alt', usedFor: 'Close-button hover wash', preview: 'color' },
			{ token: '--tt-font-mono', usedFor: 'The THINGTIME AI eyebrow', preview: 'font' }
		],
		adoption: [
			'Done — useLopu() is the app-wide notification path: auth flows, settings, sharing, uploads, migrations, desktop-app updates all speak through it, and PR review holds the no-raw-useToast line.',
			'Done — normalizeLopuMessage() guards every one-shot payload (with tests in lopuMessage.test.ts); degenerate runtime payloads render friendly copy instead of bare glyphs.',
			'Done — useLopuStream() powers the Lopu musings toast off /api/v1/lopu/musing with abort-on-close and the read-timer-from-stream-end rule.',
			'Done — useDismissLopu() ships for privacy-sensitive surfaces (close-all on unmount/account switch).',
			'Next — programmatic update/close of a fired toast currently drops to the returned Chakra id; a typed wrapper lands if callers start needing it widely.'
		]
	}
];
