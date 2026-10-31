// Credentials minted for a bounded surface must never fall through to the
// general account-session path. Purpose was absent on legacy browser sessions,
// so nullish remains compatible; every named current/future purpose fails
// closed unless it is explicitly a full-account credential here.
// 'deployment-link' is full-credential by design (deployments/token mints it
// for another Thingtime deployment that then reads /auth/me, lists things, and
// writes things + profile as the user), so it belongs with 'service' rather
// than the bounded purposes. Without it the mint route hands back a token that
// fails every subsequent call — and the link flow revokes the working
// login-derived token right after swapping to it, so the link is left dead.
export const sessionPurposeCanActAsAccount = (purpose: unknown): boolean =>
	purpose === undefined ||
	purpose === null ||
	purpose === 'browser' ||
	purpose === 'service' ||
	purpose === 'deployment-link';
