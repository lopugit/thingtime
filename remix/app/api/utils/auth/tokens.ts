// One generator for every single-use auth token — email verification links,
// password-reset links, and OTP challenge ids. Two concatenated UUIDs with the
// dashes stripped (~256 bits). Kept in one place so token strength/format can
// never drift between the auth flows that all rely on it.
export const newAuthToken = () => (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
