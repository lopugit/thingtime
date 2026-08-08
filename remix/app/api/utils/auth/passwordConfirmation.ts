import { verifyPassword } from './passwords';
import { findUserById, type UserDoc } from './users';

const MAX_CONFIRMATION_PASSWORD_CHARS = 4_096;
const MAX_CONFIRMATION_USER_ID_CHARS = 256;

type PasswordConfirmationDependencies = {
	findUser: (userId: string) => Promise<UserDoc | null>;
	verify: (password: string, hash: string) => Promise<boolean>;
};

const defaultDependencies: PasswordConfirmationDependencies = {
	findUser: findUserById,
	verify: verifyPassword
};

export type PasswordConfirmationResult = 'confirmed' | 'mismatch' | 'unavailable';

// Re-check the current password without creating a session, OTP challenge, or
// reusable reauthentication token. The deliberately tiny result union keeps
// user records and password hashes out of every caller response and error path.
export const confirmCurrentPassword = async (
	userId: unknown,
	password: unknown,
	dependencies: PasswordConfirmationDependencies = defaultDependencies
): Promise<PasswordConfirmationResult> => {
	if (
		typeof userId !== 'string' ||
		!userId ||
		userId.length > MAX_CONFIRMATION_USER_ID_CHARS ||
		typeof password !== 'string' ||
		!password ||
		password.length > MAX_CONFIRMATION_PASSWORD_CHARS
	) {
		return 'mismatch';
	}

	try {
		const user = await dependencies.findUser(userId);
		if (!user) return 'mismatch';
		if (typeof user.passwordHash !== 'string' || !user.passwordHash) return 'unavailable';
		return (await dependencies.verify(password, user.passwordHash)) === true ? 'confirmed' : 'mismatch';
	} catch {
		return 'unavailable';
	}
};
