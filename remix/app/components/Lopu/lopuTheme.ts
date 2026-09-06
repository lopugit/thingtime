// 🦄 Lopu's shared look. Every Lopu surface (page, floating window, mobile
// sheet, composer, voice mode, admin/settings rows) reads from this one
// palette so they feel like a single product. Values are the app's design
// tokens with the same light fallbacks the rest of the UI uses
// (`var(--tt-*, fallback)`), so the Theming provider's light/dark tokens
// flow through automatically — never hard-code a colour in a Lopu component.

export const LOPU_UI = {
	// surfaces
	card: 'var(--tt-card, #ffffff)',
	surface: 'var(--tt-surface, #fafafb)',
	surfaceAlt: 'var(--tt-surface-alt, #f4f4f5)',
	surfaceHover: 'var(--tt-surface-hover, #ededf0)',
	// lines + text
	borderColor: 'var(--tt-border, #e4e4e7)',
	border: '1px solid var(--tt-border, #e4e4e7)',
	ink: 'var(--tt-ink, #18181b)',
	muted: 'var(--tt-muted, #71717a)',
	faint: 'var(--tt-faint, #a1a1aa)',
	// radii (match --tt-radius-* used across the app)
	radiusXs: 'var(--tt-radius-xs, 7px)',
	radiusSm: 'var(--tt-radius-sm, 9px)',
	radiusMd: 'var(--tt-radius-md, 12px)',
	radiusLg: 'var(--tt-radius-lg, 16px)',
	radiusXl: 'var(--tt-radius-xl, 20px)',
	pill: '999px',
	// elevation
	shadowCard: '0 1px 2px rgba(24, 24, 27, 0.04), 0 8px 24px rgba(24, 24, 27, 0.06)',
	shadowFloating: '0 18px 60px rgba(24, 24, 27, 0.18), 0 2px 8px rgba(24, 24, 27, 0.08)',
	// Lopu's identity: one restrained rainbow, used for the avatar ring, the
	// streaming caret and the primary send action only. The theme's own brand
	// gradient (--tt-gradient-rainbow, re-themed live) with the same fallback
	// stops the rest of the app uses, so Lopu's ring matches the nav, the
	// launcher and the messenger disc in every theme.
	rainbow: 'var(--tt-gradient-rainbow, linear-gradient(90deg, #47b5e6, #a555e8, #f34a4a, #ffbc48, #58ca70, #47b5e6))',
	rainbowSoft: 'linear-gradient(135deg, rgba(255,122,122,0.16), rgba(255,204,77,0.16), rgba(106,211,140,0.16), rgba(77,150,255,0.16), rgba(176,107,255,0.16))',
	// type scale (restrained: Vercel-style neutral UI)
	fontBody: '14px',
	fontSmall: '12px',
	fontTiny: '11px',
	eyebrow: {
		fontFamily: 'mono',
		fontSize: '10px',
		fontWeight: 600,
		letterSpacing: '0.08em',
		textTransform: 'uppercase' as const,
		color: 'var(--tt-muted, #71717a)'
	},
	// message bubbles
	userBubble: {
		background: 'var(--tt-ink, #18181b)',
		color: 'var(--tt-card, #ffffff)',
		borderRadius: '18px 18px 4px 18px'
	},
	lopuBubble: {
		background: 'var(--tt-card, #ffffff)',
		border: '1px solid var(--tt-border, #e4e4e7)',
		borderRadius: '4px 18px 18px 18px'
	},
	// motion
	transitionFast: '120ms ease-out',
	transition: '200ms ease-out',
	// layout
	conversationMaxWidth: '760px',
	sidebarWidth: '272px',
	composerMaxWidth: '760px',
	// ——— conversation surface additions (W3) ———
	// semantic colours (never decorative): body text, links, success/failure
	text: 'var(--tt-text, #3f3f46)',
	link: 'var(--tt-link, #18181b)',
	positive: 'var(--tt-positive, #2f9e6b)',
	danger: 'var(--tt-danger, #d64545)',
	// the compact (floating window) body size
	fontCompact: '13px',
	fontMono: 'var(--tt-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
	shadowPopover: 'var(--tt-shadow-popover, 0 16px 40px -12px rgba(20, 20, 40, 0.3))',
	// motion: the theme's rainbow pan (already 'none' when motion is off)
	rainbowAnim: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)',
	// chrome clearances
	navClearance: 'calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))',
	safeAreaBottom: 'var(--thingtime-safe-area-bottom, env(safe-area-inset-bottom, 0px))',
	// touch / control sizes
	touchTarget: 44,
	control: 32,
	controlCompact: 28,
	// gutters
	gutter: 16,
	gutterWide: 24
} as const;

