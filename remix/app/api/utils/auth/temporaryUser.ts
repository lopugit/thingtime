import { randomUUID } from 'node:crypto';

import { signJwt } from './jwt';
import { createUserAccount, type CreateUserAccountInput } from './registerUser';
import { createSession } from './sessions';
import type { PublicUser } from './users';

export const TEMPORARY_USER_STORAGE_ALLOWANCE_BYTES = 64 * 1024 * 1024;
export const TEMPORARY_USER_SOURCE = 'things-first-land';

export const buildTemporaryUserAccountInput = (
	identity: string = randomUUID(),
	credential: string = randomUUID()
): CreateUserAccountInput => {
	const suffix = identity.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12) || randomUUID().replace(/-/g, '').slice(0, 12);

	return {
		username: `guest-${suffix}`,
		password: `temporary-${credential}`,
		email: `guest-${suffix}@temporary.thingtime.invalid`,
		displayName: 'Temporary space',
		emailVerified: false,
		accountKind: 'user',
		storageAllowanceBytes: TEMPORARY_USER_STORAGE_ALLOWANCE_BYTES,
		meta: {
			temporary: true,
			recoverable: true,
			createdFrom: TEMPORARY_USER_SOURCE
		}
	};
};

export type TemporaryUserSessionResult =
	| { ok: false; status: number; error: string }
	| { ok: true; user: PublicUser; jwt: string; jti: string };

// Temporary users are normal user Things with a deliberately inaccessible
// generated credential. That keeps every read/write on the standard account,
// session, ACL, quota, and roster paths while the browser's recoverable roster
// session remains the only credential presented to the visitor.
export const createTemporaryUserSession = async (): Promise<TemporaryUserSessionResult> => {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const created = await createUserAccount(buildTemporaryUserAccountInput());
		if (created.ok === false) {
			// UUID-backed collisions are fantastically unlikely, but retrying keeps
			// this path deterministic even under a mocked/randomness failure.
			if (created.status === 409) continue;
			return created;
		}

		const userId = String(created.user._id);
		const session = await createSession(userId, {
			purpose: 'browser',
			meta: { temporary: true, source: TEMPORARY_USER_SOURCE }
		});
		const jwt = await signJwt({ sub: userId, jti: session.jti });

		return { ok: true, user: created.publicUser, jwt, jti: session.jti };
	}

	return { ok: false, status: 503, error: 'Could not reserve a temporary space — please try again' };
};
