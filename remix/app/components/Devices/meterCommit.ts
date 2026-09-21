// Pure helpers for committing remote meter (brightness/volume) adjustments.
// Kept out of the component so the keyboard allowlist, the percent range guard
// and the duplicate-submission rule stay directly testable.

// Keys Chakra's slider maps to a value change. Releasing any of these must
// commit the rendered thumb value, because the pointer-end callback does not
// reliably run for keyboard input in the current React runtime.
export const METER_COMMIT_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'] as const;

export type MeterSubmission = { key: string; percent: number };

export const isMeterCommitKey = (key: string): boolean => (METER_COMMIT_KEYS as readonly string[]).includes(key);

// `last` is the previous submission for this control. The idempotency token
// rotates once an action is dispatched, so an identical percent under the same
// token is a duplicate (pointer end plus key up for one interaction) rather
// than a genuine repeat adjustment.
export const shouldSubmitMeterPercent = (last: MeterSubmission | null, next: MeterSubmission): boolean => {
	if (!next.key) return false;
	if (!Number.isFinite(next.percent) || next.percent < 0 || next.percent > 100) return false;
	if (last && last.key === next.key && last.percent === next.percent) return false;
	return true;
};