// Mono uppercase eyebrow (10px) — the app's label idiom, as an sx object.
export const lopuEyebrowSx = {
	fontFamily: LOPU_UI.fontMono,
	fontSize: '10px',
	fontWeight: 600,
	letterSpacing: '0.08em',
	textTransform: 'uppercase' as const,
	color: LOPU_UI.muted,
	whiteSpace: 'nowrap' as const
} as const;

// A visible keyboard focus ring drawn in ink (works on both themes).
export const lopuFocusRingSx = {
	_focusVisible: { outline: '2px solid var(--tt-ink, #18181b)', outlineOffset: '2px', boxShadow: 'none' }
} as const;

// Respect the viewer's reduced-motion preference wherever Lopu animates.
export const LOPU_REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';
export const lopuReducedMotionSx = { [LOPU_REDUCED_MOTION]: { animation: 'none' } } as const;

// Text drawn with the rainbow (the streaming caret, nothing else).
export const lopuRainbowTextSx = {
	background: LOPU_UI.rainbow,
	backgroundSize: 'calc(100px + 200%)',
	WebkitBackgroundClip: 'text',
	backgroundClip: 'text',
	WebkitTextFillColor: 'transparent',
	animation: LOPU_UI.rainbowAnim,
	...lopuReducedMotionSx
} as const;

// Hairline pill chip used for the composer's model / context chips and the
// empty-state suggestions.
export const lopuChipSx = {
	display: 'inline-flex',
	alignItems: 'center',
	gap: '6px',
	height: `${LOPU_UI.controlCompact}px`,
	paddingInline: '10px',
	borderRadius: LOPU_UI.pill,
	border: LOPU_UI.border,
	background: LOPU_UI.surfaceAlt,
	color: LOPU_UI.ink,
	fontSize: LOPU_UI.fontSmall,
	fontWeight: 600,
	lineHeight: 1,
	whiteSpace: 'nowrap' as const,
	cursor: 'pointer',
	WebkitTapHighlightColor: 'transparent',
	touchAction: 'manipulation',
	transition: `border-color ${LOPU_UI.transitionFast}, background ${LOPU_UI.transitionFast}, color ${LOPU_UI.transitionFast}`,
	_hover: { borderColor: LOPU_UI.faint, background: LOPU_UI.surfaceHover },
	_disabled: { opacity: 0.5, cursor: 'not-allowed' },
	...lopuFocusRingSx
} as const;

// Floating chrome (popovers, sheets) — the only place Lopu casts a shadow.
export const lopuPopoverSx = {
	background: LOPU_UI.card,
	border: LOPU_UI.border,
	borderRadius: LOPU_UI.radiusLg,
	boxShadow: LOPU_UI.shadowPopover,
	color: LOPU_UI.ink,
	overflow: 'hidden'
} as const;

// Rainbow ring wrapper style (2px gradient ring around a round avatar/button).
export const lopuRainbowRing = (size: number, ring = 2) => ({
	width: `${size}px`,
	height: `${size}px`,
	padding: `${ring}px`,
	borderRadius: '999px',
	background: LOPU_UI.rainbow,
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	flexShrink: 0
});

export const lopuIconButtonSx = {
	WebkitTapHighlightColor: 'transparent',
	touchAction: 'manipulation',
	borderRadius: LOPU_UI.radiusSm,
	color: LOPU_UI.muted,
	transition: `background ${LOPU_UI.transitionFast}, color ${LOPU_UI.transitionFast}`,
	_hover: { background: LOPU_UI.surfaceHover, color: LOPU_UI.ink }
} as const;
