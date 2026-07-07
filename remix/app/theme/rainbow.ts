/**
 * Canonical rainbow gradients. Every component that previously hardcoded the
 * five brand hexes should import from here (or read the --tt-* CSS vars).
 *
 * The var() forms re-theme live; the hex fallbacks equal the default palette.
 */
import { RAINBOW_PALETTE } from './tokens'

export { RAINBOW_PALETTE }

/** 90deg looping gradient — borders, buttons, cards (UserCard/Lopu style).
 * Horizontal so the tile wraps seamlessly under moving-rainbow animation. */
export const RAINBOW =
  'var(--tt-gradient-rainbow, linear-gradient(90deg, #47b5e6, #a555e8, #f34a4a, #ffbc48, #58ca70, #47b5e6))'

/** 90deg red-first looping gradient — animated headline text (rainbowText). */
export const RAINBOW_TEXT =
  'var(--tt-gradient-rainbow-x, linear-gradient(90deg, #f34a4a, #ffbc48, #58ca70, #47b5e6, #a555e8, #f34a4a))'

/** Conic spinner (DevKit trigger ring). */
export const RAINBOW_CONIC =
  'conic-gradient(from 0deg, var(--tt-rainbow-4, #47b5e6), var(--tt-rainbow-5, #a555e8), var(--tt-rainbow-1, #f34a4a), var(--tt-rainbow-2, #ffbc48), var(--tt-rainbow-3, #58ca70), var(--tt-rainbow-4, #47b5e6))'

/** Individual stops with live-theming var() wrappers. */
export const RAINBOW_VARS = [
  'var(--tt-rainbow-1, #f34a4a)',
  'var(--tt-rainbow-2, #ffbc48)',
  'var(--tt-rainbow-3, #58ca70)',
  'var(--tt-rainbow-4, #47b5e6)',
  'var(--tt-rainbow-5, #a555e8)',
]
