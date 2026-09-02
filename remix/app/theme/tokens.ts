/**
 * Thingtime design tokens — the single source of truth for the 2026 design
 * refactor (see docs/design/DESIGN_LANGUAGE.md).
 *
 * A TtTheme is a plain-JSON document. The ThemeHost turns it into `--tt-*`
 * CSS custom properties on <html>, so every surface (Chakra tokens, landing
 * page, app chrome) re-themes at runtime without rebuilding the Chakra theme.
 *
 * Themes are shareable: the same document shape is what the /api/v1/themes
 * endpoints store and serve.
 */

export interface TtThemeColors {
  ink: string
  text: string
  muted: string
  faint: string
  border: string
  borderLight: string
  surface: string
  surfaceAlt: string
  surfaceHover: string
  card: string
  pageBg: string
  accent: string
  accentTint: string
  accentContrast: string
  link: string
  positive: string
  positiveSoft: string
  danger: string
  warning: string
  rainbow: [string, string, string, string, string]
  darkBg: string
  darkChrome: string
  darkBorder: string
  darkText: string
  darkMuted: string
  darkAccent: string
}

export interface TtThemeFonts {
  /** Headings + UI chrome (v1 mockup: Space Grotesk) */
  heading: string
  /** Body copy (v1 mockup: Hanken Grotesk) */
  body: string
  /** Code, keys, labels (v1 mockup: JetBrains Mono) */
  mono: string
  /**
   * Landing-page display font. Empty string = system stack
   * (the v2-fable mockup uses the system stack at 800/900 weights).
   */
  display: string
}

export type TtThingsBadgePadding = 'small' | 'medium' | 'large' | 'custom'

/**
 * Padding presets for the View / Show / Arrange / Kind pills on /things.
 * Values are full CSS padding shorthands so the Custom option can use the
 * exact same token without a second styling path.
 */
export const THINGS_BADGE_PADDING_PRESETS: Readonly<Record<Exclude<TtThingsBadgePadding, 'custom'>, string>> = {
  small: '3px 8px',
  medium: '5px 12px',
  large: '7px 16px',
}

export interface TtThemeGeneral {
  /** Multiplies the radius scale. 0 = square (Fable), 1 = Prism. */
  radiusScale: number
  /** Hairline border width in px for app chrome (Prism 1, Fable 2). */
  borderWidth: number
  /** Shadow language: soft (Prism) or hard offset (Fable). */
  shadow: 'soft' | 'hard'
  /** Master switch for decorative motion (rainbow panning, bobbing). */
  motion: boolean
  /**
   * Whether the app-wide decorative pet (components/Pets) is mounted at all.
   * Separate from `motion`: motion off keeps the pet, just still; pet off
   * removes it entirely. Defaults on, so an older stored theme that predates
   * this key keeps today's behaviour.
   */
  pet: boolean
  /** Base UI transition speed in ms (tt.Button already reads a speed). */
  animSpeed: number
  /** UI icon language: playful emoji or coloured Lucide line icons. */
  iconStyle: 'emoji' | 'lucide'
  /** Preset or custom padding for the /things browse-control pills. */
  thingsBadgePadding: TtThingsBadgePadding
  /** CSS padding shorthand used when thingsBadgePadding is custom. */
  thingsBadgeCustomPadding: string
}

export interface TtThemeWindows {
  /** Traffic-light colours; '' = follow the matching rainbow stop (1/2/3). */
  closeColor: string
  minimiseColor: string
  maximiseColor: string
  /** Per-button border radius in px (the buttons are 12px squares). */
  closeRadius: number
  minimiseRadius: number
  maximiseRadius: number
}

export interface TtTheme {
  name: string
  colors: TtThemeColors
  fonts: TtThemeFonts
  general: TtThemeGeneral
  /** Editor window chrome (close / minimise / expand traffic lights). */
  windows: TtThemeWindows
}

/** Deep-partial of TtTheme — the shape of user overrides + API payloads. */
export type TtThemePatch = {
  name?: string
  colors?: Partial<TtThemeColors> & { rainbow?: string[] }
  fonts?: Partial<TtThemeFonts>
  general?: Partial<TtThemeGeneral>
  windows?: Partial<TtThemeWindows>
}

