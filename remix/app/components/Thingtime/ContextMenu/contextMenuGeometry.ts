// Recompute from the unshifted anchor so repeated layout/resize checks do not
// accumulate offsets. The surface itself caps its size to the viewport.
export const clampMenuAxisShift = (start: number, size: number, viewport: number, margin = 8) =>
  Math.max(margin, Math.min(start, viewport - size - margin)) - start;
