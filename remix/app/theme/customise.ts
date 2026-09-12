/**
 * Per-option customisation — the escape hatch beside every theming control.
 *
 * Each theming option in the Theme Studio maps to a target here: a CSS
 * selector its custom CSS is scoped to (token options scope to :root so any
 * --tt-* variable can be overridden; element options scope to the element's
 * stable class) and, for element-backed options, custom classes that the
 * component attaches to the live element.
 *
 * Entries live at thingtime.settings.theme.custom.<key> and are deliberately
 * NOT part of saved/shared theme documents — shared themes stay plain token
 * data (see api/utils/themes), custom CSS stays personal.
 */

export type TtCustomEntry = {
  classes?: string
  css?: string
}

export type TtCustomMap = Record<string, TtCustomEntry>

export type TtCustomTarget = {
  /** Human label shown in the popover title. */
  label: string
  /** Selector the custom CSS declarations are scoped to. */
  selector: string
  /** The CSS custom property this option drives (shown as a hint). */
  varName?: string
  /** Element-backed options also accept custom classes on the element. */
  classable?: boolean
}

const root = (label: string, varName?: string): TtCustomTarget => ({
  label,
  selector: ':root',
  varName,
})

export const TT_CUSTOM_TARGETS: Record<string, TtCustomTarget> = {
  'color.accent': root('Accent', '--tt-accent'),
  'color.accentTint': root('Accent tint', '--tt-accent-tint'),
  'color.ink': root('Ink', '--tt-ink'),
  'color.text': root('Body text', '--tt-text'),
  'color.muted': root('Muted text', '--tt-muted'),
  'color.pageBg': root('Page background', '--tt-page-bg'),
  'color.card': root('Cards', '--tt-card'),
  'color.surface': root('Surface', '--tt-surface'),
  'color.surfaceAlt': root('Surface alt', '--tt-surface-alt'),
  'color.border': root('Borders', '--tt-border'),
  'color.link': root('Links', '--tt-link'),
  'color.rainbow': root('Rainbow', '--tt-rainbow-1…5'),
  'font.heading': root('Headings font', '--tt-font-heading'),
  'font.body': root('Body font', '--tt-font-body'),
  'font.mono': root('Code font', '--tt-font-mono'),
  'font.display': root('Landing display font', '--tt-font-display'),
  'general.radius': root('Corner radius', '--tt-radius-xs…2xl'),
  'general.borderWidth': root('Border weight', '--tt-border-w'),
  'general.icons': root('Icons'),
  'general.shadow': root('Shadows', '--tt-shadow-card/panel/popover'),
  'general.motion': root('Motion', '--tt-rainbow-anim'),
  // Element-backed, not :root — the pet is a single fixed ornament with no
  // --tt-* token behind it, so scoping to its own class is what makes
  // "make it smaller / move it / fade it" work without the declarations
  // landing on the whole document.
  'general.pet': {
    label: 'Pet',
    selector: '.tt-pet',
    classable: true,
  },
  'general.animSpeed': root('Animation speed', '--tt-anim-speed'),
  'windows.close': {
    label: 'Close button',
    selector: '.tt-traffic-close',
    varName: '--tt-traffic-close',
    classable: true,
  },
  'windows.minimise': {
    label: 'Minimise button',
    selector: '.tt-traffic-minimise',
    varName: '--tt-traffic-minimise',
    classable: true,
  },
  'windows.maximise': {
    label: 'Expand button',
    selector: '.tt-traffic-maximise',
    varName: '--tt-traffic-maximise',
    classable: true,
  },
}

/**
 * Custom CSS is declarations-only: strip anything that could escape the
 * generated rule or reach outside styling — braces, at-rules, HTML, url()
 * and expression() — the same stance as sanitizeCssValue in tokens.ts.
 */
export const sanitizeCustomCss = (raw: unknown): string => {
  if (typeof raw !== 'string') return ''
  return raw
    .slice(0, 4000)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // stripping every < and > wholesale (single characters remove completely
    // in one pass, so nothing can reassemble) means no HTML or comment
    // delimiter — <!--, -->, --!> — can survive; a separate delimiter regex
    // would be redundant and only partially effective (CodeQL js/bad-tag-filter)
    .replace(/[{}<>@\\]/g, '')
    .replace(/(url|expression|image-set)\s*\(/gi, '(')
    .trim()
}

/** Class lists are plain word/dash tokens. */
export const sanitizeCustomClasses = (raw: unknown): string => {
  if (typeof raw !== 'string') return ''
  return raw
    .slice(0, 200)
    .split(/\s+/)
    .filter((token) => /^[A-Za-z_][\w-]*$/.test(token))
    .join(' ')
}

/** Build the injected stylesheet from a custom map (unknown keys skipped). */
export const buildCustomCss = (custom: TtCustomMap | null | undefined): string => {
  if (!custom || typeof custom !== 'object') return ''
  return Object.entries(custom)
    .map(([key, entry]) => {
      const target = TT_CUSTOM_TARGETS[key]
      const css = sanitizeCustomCss(entry?.css)
      if (!target || !css) return ''
      return `${target.selector} {\n${css}\n}`
    })
    .filter(Boolean)
    .join('\n\n')
}