export const FONT_STACKS = {
  system:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  sans: 'system-ui, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}

/**
 * Curated Google-font choices offered by the theming settings UI.
 * `css` is the family name used in font-family; empty css = system stack.
 */
export const CURATED_FONTS: {
  label: string
  css: string
  kind: 'heading' | 'body' | 'mono' | 'any'
}[] = [
  { label: 'System', css: '', kind: 'any' },
  { label: 'Space Grotesk', css: 'Space Grotesk', kind: 'heading' },
  { label: 'Hanken Grotesk', css: 'Hanken Grotesk', kind: 'body' },
  { label: 'JetBrains Mono', css: 'JetBrains Mono', kind: 'mono' },
  { label: 'Inter', css: 'Inter', kind: 'any' },
  { label: 'Sora', css: 'Sora', kind: 'heading' },
  { label: 'Fraunces', css: 'Fraunces', kind: 'heading' },
  { label: 'Instrument Serif', css: 'Instrument Serif', kind: 'heading' },
  { label: 'Nunito', css: 'Nunito', kind: 'body' },
  { label: 'Atkinson Hyperlegible', css: 'Atkinson Hyperlegible', kind: 'body' },
  { label: 'IBM Plex Mono', css: 'IBM Plex Mono', kind: 'mono' },
  { label: 'Fira Code', css: 'Fira Code', kind: 'mono' },
]

export const fontFamilyCss = (family: string, fallback = FONT_STACKS.sans) =>
  family && family.trim().length
    ? `'${family.replace(/['"]/g, '')}', ${fallback}`
    : fallback

/** The five-stop brand rainbow shared by both mockups. */
export const RAINBOW_PALETTE: [string, string, string, string, string] = [
  '#f34a4a',
  '#ffbc48',
  '#58ca70',
  '#47b5e6',
  '#a555e8',
]

/**
 * Default theme — "Thingtime": Prism (v1 product UI) app chrome with the
 * Fable hotpink accent so the landing page matches mockup-v2-fable exactly.
 */
export const THINGTIME_THEME: TtTheme = {
  name: 'Thingtime',
  colors: {
    ink: '#16161a',
    text: '#5a5a66',
    muted: '#9a9aa6',
    faint: '#b6b6c0',
    border: '#ececef',
    borderLight: '#f0f0f2',
    surface: '#fafafb',
    surfaceAlt: '#f5f5f7',
    surfaceHover: '#ececee',
    card: '#ffffff',
    pageBg: '#ffffff',
    accent: 'hotpink',
    accentTint: '#fff5fa',
    accentContrast: '#ffffff',
    link: '#2f8fd6',
    positive: '#2f8f4f',
    positiveSoft: 'rgba(88, 202, 112, 0.14)',
    danger: '#d6455a',
    warning: '#ffbc48',
    rainbow: [...RAINBOW_PALETTE] as TtThemeColors['rainbow'],
    darkBg: '#131318',
    darkChrome: '#1c1c22',
    darkBorder: '#2a2a33',
    darkText: '#e6e6ee',
    darkMuted: '#8a8a95',
    darkAccent: '#59ff9c',
  },
  fonts: {
    heading: 'Space Grotesk',
    body: 'Hanken Grotesk',
    mono: 'JetBrains Mono',
    display: '',
  },
  general: {
    radiusScale: 1,
    borderWidth: 1,
    shadow: 'soft',
    motion: true,
    pet: true,
    animSpeed: 200,
    iconStyle: 'emoji',
    thingsBadgePadding: 'small',
    thingsBadgeCustomPadding: THINGS_BADGE_PADDING_PRESETS.small,
  },
  windows: {
    closeColor: '',
    minimiseColor: '',
    maximiseColor: '',
    closeRadius: 3.5,
    minimiseRadius: 3.5,
    maximiseRadius: 3.5,
  },
}

/** Fable — the v2 neo-brutalist landing look, everywhere. */
export const FABLE_THEME: TtTheme = {
  ...THINGTIME_THEME,
  name: 'Fable',
  colors: {
    ...THINGTIME_THEME.colors,
    ink: '#1a1a1a',
    text: '#4b4b4b',
    muted: '#8a8a8a',
    faint: '#c9c9c9',
    border: '#ececec',
    borderLight: '#f2f2f2',
    surface: '#ffffff',
    surfaceAlt: '#fafafa',
    surfaceHover: '#f2f2f2',
  },
  fonts: { heading: '', body: '', mono: 'JetBrains Mono', display: '' },
  general: {
    radiusScale: 0,
    borderWidth: 2,
    shadow: 'hard',
    motion: true,
    pet: true,
    animSpeed: 120,
    iconStyle: 'emoji',
    thingsBadgePadding: 'small',
    thingsBadgeCustomPadding: THINGS_BADGE_PADDING_PRESETS.small,
  },
}

/** Prism — the pure v1 refined product look (purple accent). */
export const PRISM_THEME: TtTheme = {
  ...THINGTIME_THEME,
  name: 'Prism',
  colors: {
    ...THINGTIME_THEME.colors,
    accent: '#a555e8',
    accentTint: '#f6effc',
  },
}

/** Midnight — dark mode riff on Prism. */
export const MIDNIGHT_THEME: TtTheme = {
  ...THINGTIME_THEME,
  name: 'Midnight',
  colors: {
    ...THINGTIME_THEME.colors,
    ink: '#f2f2f7',
    text: '#b9b9c6',
    muted: '#8a8a95',
    faint: '#5a5a66',
    border: '#2a2a33',
    borderLight: '#23232b',
    surface: '#16161c',
    surfaceAlt: '#1c1c22',
    surfaceHover: '#23232b',
    card: '#131318',
    pageBg: '#0b0b0f',
    accentTint: '#2a1a26',
    link: '#59bdff',
    positiveSoft: 'rgba(88, 202, 112, 0.18)',
  },
}

export const BUILTIN_THEMES: TtTheme[] = [
  THINGTIME_THEME,
  FABLE_THEME,
  PRISM_THEME,
  MIDNIGHT_THEME,
]

export const getBuiltinTheme = (name?: string): TtTheme =>
  BUILTIN_THEMES.find(
    (t) => t.name.toLowerCase() === String(name || '').toLowerCase(),
  ) || THINGTIME_THEME

/* ------------------------------------------------------------------ */
/* Sanitising + resolving                                              */
/* ------------------------------------------------------------------ */

/**
 * Theme values end up inside CSS custom properties (and shared themes come
 * from other users via the API), so only allow benign CSS color/length-ish
 * strings — no url(), expressions, semicolons or braces.
 */
export const sanitizeCssValue = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const v = value.trim().slice(0, 120)
  if (!v) return null
  if (/[;{}<>\\]|url\s*\(|expression|@import|\/\*/i.test(v)) return null
  if (!/^[\w#(),.'\s%\-\/]+$/.test(v)) return null
  return v
}

/**
 * A deliberately narrow CSS padding parser for saved/shared themes. It accepts
 * the useful CSS shorthand form (one to four non-negative lengths) without
 * allowing declarations, functions, URLs, or selectors into the token.
 */
export const sanitizePaddingCssValue = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const v = value.trim().slice(0, 120)
  if (!v) return ''
  const parts = v.split(/\s+/)
  if (parts.length < 1 || parts.length > 4) return null
  const length = /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|ch|ex|vw|vh|vmin|vmax|pt))$/i
  return parts.every((part) => length.test(part)) ? parts.join(' ') : null
}

