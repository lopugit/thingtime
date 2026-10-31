import type { DesignSystemEntry } from '../entries';
import { buttonsStories } from './ButtonsStories';
import { chipsAndBadgesStories } from './ChipsAndBadgesStories';
import { inputsAndFormsStories } from './InputsAndFormsStories';

// Core controls group — the everyday interactive vocabulary: buttons,
// form fields, and the chip/badge status language. Every claim below is
// grounded in the shipped source files named in the prop tables.

export const coreControlsEntries: DesignSystemEntry[] = [
	{
		slug: 'buttons',
		title: 'Buttons',
		status: 'Adopted',
		summary:
			'The themed Chakra Button and its four voices: the ttInk solid default (ink fill, card-coloured label, sm size — configured once in the provider so <Button> with no props IS the house button), the accent conversion CTA (--tt-accent fill from the ThingsPage Log in recipe), the animated RainbowButton commit CTA from settings, and the quiet outline/ghost tiers. Loading rides Chakra isLoading scoped by the busyId pattern.',
		notes:
			'Live everywhere product chrome renders a button: the provider defaults come from Providers/Chakra/Components/Button.tsx + the ttInk palette in Providers/Chakra/colors.tsx, so every plain <Button> in settings, tests, admin, vercel, and the thing editors speaks the same voice. RainbowButton ships on /settings (Save), TokenMinter (Mint), and PasskeysManager; the accent CTA on logged-out walls like /things. Marketing surfaces use BrutalButton instead — see that entry.',
		anatomy: [
			'Default chassis — Chakra Button with provider defaultProps: colorScheme ttInk, size sm, variant solid. ttInk maps 500 → var(--tt-ink) (rest fill) and 600 → var(--tt-text) (hover fill), so the button re-themes with the token ramp.',
			'Label colour — the theme’s solid variant sets color: var(--tt-card, #ffffff), NOT white: in dark themes --tt-ink is near-white, and the card token keeps the label legible where a hardcoded white would vanish.',
			'Accent CTA — background var(--tt-accent), color var(--tt-accent-contrast), _hover opacity 0.9, over the normal chassis. The conversion voice: log in / sign up / primary destination CTAs (ThingsPage logged-out state).',
			'Rainbow CTA — RainbowButton: the RAINBOW gradient as fill (backgroundSize calc(100px + 200%)), animated via var(--tt-rainbow-anim), heading font at 600, radius --tt-radius-md, white label. The “commit” button of settings surfaces.',
			'Quiet tiers — variant outline for bordered secondary actions (Run Auth, Preview, Open 🎨), variant ghost for tertiary/dismiss (Clear selected, Cancel). Sizes xs/sm cover almost all product chrome.',
			'Tinted signal buttons — positive-soft or danger-tint fill with the matching signal token as label (TierManager POSITIVE_BUTTON_STYLES / DANGER_BUTTON_STYLES), hover darkening the tint one step.',
			'Loading — isLoading swaps the label for a spinner without a width jump; the busyId pattern (one busy string compared per action id) keeps exactly the clicked button spinning while siblings disable.',
			'Link duality — navigating buttons render as={RouterLink} or as="a" (ThingsPage CTA, vercel Preview) so middle-click, copy-link, and new-tab semantics survive the button styling.'
		],
		stories: buttonsStories,
		propTables: [
			{
				title: 'ChakraButton theme (the provider defaults)',
				source: 'remix/app/Providers/Chakra/Components/Button.tsx · remix/app/Providers/Chakra/colors.tsx',
				rows: [
					{
						name: 'defaultProps.colorScheme',
						type: 'string',
						defaultValue: "'ttInk'",
						description: 'Every button resolves fills through the ttInk palette: 500 = var(--tt-ink, #16161a) at rest, 600 = var(--tt-text, #5a5a66) on hover — the v1 product-UI solid-ink mockup, runtime-themed.'
					},
					{
						name: 'defaultProps.size',
						type: 'string',
						defaultValue: "'sm'",
						description: 'The house size. Use xs for dense rows (settings row actions, list controls); md only for standalone CTAs.'
					},
					{
						name: 'defaultProps.variant',
						type: 'string',
						defaultValue: "'solid'",
						description: 'Solid ink is the default voice; outline and ghost are the opt-in quiet tiers.'
					},
					{
						name: 'variants.solid.color',
						type: 'string',
						defaultValue: "'var(--tt-card, #ffffff)'",
						description: 'Chakra’s solid variant hardcodes white text; the theme overrides it to the card token because dark themes make --tt-ink near-white — labels must ride the ramp, not a literal.'
					}
				]
			},
			{
				title: '<RainbowButton/>',
				source: 'remix/app/components/Settings/SettingsSection.tsx',
				rows: [
					{
						name: '…props',
						type: 'ButtonProps',
						description: 'A plain Chakra Button underneath — isLoading, isDisabled, size, onClick all pass through (SettingsPage adds minHeight="44px" for the tap target).'
					},
					{
						name: 'background',
						type: 'preset',
						defaultValue: 'RAINBOW (from ~/theme/rainbow)',
						description: 'The blue-first looping gradient with backgroundSize calc(100px + 200%), animated by var(--tt-rainbow-anim, moving-rainbow 5s linear infinite) — stops with the theme motion switch.'
					},
					{
						name: 'typography',
						type: 'preset',
						defaultValue: 'fontFamily heading · fontWeight 600 · color white',
						description: 'Heading type on the gradient; hover is opacity 0.9; radius is var(--tt-radius-md, 12px).'
					}
				]
			},
			{
				title: 'Accent CTA recipe',
				source: 'remix/app/components/Things/ThingsPage.tsx (logged-out Log in CTA)',
				rows: [
					{
						name: 'background',
						type: 'string',
						defaultValue: "'var(--tt-accent, hotpink)'",
						description: 'The accent token IS the CTA colour — themes swap it and every conversion button follows.'
					},
					{
						name: 'color',
						type: 'string',
						defaultValue: "'var(--tt-accent-contrast, #ffffff)'",
						description: 'The tuned on-accent text token — never assume white.'
					},
					{
						name: '_hover',
						type: 'object',
						defaultValue: '{ opacity: 0.9 }',
						description: 'Opacity hover, not a second colour: the accent stays a single token.'
					},
					{
						name: 'as',
						type: 'RouterLink | "a"',
						description: 'The ThingsPage CTA navigates (to="/login"), so it renders as a router link for real link semantics.'
					}
				]
			},
			{
				title: 'Tinted signal buttons',
				source: 'remix/app/components/Admin/TierManager.tsx (POSITIVE_BUTTON_STYLES / DANGER_BUTTON_STYLES)',
				rows: [
					{
						name: 'positive',
						type: 'style const',
						description: 'bg var(--tt-positive-soft) · color var(--tt-positive) · hover/active darken the tint (rgba 0.22 / 0.3). Approve, activate, enable.'
					},
					{
						name: 'danger',
						type: 'style const',
						description: 'bg rgba(214, 69, 90, 0.12) · color var(--tt-danger) · hover/active rgba 0.18 / 0.24. Destructive actions; always positioned last, after an escape hatch.'
					}
				]
			}
		],
		guidelines: {
			intro:
				'One chassis, four voices, and the theme owns the defaults. A plain <Button> is already correct — the provider gives it the ink solid voice — so button code should mostly be children plus a handler. Escalate deliberately: outline/ghost to step down, accent or rainbow to step up, and never more than one stepped-up CTA per surface. Product chrome only: marketing CTAs are BrutalButton’s job.',
			dos: [
				'Reach for a bare <Button> first — the ttInk sm solid default is the house button; add props only to change voice or size.',
				'Use the accent CTA recipe (accent bg, accent-contrast text, opacity hover) for conversion moments: log in, sign up, the one action a logged-out wall exists for.',
				'Use RainbowButton for the committing action of a settings-style surface (Save, Mint, Add a passkey) — and import it from ~/components/Settings/SettingsSection rather than rebuilding the gradient.',
				'Step down with variant="outline" for secondary actions and variant="ghost" for tertiary/dismiss, keeping one visual anchor per row.',
				'Wire async actions with isLoading plus a busyId string compared per action id, so only the clicked button spins and its siblings disable.',
				'Render navigating buttons as={RouterLink} / as="a" — link semantics (middle-click, copy link) survive the styling.',
				'Style destructive buttons with the danger-tint recipe (tint fill + --tt-danger text), positioned last with a quiet escape hatch beside them.'
			],
			donts: [
				'Don’t hardcode white button text — the theme already pairs solid ink with var(--tt-card); a literal white breaks dark themes.',
				'Don’t use Chakra palette colorSchemes (blue, red, green) on product buttons — fills come from ttInk or the token recipes; colorScheme="red" confirms are legacy to migrate.',
				'Don’t stack two stepped-up CTAs (accent, rainbow) in one view — primary means singular.',
				'Don’t animate a gradient button outside var(--tt-rainbow-anim) — the theme motion switch must be able to stop it.',
				'Don’t ship BrutalButton inside product chrome — the hard marketing chassis has its own entry and its own territory.',
				'Don’t fake loading by swapping children — isLoading preserves width and disables the button correctly.'
			]
		},
		accessibility: [
			'Every voice renders a native <button> (or <a> when navigating) — focus order, Enter/Space activation, and disabled semantics come from the platform.',
			'The global theme strips default focus rings (button:focus boxShadow none in theme.tsx) — bespoke button-like controls must supply their own focus-visible voice; the CIControlDashboard idiom is outline 2px solid var(--tt-accent) with outlineOffset -2px.',
			'isLoading renders Chakra’s spinner and disables interaction — paired with busyId, sibling actions disable too, so double-submits are structurally prevented.',
			'Accent labels ride --tt-accent-contrast, a token tuned against the accent fill, rather than assumed white.',
			'Danger buttons pair colour with wording and position (last in the row) — colour is never the only signal.',
			'Emoji in labels (Log in 🗝️, Mint token 🪙) are garnish after the words; the text alone carries the action.'
		],
		keyboard: [
			{ keys: 'Tab', action: 'Focus the button in native order' },
			{ keys: 'Enter / Space', action: 'Activate (Enter follows link-form buttons like any link)' }
		],
		tokens: [
			{ token: '--tt-ink', usedFor: 'Default solid fill (ttInk 500)', preview: 'color' },
			{ token: '--tt-text', usedFor: 'Default solid hover fill (ttInk 600)', preview: 'color' },
			{ token: '--tt-card', usedFor: 'Label text on solid ink', preview: 'color' },
			{ token: '--tt-accent', usedFor: 'Accent CTA fill', preview: 'color' },
			{ token: '--tt-accent-contrast', usedFor: 'Label text on accent', preview: 'color' },
			{ token: '--tt-positive-soft', usedFor: 'Positive tinted-button fill', preview: 'color' },
			{ token: '--tt-positive', usedFor: 'Positive tinted-button label', preview: 'color' },
			{ token: '--tt-danger', usedFor: 'Danger tinted-button label', preview: 'color' },
			{ token: '--tt-gradient-rainbow', usedFor: 'RainbowButton fill (via RAINBOW)', preview: 'color' },
			{ token: '--tt-rainbow-anim', usedFor: 'RainbowButton gradient motion (none when motion is off)' },
			{ token: '--tt-radius-md', usedFor: 'RainbowButton corner radius', preview: 'radius' },
			{ token: '--tt-font-heading', usedFor: 'RainbowButton label type', preview: 'font' }
		],
		adoption: [
			'Done — the provider defaults (ttInk / sm / solid + card-coloured label) ship app-wide; a bare <Button> is the house button everywhere.',
			'Done — RainbowButton is the commit CTA on /settings, TokenMinter, and PasskeysManager; the accent recipe carries logged-out conversion walls (/things).',
			'Done — quiet tiers in production: outline/ghost across /tests, /vercel, and settings rows; tinted signal buttons across the admin tier manager.',
			'Ongoing — legacy colorScheme="red" confirms (e.g. PasskeysManager delete) migrate to the danger-tint recipe as they are touched.',
			'Next — extract the accent CTA and tinted recipes into shared exports once a third surface needs them; today they are three-prop recipes copied per call site.'
		]
	},
	{
		slug: 'inputs-and-forms',
		title: 'Inputs & forms',
		status: 'Adopted',
		summary:
			'The form vocabulary: Chakra Input/Select/Textarea/Switch/NumberInput re-voiced by the provider theme — every default focus ring is stripped, Select goes borderless for inline value editing, NumberInput is unstyled and replaced by the house number editor, and a checked Switch paints its track var(--tt-rainbow-3). Form surfaces re-dress fields with the tokened recipe: 1px --tt-border, radius --tt-radius-sm, card fill, accent focus.',
		notes:
			'Two field dialects share the primitives. Inline editing (the Thingtime tree) wants invisible chrome: borderless Select, unstyled NumberInput, no focus ring — the value IS the interface. Form surfaces (admin, /tests, the builder drawer, /settings) want visible chrome and re-add it with the tokened recipe plus mono uppercase micro-labels. The theme overrides live in Providers/Chakra/theme.tsx; the recipe recurs in TierManager INPUT_STYLES, BuilderDrawer inputStyles, and the /tests filter bar.',
		anatomy: [
			'Focus strip — theme.tsx styles.global zeroes boxShadow and borderColor on input/textarea/select/button focus: Chakra’s blue ring never renders. Each surface answers with its own focus voice instead.',
			'Tokened field recipe — 1px solid var(--tt-border), borderRadius var(--tt-radius-sm, 9px), background var(--tt-card), plus a focus voice: focusBorderColor var(--tt-accent) (TierManager) or border --tt-faint with a 3px --tt-accent-tint halo (number editor).',
			'Micro-label — mono 10–11px, 600, tracked 0.12em, uppercase, --tt-muted, sitting 4px above the field (tests.tsx filter bar); SettingRow instead puts a sm ink label + xs muted hint beside the control.',
			'Select, two dialects — the theme strips Select to a borderless inline picker (focusBorderColor transparent, no border, padding-inline-end 24px, 14px chevron) for in-place value editing; form selects re-add the tokened recipe border.',
			'Switch — track rides grays.medium (the --tt-faint alias) and flips to var(--tt-rainbow-3, #58ca70) when checked; the theme renders the wrapper as="div" so it nests safely inside label-bearing rows.',
			'NumberInput — Chakra variant unstyled with borderless steppers; the real editor is NumberValueInput (Thingtime.tsx): content-width input (ch-sized), − / + step buttons, a local draft so partial input (“-”, “1.”) never fights the committed value, arrow-key stepping.',
			'Textarea — form textareas take the tokened recipe; code/payload textareas switch to mono type on the --tt-surface-alt wash with whiteSpace pre and horizontal scroll (tests.tsx payload editor).',
			'Row layout — SettingRow: label + hint on the left (minWidth 0), control pushed right with marginLeft auto, inside a SettingsSection card with its mono eyebrow.'
		],
		stories: inputsAndFormsStories,
		propTables: [
			{
				title: 'Provider overrides',
				source: 'remix/app/Providers/Chakra/theme.tsx',
				rows: [
					{
						name: 'styles.global (focus strip)',
						type: 'global CSS',
						description: 'input/textarea/select/button/div/a/span :focus get boxShadow: none and borderColor: transparent (!important) — the app-wide removal of Chakra’s focus ring. Surfaces must bring their own focus voice.'
					},
					{
						name: 'Switch.baseStyle.track',
						type: 'style',
						description: 'background grays.medium (→ var(--tt-faint)); _checked background var(--tt-rainbow-3, #58ca70) — the green rainbow stop is the ON colour in every theme.'
					},
					{
						name: 'Switch.defaultProps.as',
						type: 'string',
						defaultValue: "'div'",
						description: 'Renders the wrapper as a div so a Switch can sit inside rows/labels without nested-label DOM issues.'
					},
					{
						name: 'Select.defaultProps',
						type: 'props',
						description: 'focusBorderColor transparent, border none, paddingInlineStart 0, paddingInlineEnd 24px, 14px chevron — the borderless inline value picker of the thing editor. Form selects re-add the tokened border per-instance.'
					},
					{
						name: 'NumberInput.defaultProps.variant',
						type: 'string',
						defaultValue: "'unstyled'",
						description: 'Kills the heavy bordered Chakra number field; NumberInputField inherits fontSize and fills its row; steppers are borderless in grays.medium.'
					},
					{
						name: 'fonts',
						type: 'theme map',
						description: 'Chakra font keys resolve through the token roles: heading/body/mono → var(--tt-font-heading/body/mono) — fontFamily="mono" on any field is already themed.'
					}
				]
			},
			{
				title: 'The tokened field recipe',
				source: 'remix/app/components/Admin/TierManager.tsx (INPUT_STYLES) · remix/app/components/Builder/BuilderDrawer.tsx (inputStyles) · remix/app/routes/tests.tsx',
				rows: [
					{ name: 'border', type: 'string', defaultValue: "'1px solid'", description: 'Visible chrome for form dialects — the same hairline weight as cards.' },
					{ name: 'borderColor', type: 'string', defaultValue: "'var(--tt-border, #ececef)'", description: 'The standard control border token.' },
					{ name: 'borderRadius', type: 'string', defaultValue: "'var(--tt-radius-sm, 9px)'", description: 'Inputs sit on the sm radius step — one below buttons/cards (md).' },
					{ name: 'bg', type: 'string', defaultValue: "'var(--tt-card, #ffffff)'", description: 'Fields are raised card surfaces; payload/code textareas swap to --tt-surface-alt to read as inset machine text.' },
					{ name: 'focusBorderColor', type: 'string', defaultValue: "'var(--tt-accent, hotpink)'", description: 'The focus voice replacing the stripped ring (TierManager). The number editor uses the second voice: border --tt-faint + 0 0 0 3px var(--tt-accent-tint) halo.' }
				]
			},
			{
				title: '<SettingsSection/> + <SettingRow/>',
				source: 'remix/app/components/Settings/SettingsSection.tsx',
				rows: [
					{ name: 'SettingsSection.eyebrow', type: 'string', description: 'Mono 10px uppercase tracked section label on the card (card bg, 1px --tt-border, radius-lg).' },
					{ name: 'SettingsSection.description', type: 'string', description: 'Optional xs --tt-text paragraph under the eyebrow.' },
					{ name: 'SettingRow.label / hint', type: 'ReactNode / string', description: 'sm ink label with an optional xs muted hint underneath — the left column of the row.' },
					{ name: 'SettingRow.children', type: 'ReactNode', description: 'The control, pushed right (marginLeft auto, flexShrink 0): Switch, Select, xs Button, stepper cluster.' }
				]
			},
			{
				title: '<NumberValueInput/> (the house number editor)',
				source: 'remix/app/components/Thingtime/Thingtime.tsx',
				rows: [
					{ name: 'value', type: 'number', description: 'The committed value. A focused field keeps its local draft; the committed value only rewrites the draft when the field is not focused.' },
					{ name: 'onValueChange', type: '(value: number) => void', description: 'Fired on every valid parse — typing, stepping, and blur-commit all funnel through one commit path.' },
					{ name: 'draft behaviour', type: 'internal', description: 'Partial input (“-”, “1.”, empty) stays in the draft without committing NaN; an emptied field steps from the committed value, not from Number("") === 0.' },
					{ name: 'steppers', type: 'internal', description: '30px − / + buttons (1px --tt-border, radius-sm, card bg, surface-hover hover, scale 0.94 active) — the design-mockup replacement for Chakra’s stacked steppers.' },
					{ name: 'width', type: 'internal', description: 'Content-sized: max(draft length, 1) + 3ch, min 5ch — the field grows with the number instead of reserving a column.' }
				]
			}
		],
		guidelines: {
			intro:
				'Two dialects, one set of primitives. Inline editing strips chrome so a value reads as content until touched — that is what the provider overrides buy globally. Form surfaces put chrome back on with one recipe (border token, sm radius, card fill, accent focus) and one micro-label, so every admin panel, test bench, and builder drawer form looks like the same hand built it. Because the theme deleted the default focus ring, a focus voice is not optional: every field must visibly answer focus.',
			dos: [
				'Dress form fields with the tokened recipe — 1px --tt-border, radius-sm, card bg — and give them a focus voice (focusBorderColor accent, or the faint-border + accent-tint halo).',
				'Label form fields with the mono uppercase micro-label above, or use SettingRow’s label + hint when the control sits in a settings card.',
				'Use the borderless Select as-is for inline value editing; re-add the recipe border whenever the select is part of a visible form.',
				'Use NumberValueInput (or its recipe) for numbers — draft state, ch-sized width, − / + steppers, arrow stepping — never the raw bordered Chakra NumberInput.',
				'Put code and payload text in mono textareas on --tt-surface-alt with whiteSpace pre — inset wash means machine text.',
				'Keep Switch for instant-apply booleans (settings toggles); its rainbow-3 checked track is the system-wide ON signal.',
				'Compose settings forms from SettingsSection + SettingRow so label/hint/control geometry stays uniform.'
			],
			donts: [
				'Don’t rely on Chakra’s default focus ring — the global theme deleted it; an undressed field silently loses visible focus.',
				'Don’t hand a focus voice to one field and not its neighbours — the recipe applies per-surface, not per-favourite-field.',
				'Don’t use Chakra grey borders (gray.200) or palette focus colours on fields — border and focus are token reads.',
				'Don’t use the raw Chakra NumberInput chrome — the theme unstyled it on purpose; the house editor owns numbers.',
				'Don’t wire a Switch to a deferred submit — a switch flips state now; use a checkbox + save button when commitment is deferred (tests.tsx “Include mutating tests”).',
				'Don’t invent new label typography — the micro-label (mono, 10–11px, tracked, uppercase, muted) is the one form-label voice.'
			]
		},
		accessibility: [
			'The stripped focus ring is a deliberate trade: every field MUST re-supply visible focus (accent border or accent-tint halo). A tokened field without a focus voice is an accessibility bug, not a style choice.',
			'Micro-labels are visual; wire them to controls with htmlFor/id or aria-label — the number editor sets aria-label="Number value" because its visible label is the thing path, not a <label>.',
			'Switch renders Chakra’s internal checkbox input, so Space toggling and aria-checked come from the platform even with the as="div" wrapper.',
			'The number editor accepts keyboard-only operation: type to draft, Enter to commit and blur, ArrowUp/ArrowDown to step (Shift ×10) — the − / + buttons are pointer sugar, not the only path.',
			'inputMode="decimal" on the number editor raises the numeric keyboard on touch devices without the spinner UI of type="number".',
			'Disabled states pair the control’s disabled affordance with an explanatory hint in the row (“Verify your email first”) — never a mystery-disabled field.'
		],
		keyboard: [
			{ keys: 'Tab / Shift+Tab', action: 'Move between fields in DOM order' },
			{ keys: 'Space', action: 'Toggle a focused Switch / checkbox' },
			{ keys: 'Enter', action: 'Number editor: commit the draft and blur' },
			{ keys: '↑ / ↓', action: 'Number editor: step ±1 (Shift steps ±10)' },
			{ keys: '↑ / ↓ / Enter', action: 'Native select option navigation (platform behaviour)' }
		],
		tokens: [
			{ token: '--tt-border', usedFor: 'Field borders (form dialect)', preview: 'color' },
			{ token: '--tt-radius-sm', usedFor: 'Field corner radius', preview: 'radius' },
			{ token: '--tt-card', usedFor: 'Field fill', preview: 'color' },
			{ token: '--tt-surface-alt', usedFor: 'Code/payload textarea wash', preview: 'color' },
			{ token: '--tt-surface-hover', usedFor: 'Stepper hover fill', preview: 'color' },
			{ token: '--tt-accent', usedFor: 'Focus border voice', preview: 'color' },
			{ token: '--tt-accent-tint', usedFor: 'Focus halo voice (0 0 0 3px)', preview: 'color' },
			{ token: '--tt-faint', usedFor: 'Focused number-editor border; resting Switch track', preview: 'color' },
			{ token: '--tt-rainbow-3', usedFor: 'Checked Switch track', preview: 'color' },
			{ token: '--tt-muted', usedFor: 'Micro-labels, hints, stepper glyphs', preview: 'color' },
			{ token: '--tt-ink', usedFor: 'Row labels, field text', preview: 'color' },
			{ token: '--tt-font-mono', usedFor: 'Micro-labels, code textareas', preview: 'font' }
		],
		adoption: [
			'Done — the provider overrides (focus strip, borderless Select, unstyled NumberInput, rainbow-3 Switch) ship app-wide from Providers/Chakra/theme.tsx.',
			'Done — the tokened recipe is live in the admin tier manager (INPUT_STYLES with accent focus), the builder drawer (inputStyles), and the /tests filter bar; the settings idiom (SettingsSection/SettingRow) carries /settings.',
			'Done — NumberValueInput is the number editor of the Thingtime tree and its concept viewers.',
			'Ongoing — recipe call sites predate a shared export: TierManager, BuilderDrawer, and tests.tsx each declare the same object; extract to one module when next touched.',
			'Next — a first-class focus-voice helper (accent border vs accent-tint halo) so new fields cannot forget that the default ring is gone.'
		]
	},
	{
		slug: 'chips-and-badges',
		title: 'Chips & badges',
		status: 'Adopted',
		summary:
			'The house status language: a mono-uppercase pill chip filled with a token tint and coloured with the matching signal token (six tones: neutral, positive, danger, accent, link/info, warning), plus the status dot — square 7px in admin, round 10px on status/vercel rows, dot-in-pill for deployment states — always locked to a mono uppercase label. Chakra colorScheme badges are banned from product chrome.',
		notes:
			'Live on /tests (run summary chips, pass/fail per row), the admin dashboard and tier manager (tone chips, StatusDot), /vercel (statusDot map, the dot-in-pill state badge), and the status page sections. The AdminDashboard source states the rule: “House chip: a tokened tint + mono uppercase label, replacing the Chakra colorScheme badges so every status color rides the --tt-* palette.” The chip components are module-local recipes today — same chassis in each file.',
		anatomy: [
			'Chip chassis — inline-flex pill: borderRadius var(--tt-radius-pill), px 2 / py 2px (or lineHeight 18px), mono 10–11px, 600, uppercase, tracked 0.04–0.06em, whiteSpace nowrap.',
			'Tone = tint + signal — the fill is the tone’s soft tint, the text its full signal token: neutral (surface-alt + muted), positive (positive-soft + positive), danger (rgba(214,69,90,.12) + danger), accent (accent-tint + accent), link/info (rgba(47,143,214,.12) + link), warning (rgba(255,188,72,.2) + ink).',
			'Dot chip — a neutral chip carrying a 6px square dot (radius 2px) in the signal colour, for states that warrant a marker but not a full tint (tests.tsx warning tone).',
			'Square dot lockup — AdminDashboard StatusDot: 7px box, 2px radius, signal fill, 6px gap to a mono 10px uppercase --tt-muted label.',
			'Round dot lockup — status page + /vercel rows: 10px circle (borderRadius full) beside a mono xs uppercase label; a 7px circle inside the vercel state pill.',
			'Dot-in-pill — /vercel deployment state: a --tt-surface-alt pill (px 2.5 / py 1) wrapping the 7px round dot and the state text tracked at 0.12em.',
			'State → token map — one mapping drives every dot: ready/pass → --tt-positive, building → --tt-warning, queued/initializing → --tt-border, error/blocked → --tt-danger, canceled → --tt-muted, unknown → --tt-faint (statusDot() in routes/vercel.tsx).'
		],
		stories: chipsAndBadgesStories,
		propTables: [
			{
				title: 'Chip tone maps',
				source: 'remix/app/routes/tests.tsx (CHIP_TONES) · remix/app/components/Admin/AdminDashboard.tsx (CHIP_TONE_STYLES)',
				rows: [
					{ name: 'neutral', type: 'tone', description: 'bg var(--tt-surface-alt) · color var(--tt-muted). Counts, meta, default state (“3 visible”).' },
					{ name: 'positive', type: 'tone', description: 'bg var(--tt-positive-soft) · color var(--tt-positive). Passed, ready, configured.' },
					{ name: 'danger', type: 'tone', description: 'bg rgba(214, 69, 90, 0.12) · color var(--tt-danger). Failed, error, blocked. The tint is a literal — no --tt-danger-soft token exists yet.' },
					{ name: 'accent', type: 'tone', description: 'bg var(--tt-accent-tint) · color var(--tt-accent). Selection, ownership, featured.' },
					{ name: 'link / info', type: 'tone', description: 'bg rgba(47, 143, 214, 0.12) · color var(--tt-link). Informational badges, external references.' },
					{ name: 'warning', type: 'tone', description: 'Two shipped forms: AdminDashboard fills rgba(255, 188, 72, 0.2) with --tt-ink text; tests.tsx keeps a neutral chip and adds a square --tt-warning dot.' },
					{ name: 'chassis', type: 'style', description: 'inline-flex · radius-pill · px 2 / py 2px · mono 10px 600 uppercase tracked · nowrap (TierManager CHIP_STYLES variant: 11px, lineHeight 18px).' }
				]
			},
			{
				title: 'StatusDot + statusDot()',
				source: 'remix/app/components/Admin/AdminDashboard.tsx · remix/app/routes/vercel.tsx · remix/app/components/Status/statusSections.tsx',
				rows: [
					{ name: 'StatusDot.color', type: 'string', description: 'The signal token for the state — passed straight in as a var() string; the dot is bg only, 7px box, borderRadius 2px.' },
					{ name: 'StatusDot.label', type: 'string', description: 'Mono 10px 600 uppercase --tt-muted text — the label carries the meaning, the dot echoes it.' },
					{ name: 'statusDot(state)', type: '(state) => string', description: 'The one state → token map: ready → positive, building → warning, queued/initializing → border, error/blocked → danger, canceled → muted, else faint.' },
					{ name: 'round variant', type: 'recipe', description: '10px borderRadius="full" dot beside a mono xs uppercase label (status page StatusStateSection, vercel deployment rows); 7px inside the state pill.' },
					{ name: 'dot-in-pill', type: 'recipe', description: '--tt-surface-alt pill (radius-pill, px 2.5, py 1) wrapping the 7px dot + state text tracked 0.12em — the vercel deployment state badge.' }
				]
			}
		],
		guidelines: {
			intro:
				'Status is a language, not a decoration: one chassis (the mono uppercase pill), one tone table (tint fill + signal text), one dot map (state → token). Because every colour is a token read, the whole status vocabulary re-themes together — which is exactly why Chakra colorScheme badges are banned: a green.100/green.800 badge is invisible to the theme system and drifts the moment a custom theme lands.',
			dos: [
				'Build every status badge from the chip chassis: pill radius, mono 10–11px 600 uppercase, tint fill + matching signal text.',
				'Pick tones by meaning, not colour taste: positive = succeeded/ready, danger = failed/blocked, warning = degraded/caution, accent = selected/owned, link = informational, neutral = counts and meta.',
				'Use the dot lockup when a state annotates a row rather than badging it — square 7px in dense admin tables, round 10px on status rows — always with the mono uppercase label.',
				'Drive dot colours through the statusDot() state → token map (or a copy of it) so the same state is the same colour on every surface.',
				'Keep chip text short and machine-flavoured: counts, states, identifiers — “12 passed”, “ready”, “ses sandbox”.',
				'Use the dot-in-pill form when a state badge needs to sit among buttons and links (the vercel deployment row).'
			],
			donts: [
				'Don’t use Chakra <Badge colorScheme=…> in product chrome — the house rule exists verbatim in the AdminDashboard source; every status colour rides the --tt-* palette.',
				'Don’t let colour carry the state alone — the mono uppercase label is part of the lockup; a bare dot is not a status.',
				'Don’t invent new tones or tint strengths — six tones cover the vocabulary; a seventh is a design-system conversation.',
				'Don’t put actions inside chips — chips are readouts; interactive filters and toggles are buttons or segmented controls.',
				'Don’t mix the square and round dots on one surface — square is the admin dialect, round the status/vercel dialect; pick the surface’s dialect and stay in it.',
				'Don’t hardcode signal hexes — danger/link/warning tints are the ONLY sanctioned literals (their *-soft tokens don’t exist yet), and they wrap the default hexes the tokens fall back to.'
			]
		},
		accessibility: [
			'Chips are real text at 10–11px 600 — small but bold, mono, and uppercase; they annotate rather than replace body copy, and the row they decorate carries the full-size information.',
			'Every dot pairs with a text label in the lockup — state is never colour-only, so the pattern survives greyscale and colour-blindness.',
			'Tint + signal pairs keep the label at full signal strength on a soft wash — contrast stays close to the plain-text baseline of each token.',
			'Chips and dots are inert (no handlers, no focus) — they add no keyboard surface and no tab stops to scan past.',
			'whiteSpace nowrap keeps chip labels from wrapping into cryptic fragments; long values belong in the row, not the chip.'
		],
		keyboard: [{ keys: '—', action: 'Chips and dots are inert readouts; they add no keyboard surface of their own.' }],
		tokens: [
			{ token: '--tt-surface-alt', usedFor: 'Neutral chip fill, dot-in-pill fill', preview: 'color' },
			{ token: '--tt-muted', usedFor: 'Neutral chip text, dot lockup labels, canceled state', preview: 'color' },
			{ token: '--tt-positive-soft', usedFor: 'Positive chip fill', preview: 'color' },
			{ token: '--tt-positive', usedFor: 'Positive text, ready/pass dots', preview: 'color' },
			{ token: '--tt-danger', usedFor: 'Danger text, error/blocked dots (tint = rgba literal)', preview: 'color' },
			{ token: '--tt-accent-tint', usedFor: 'Accent chip fill', preview: 'color' },
			{ token: '--tt-accent', usedFor: 'Accent chip text', preview: 'color' },
			{ token: '--tt-link', usedFor: 'Link/info chip text (tint = rgba literal)', preview: 'color' },
			{ token: '--tt-warning', usedFor: 'Warning dots + tint base, building state', preview: 'color' },
			{ token: '--tt-border', usedFor: 'Queued/initializing dots', preview: 'color' },
			{ token: '--tt-faint', usedFor: 'Unknown-state dots', preview: 'color' },
			{ token: '--tt-ink', usedFor: 'Warning chip text (admin form)', preview: 'color' },
			{ token: '--tt-radius-pill', usedFor: 'Chip + pill radius', preview: 'radius' },
			{ token: '--tt-font-mono', usedFor: 'All chip and lockup text', preview: 'font' }
		],
		adoption: [
			'Done — /tests, the admin dashboard, the tier manager, /vercel, and the status sections all speak the chip + dot language; Chakra colorScheme badges are out of product chrome.',
			'Done — the state → token map (statusDot) is the single colour authority for deployment/status dots on /vercel and the status page.',
			'Ongoing — the chassis is a module-local recipe in each file (tests CHIP_TONES, AdminDashboard CHIP_TONE_STYLES, TierManager CHIP_STYLES); extract one shared Chip when next touched.',
			'Next — mint --tt-danger-soft / --tt-link-soft / --tt-warning-soft tokens so the last three rgba literals become theme-controlled like --tt-positive-soft already is.'
		]
	}
];
