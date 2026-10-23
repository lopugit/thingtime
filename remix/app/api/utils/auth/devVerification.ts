// Dev verification links include a raw email-verification token. Surface them
// only in local development and Vercel preview, never in real production or in
// unknown production-like hosts where VERCEL_ENV may be unset.
export const shouldShowDevVerificationLink = () =>
  process.env.NODE_ENV === 'development' ||
  process.env.VERCEL_ENV === 'preview' ||
  process.env.VERCEL_TARGET_ENV === 'preview';
