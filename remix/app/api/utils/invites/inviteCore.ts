import { createHash, randomBytes } from 'node:crypto';

export const INVITE_KIND = 'account-invite';
export const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_PENDING_INVITES = 20;
export const MAX_AVATAR_BYTES = 16 * 1024;
export class InviteError extends Error {
	constructor(public status: number, message: string) {
		super(message);
	}
}
export const inviteToken = () => randomBytes(32).toString('base64url');
export const inviteTokenHash = (token: unknown) => {
	if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new InviteError(404, 'This invite is unavailable.');
	return createHash('sha256').update(token).digest('hex');
};
export const inviteProfile = (input: any) => {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InviteError(400, 'Enter the recipient’s profile details.');
	const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
	const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
	if (!/^[a-z0-9][a-z0-9._-]{1,39}$/.test(username))
		throw new InviteError(400, 'Use 2–40 letters, numbers, dots, underscores or hyphens for the username.');
	if (!displayName || displayName.length > 100) throw new InviteError(400, 'Enter a display name of up to 100 characters.');
	return { username, displayName };
};
export const inviteAmount = (credits: unknown) => {
	if (typeof credits !== 'number' || !Number.isFinite(credits) || credits < 0 || credits > 10_000)
		throw new InviteError(400, 'Choose between 0 and 10,000 credits.');
	const micros = Math.round(credits * 1_000_000);
	if (Math.abs(micros / 1_000_000 - credits) > 1e-10) throw new InviteError(400, 'Credits support up to six decimal places.');
	return micros;
};
