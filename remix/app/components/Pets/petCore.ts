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
 * The theme's pet switch (Settings → Pet / `theme.general.pet`). Deliberately
 * separate from `motion`: motion off keeps the pet and stops it animating, pet
 * off unmounts it entirely — the pet is permanent app-wide chrome, so "I don't
 * want to see this at all" is a real user choice and needs its own control
 * (AI_ALL.md, "Feature customization defaults").
 *
 * Defaults to on like every other general token, so an older stored theme that
 * predates the key — or a theme that hasn't hydrated yet — keeps the pet rather
 * than flashing it away on first paint.
 */
export const petVisible = (general?: { pet?: boolean } | null): boolean => general?.pet !== false;

/**
 * Whether the pet belongs in the tree at all — the Pet switch, but only once
 * the stored answer is actually known.
 *
 * Thingtime state restores asynchronously (ThingtimeProvider awaits localforage
 * and holds `loading` true until it resolves), so every setting reads as its
 * default until then. Mounting on that default would flash a full-size animated
 * unicorn into the corner on every single load for exactly the users who
 * switched it off — the annoying end of the eggs.ts rule this pet is built
 * around, and worse than simply leaving it on. Staying absent while `loading`
 * mirrors the drawer, which stays closed until its persisted state restores
 * (useDrawer/Main) rather than guessing its position and animating twice.
 *
 * `petVisible` keeps defaulting to on, so the pet-on majority — including a
 * stored theme that predates the key — is unaffected beyond appearing one
 * hydration tick later. A non-boolean `loading` (no provider, as in an embed or
 * a test harness) reads as "not loading", so the pet still shows.
 */
export const petMounted = (loading?: boolean | null, general?: { pet?: boolean } | null): boolean => !loading && petVisible(general);

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

/**
 * How far in from the right edge the pet has to sit to stay off the DevKit
 * bubble.
 *
 * The bottom-right corner is already spoken for: DevKit pins a 52px trigger at
 * `safe-area-right + 20px`, and it is on whenever the deploy env is not
 * production — every preview deployment and every local dev session, i.e.
 * exactly where this pet gets looked at. Raw-corner chrome lands under it.
 *
 * Clearing it is the house rule rather than a one-off: InspectorReopenPill
 * already sits at `right: 84px` "clear of the DevKit bubble bottom-right", and
 * AutoLoginPopup carries the same note. 20 + 52 + a 12px gutter is that same
 * 84, so the pet steps left of the bubble while keeping its bottom anchor (and
 * with it the home-indicator clearance petInset exists for).
 */
export const PET_DEVKIT_CLEARANCE = 84;
