/**
 * Pure helpers behind the decorative pet layer.
 *
 * The pet is app-wide chrome, so its motion and inset rules are the parts most
 * likely to regress. They live here as plain functions because the suite is
 * `node --test` over pure cores — there are no React render tests in this repo.
 */

/**
 * The theme's decorative-motion master switch (Settings → Motion, published as
 * `--tt-motion` by the theme tokens). Defaults to on, so an absent or
 * not-yet-hydrated theme still animates rather than silently freezing the pet.
 */
export const petMotionEnabled = (general?: { motion?: boolean } | null): boolean => general?.motion !== false;

/**
 * A Chakra `animation` value, or undefined when decorative motion is off —
 * dropping the declaration entirely so no animation is even scheduled.
 *
 * `prefers-reduced-motion` is deliberately NOT handled here: it is a CSS media
 * query on the component so it applies on the very first paint, with no
 * client-only state that could diverge from the server render.
 */
export const petAnimation = (spec: string, motion: boolean): string | undefined => (motion ? spec : undefined);

/**
 * A fixed-position offset that clears the device safe area, matching the
 * convention DevKit/NavDrawer/Footer already use for bottom-anchored chrome
 * (`--thingtime-safe-area-*`, with the raw `env()` as the fallback).
 */
export const petInset = (px: number, axis: 'bottom' | 'right'): string =>
	`calc(${px}px + var(--thingtime-safe-area-${axis}, env(safe-area-inset-${axis}, 0px)))`;
