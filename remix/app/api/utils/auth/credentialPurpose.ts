// Credentials minted for a bounded surface must never fall through to the
// general account-session path. Purpose was absent on legacy browser sessions,
// so nullish remains compatible; every named current/future purpose fails
// closed unless it is explicitly a full-account credential here.
export const sessionPurposeCanActAsAccount = (purpose: unknown): boolean =>
	purpose === undefined || purpose === null || purpose === 'browser' || purpose === 'service';
