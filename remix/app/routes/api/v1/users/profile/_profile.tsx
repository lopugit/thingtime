import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { findUserByUsername, toPublicProfile, updateUserProfile } from '~/api/utils/auth/users';
import { isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';
import { getSharedTheme } from '~/api/utils/themes/themes';
import { countPublicPosts } from '~/api/utils/things/things';

// GET /api/v1/users/profile?username= — a user's public profile (safe
// projection: never email/verification/storage) + their public post count +
// the theme they're wearing ("wear my theme", claude-todo/10 ✨).
//
// Injected like the action below (and the attachment/moderation loaders): the
// worn-theme gate is a privacy boundary on an anonymous endpoint, so it needs
// to be assertable without a database. `findUserByUsername` hands back the
// FULL decoded user doc — email, passwordHash, meta.activeThemeId — and only
// toPublicProfile plus the wornTheme projection stand between that and the
// wire, which is exactly what profileRoute.test.ts pins.
type ProfileLoaderDependencies = {
	findUser: typeof findUserByUsername;
	countPosts: typeof countPublicPosts;
	getWornTheme: typeof getSharedTheme;
};

const defaultLoaderDependencies: ProfileLoaderDependencies = {
	findUser: findUserByUsername,
	countPosts: countPublicPosts,
	getWornTheme: getSharedTheme
};

export const createProfileLoader = (overrides: Partial<ProfileLoaderDependencies> = {}) => {
	const dependencies = { ...defaultLoaderDependencies, ...overrides };

	return async ({ request }: { request: Request }) => {
		const params = new URL(request.url).searchParams;
		const username = (params.get('username') || '').trim();
		if (!username) {
			return json({ ok: false, error: 'username is required' }, { status: 400 });
		}

		const user = await dependencies.findUser(username);
		if (!user) {
			return json({ ok: false, error: 'User not found' }, { status: 404 });
		}

		const postCount = await dependencies.countPosts(String(user._id));

		// The worn theme is resolved through the same public gate share links use
		// (getSharedTheme), so a PRIVATE active theme yields null — the raw
		// activeThemeId never rides the public profile payload, and a chip shows
		// iff its ?apply link would resolve for the visitor.
		const activeThemeId = typeof user.meta?.activeThemeId === 'string' ? user.meta.activeThemeId : null;
		const worn = activeThemeId ? await dependencies.getWornTheme(activeThemeId) : null;

		return json({
			ok: true,
			profile: toPublicProfile(user),
			postCount,
			wornTheme: worn ? { id: worn.id, name: worn.name } : null
		});
	};
};

export const loader = createProfileLoader();

// Keep this mutation body bounded. Existing data:image values remain readable,
// but new profile image writes use http(s) links or managed S3 attachments.
const MAX_BODY_BYTES = 256 * 1024;

// POST /api/v1/users/profile — { displayName?, bio?, avatarUrl?, bannerUrl?,
// avatarAttachmentId?, bannerAttachmentId? }
// — update the caller's own profile fields.
type ProfileActionDependencies = {
	getUser: typeof getCurrentUser;
	updateProfile: typeof updateUserProfile;
};

export const createProfileAction = (overrides: Partial<ProfileActionDependencies> = {}) => {
	const dependencies: ProfileActionDependencies = {
		getUser: getCurrentUser,
		updateProfile: updateUserProfile,
		...overrides
	};

	return async ({ request }: { request: Request }) => {
		if (!isSameOriginAttachmentRequest(request)) {
			return json({ ok: false, error: 'Cross-origin profile requests are not allowed' }, { status: 403 });
		}
		const user = await dependencies.getUser(request);
		if (!user) {
			return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
		}

		const contentType = request.headers.get('content-type') || '';
		if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
			return json({ ok: false, error: 'Content-Type must be application/json' }, { status: 415 });
		}

		const body = await readJsonBody(request, MAX_BODY_BYTES);
		const result = await dependencies.updateProfile(user.id, body);

		if (result.ok === false) {
			return json({ ok: false, error: result.error }, { status: result.status });
		}
		return json({ ok: true, user: result.user });
	};
};

export const action = createProfileAction();
