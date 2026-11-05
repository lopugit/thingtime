/** Per-file transport budgets, shared by the server and negotiated client.
 * Backpressure does not spend the upstream inactivity timer. */
export const ORIGINAL_STREAM_POLICY = { idleMs: 30_000, totalMs: 10 * 60_000 } as const;
