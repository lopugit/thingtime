/** Shared revocation retention policy. The Mongo pipeline remains exported
 * through sessions.ts for all existing callers; native persistence implements
 * this same policy explicitly, without interpreting Mongo expressions. */
export const REVOKED_SESSION_REAP_MS = 1000 * 60 * 60 * 24 * 30;
// The $set body stays private: $ifNull evaluates only in an aggregation
// pipeline. Passing it to a plain update stores the expression as expiresAt,
// leaving a non-Date value that TTL cleanup cannot reap. Export only the
// pipeline wrapper, never a reusable plain-update body.
const revokedSessionSet = (revokedAt: Date) => ({
 revokedAt,
 expiresAt: { $ifNull: ['$expiresAt', new Date(revokedAt.getTime() + REVOKED_SESSION_REAP_MS)] }
});
export const revokedSessionPipeline = (revokedAt: Date) => [{ $set: revokedSessionSet(revokedAt) }, { $unset: 'secureVaultKey' }];