const clampNumber = (value: unknown, min: number, max: number, dflt: number) => {
  const n = typeof value === 'string' ? Number(value) : (value as number)
  if (typeof n !== 'number' || Number.isNaN(n)) return dflt
  return Math.min(max, Math.max(min, n))
}

/** Merge a patch over a base theme, sanitising every value. */
export const resolveTheme = (
  base: TtTheme,
  patch?: TtThemePatch | null,
): TtTheme => {
  const out: TtTheme = {
    name: base.name,
    colors: { ...base.colors, rainbow: [...base.colors.rainbow] as TtThemeColors['rainbow'] },
    fonts: { ...base.fonts },
    general: { ...base.general },
    // older stored themes predate the windows section — fill from defaults
    windows: { ...THINGTIME_THEME.windows, ...(base.windows || {}) },
  }
  if (!patch || typeof patch !== 'object') return out

  if (typeof patch.name === 'string' && patch.name.trim()) {
    out.name = patch.name.trim().slice(0, 60)
  }

  const colors = patch.colors
  if (colors && typeof colors === 'object') {
    for (const key of Object.keys(out.colors) as (keyof TtThemeColors)[]) {
      if (key === 'rainbow') continue
      const v = sanitizeCssValue((colors as Record<string, unknown>)[key])
      if (v) (out.colors as unknown as Record<string, string>)[key] = v
    }
    if (Array.isArray(colors.rainbow)) {
      colors.rainbow.slice(0, 5).forEach((c, i) => {
        const v = sanitizeCssValue(c)
        if (v) out.colors.rainbow[i] = v
      })
    }
  }

  const fonts = patch.fonts
  if (fonts && typeof fonts === 'object') {
    const curated = new Set(CURATED_FONTS.map((f) => f.css))
    for (const key of Object.keys(out.fonts) as (keyof TtThemeFonts)[]) {
      const raw = (fonts as Record<string, unknown>)[key]
      if (typeof raw !== 'string') continue
      const v = raw.trim().slice(0, 60).replace(/'/g, '')
      // Only curated families (or '' = system) — keeps stored/shared themes
      // from carrying arbitrary font-family strings.
      if (curated.has(v)) out.fonts[key] = v
    }
  }

  const general = patch.general
  if (general && typeof general === 'object') {
    out.general.radiusScale = clampNumber(general.radiusScale, 0, 2.5, out.general.radiusScale)
    out.general.borderWidth = clampNumber(general.borderWidth, 1, 4, out.general.borderWidth)
    if (general.shadow === 'soft' || general.shadow === 'hard') out.general.shadow = general.shadow
    if (typeof general.motion === 'boolean') out.general.motion = general.motion
    if (typeof general.pet === 'boolean') out.general.pet = general.pet
    out.general.animSpeed = clampNumber(general.animSpeed, 0, 2000, out.general.animSpeed)
    if (general.iconStyle === 'emoji' || general.iconStyle === 'lucide') out.general.iconStyle = general.iconStyle
    if (
      general.thingsBadgePadding === 'small' ||
      general.thingsBadgePadding === 'medium' ||
      general.thingsBadgePadding === 'large' ||
      general.thingsBadgePadding === 'custom'
    ) {
      out.general.thingsBadgePadding = general.thingsBadgePadding
    }
    const customBadgePadding = sanitizePaddingCssValue(general.thingsBadgeCustomPadding)
    if (customBadgePadding !== null) out.general.thingsBadgeCustomPadding = customBadgePadding
  }

  const windows = patch.windows
  if (windows && typeof windows === 'object') {
    for (const key of ['closeColor', 'minimiseColor', 'maximiseColor'] as const) {
      const raw = (windows as Record<string, unknown>)[key]
      // '' is meaningful — it means "follow the rainbow stop"
      if (raw === '') {
        out.windows[key] = ''
        continue
      }
      const v = sanitizeCssValue(raw)
      if (v) out.windows[key] = v
    }
    for (const key of ['closeRadius', 'minimiseRadius', 'maximiseRadius'] as const) {
      out.windows[key] = clampNumber(
        (windows as Record<string, unknown>)[key],
        0,
        24,
        out.windows[key],
      )
    }
  }

  return out
}

/* ------------------------------------------------------------------ */
/* Theme → CSS custom properties                                       */
/* ------------------------------------------------------------------ */

const px = (n: number) => `${Math.round(n * 100) / 100}px`

// 90deg so the tile wraps seamlessly under moving-rainbow background-position
// animation — diagonal angles phase-shift at the tile edge and show a join.
export const rainbowGradient = (rainbow: string[], angle = '90deg') =>
  `linear-gradient(${angle}, ${rainbow[3]}, ${rainbow[4]}, ${rainbow[0]}, ${rainbow[1]}, ${rainbow[2]}, ${rainbow[3]})`

export const rainbowTextGradient = (rainbow: string[]) =>
  `linear-gradient(90deg, ${rainbow[0]}, ${rainbow[1]}, ${rainbow[2]}, ${rainbow[3]}, ${rainbow[4]}, ${rainbow[0]})`

export const themeToCssVars = (theme: TtTheme): Record<string, string> => {
  const { colors: c, fonts: f, general: g } = theme
  const w = theme.windows || THINGTIME_THEME.windows
  const r = (n: number) => px(n * g.radiusScale)
  const hard = g.shadow === 'hard'
  const thingsBadgePadding =
    g.thingsBadgePadding === 'custom'
      ? sanitizePaddingCssValue(g.thingsBadgeCustomPadding) || THINGS_BADGE_PADDING_PRESETS.small
      : THINGS_BADGE_PADDING_PRESETS[g.thingsBadgePadding] || THINGS_BADGE_PADDING_PRESETS.small
  const vars: Record<string, string> = {
    '--tt-ink': c.ink,
    '--tt-text': c.text,
    '--tt-muted': c.muted,
    '--tt-faint': c.faint,
    '--tt-border': c.border,
    '--tt-border-light': c.borderLight,
    '--tt-surface': c.surface,
    '--tt-surface-alt': c.surfaceAlt,
    '--tt-surface-hover': c.surfaceHover,
    '--tt-card': c.card,
    '--tt-page-bg': c.pageBg,
    '--tt-accent': c.accent,
    '--tt-accent-tint': c.accentTint,
    '--tt-accent-contrast': c.accentContrast,
    '--tt-link': c.link,
    '--tt-positive': c.positive,
    '--tt-positive-soft': c.positiveSoft,
    '--tt-danger': c.danger,
    '--tt-warning': c.warning,
    '--tt-dark-bg': c.darkBg,
    '--tt-dark-chrome': c.darkChrome,
    '--tt-dark-border': c.darkBorder,
    '--tt-dark-text': c.darkText,
    '--tt-dark-muted': c.darkMuted,
    '--tt-dark-accent': c.darkAccent,
    '--tt-rainbow-1': c.rainbow[0],
    '--tt-rainbow-2': c.rainbow[1],
    '--tt-rainbow-3': c.rainbow[2],
    '--tt-rainbow-4': c.rainbow[3],
    '--tt-rainbow-5': c.rainbow[4],
    '--tt-gradient-rainbow': rainbowGradient(c.rainbow),
    '--tt-gradient-rainbow-x': rainbowTextGradient(c.rainbow),
    '--tt-font-heading': fontFamilyCss(f.heading, FONT_STACKS.system),
    '--tt-font-body': fontFamilyCss(f.body, FONT_STACKS.system),
    '--tt-font-mono': fontFamilyCss(f.mono, FONT_STACKS.mono),
    '--tt-font-display': fontFamilyCss(f.display, FONT_STACKS.system),
    '--tt-radius-xs': r(7),
    '--tt-radius-sm': r(9),
    '--tt-radius-md': r(12),
    '--tt-radius-lg': r(16),
    '--tt-radius-xl': r(20),
    '--tt-radius-2xl': r(26),
    '--tt-radius-pill': g.radiusScale === 0 ? '0px' : '999px',
    '--tt-border-w': px(g.borderWidth),
    '--tt-border-w-bold': px(Math.max(2, g.borderWidth)),
    '--tt-border-w-chunky': '3px',
    '--tt-things-badge-padding': thingsBadgePadding,
    '--tt-shadow-card': hard ? `3px 3px 0 ${c.ink}` : '0 1px 2px rgba(0, 0, 0, 0.05)',
    '--tt-shadow-panel': hard
      ? `8px 8px 0 ${c.ink}`
      : '0 24px 60px -28px rgba(20, 20, 40, 0.28)',
    '--tt-shadow-popover': hard
      ? `5px 5px 0 ${c.ink}`
      : '0 16px 40px -12px rgba(20, 20, 40, 0.3)',
    '--tt-shadow-toast': hard
      ? `6px 6px 0 ${c.ink}`
      : '0 14px 38px rgba(20, 20, 40, 0.18)',
    '--tt-shadow-hard-sm': `5px 5px 0 ${c.ink}`,
    '--tt-shadow-hard-lg': `8px 8px 0 ${c.ink}`,
    // editor window traffic lights — unset colours follow the rainbow stops
    '--tt-traffic-close': w.closeColor || c.rainbow[0],
    '--tt-traffic-minimise': w.minimiseColor || c.rainbow[1],
    '--tt-traffic-maximise': w.maximiseColor || c.rainbow[2],
    '--tt-traffic-close-radius': px(w.closeRadius),
    '--tt-traffic-minimise-radius': px(w.minimiseRadius),
    '--tt-traffic-maximise-radius': px(w.maximiseRadius),
    '--tt-anim-speed': `${Math.round(g.animSpeed)}ms`,
    '--tt-rainbow-anim': g.motion
      ? 'moving-rainbow 5s linear infinite'
      : 'none',
    '--tt-motion': g.motion ? '1' : '0',
    // The pet's visibility has to be a var, not a JS read: it decides what the
    // FIRST paint looks like, and the only tier fast enough for that is this
    // one (ThemeHost mirrors these vars to localStorage; tt-boot.js reapplies
    // them before React loads). A ready-to-use CSS value rather than a 1/0
    // flag, same idiom as --tt-rainbow-anim, so the pet just spends it on
    // `display` without a second token to interpret it.
    '--tt-pet-display': g.pet ? 'block' : 'none',
  }
  return vars
}

/** Snapshot key mirrored to localStorage for the pre-paint script. */
export const TT_THEME_SNAPSHOT_KEY = 'tt-theme-vars'
