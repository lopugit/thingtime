// Pure subspace helpers — slug/rule/flair/branding sanitizers, the public
// subspace projection shape, and the feed ranking — with no mongo/things
// imports so they unit-test in isolation and can be shared by the server
// util (subspaces.ts), the posting gate (gate.ts) and the read path.
import {
	ACL_OWNER,
	MAX_SUBSPACE_ACCENT_CHARS,
	MAX_SUBSPACE_DESCRIPTION_CHARS,
	MAX_SUBSPACE_FLAIR_ID_CHARS,
	MAX_SUBSPACE_FLAIR_LABEL_CHARS,
	MAX_SUBSPACE_FLAIRS,
	MAX_SUBSPACE_ICON_CHARS,
	MAX_SUBSPACE_MOD_REASON_CHARS,
	MAX_SUBSPACE_NAME_CHARS,
	MAX_SUBSPACE_POST_REMOVAL_REASON_CHARS,
	MAX_SUBSPACE_REMOVAL_REASON_MESSAGE_CHARS,
	MAX_SUBSPACE_REMOVAL_REASON_TITLE_CHARS,
	MAX_SUBSPACE_REMOVAL_REASONS,
	MAX_SUBSPACE_RULE_TEXT_CHARS,
	MAX_SUBSPACE_RULE_TITLE_CHARS,
	MAX_SUBSPACE_RULES,
	MAX_SUBSPACE_USER_FLAIR_TEXT_CHARS,
	SUBSPACE_ACCESS_MODES,
	SUBSPACE_FEED_SORTS,
	SUBSPACE_SLUG_HOLD_DAYS,
	SUBSPACE_SLUG_PATTERN,
	type SubspaceAccessMode,
	type SubspaceFeedSort,
	type SubspaceRole
} from '~/schemas/registry';
import { controversyScore, hotScore, risingScore } from '../things/updownCore';

export type Fail = { ok: false; status: number; error: string };
export const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const isFail = (value: unknown): value is Fail => !!value && typeof value === 'object' && (value as any).ok === false;

export type SubspaceRule = { title: string; text: string | null };
export type SubspaceFlair = { id: string; label: string; emoji: string | null; color: string | null; modOnly: boolean };
export type SubspaceBranding = { icon: string | null; iconUrl: string | null; bannerUrl: string | null; accent: string | null };

// Slugs a subspace can't claim: route words under /s/* and things that would
// read as system pages. Lowercase, compared after normalization.
export const RESERVED_SUBSPACE_SLUGS = new Set([
	'all',
	'popular',
	'new',
	'create',
	'mod',
	'mods',
	'admin',
	'api',
	'settings',
	'search',
	'thingtime',
	'lopu',
	'subspace',
	'subspaces',
	'home',
	'feed'
]);

// Normalizes a requested slug: trims, lowercases, swaps spaces/dashes for
// underscores, strips a leading "s/" — then validates the strict grammar.
export const sanitizeSlug = (value: unknown): string | Fail => {
	if (typeof value !== 'string') return fail(400, 'Subspaces need a slug (3–30 lowercase letters, numbers, or _)');
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/^s\//, '')
		.replace(/[\s-]+/g, '_');
	if (!SUBSPACE_SLUG_PATTERN.test(slug)) return fail(400, 'Slugs are 3–30 lowercase letters, numbers, or _ (like rainbow_makers)');
	if (RESERVED_SUBSPACE_SLUGS.has(slug)) return fail(400, `s/${slug} is reserved — pick another slug`);
	return slug;
};

const boundedText = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export const sanitizeName = (value: unknown): string | Fail => {
	const name = boundedText(value, MAX_SUBSPACE_NAME_CHARS);
	if (!name) return fail(400, 'Subspaces need a name');
	return name;
};

export const sanitizeDescription = (value: unknown): string | null | Fail => {
	if (value === undefined || value === null) return null;
	if (typeof value !== 'string') return fail(400, 'description must be text');
	const text = value.trim();
	if (text.length > MAX_SUBSPACE_DESCRIPTION_CHARS) return fail(400, `Description is too long (max ${MAX_SUBSPACE_DESCRIPTION_CHARS})`);
	return text || null;
};

export const sanitizeAccess = (value: unknown): SubspaceAccessMode | Fail => {
	if (value === undefined || value === null || value === '') return 'public';
	if (!(SUBSPACE_ACCESS_MODES as readonly string[]).includes(value as string)) {
		return fail(400, `access must be one of ${SUBSPACE_ACCESS_MODES.join(', ')}`);
	}
	return value as SubspaceAccessMode;
};

export const sanitizeReason = (value: unknown): string | null => boundedText(value, MAX_SUBSPACE_MOD_REASON_CHARS) || null;

export const sanitizeRules = (value: unknown): SubspaceRule[] | Fail => {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) return fail(400, 'rules must be a list');
	if (value.length > MAX_SUBSPACE_RULES) return fail(400, `A subspace can have at most ${MAX_SUBSPACE_RULES} rules`);
	const rules: SubspaceRule[] = [];
	for (const entry of value) {
		const raw = entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>) : typeof entry === 'string' ? { title: entry } : null;
		if (!raw) return fail(400, 'Each rule needs a title');
		const title = boundedText(raw.title, MAX_SUBSPACE_RULE_TITLE_CHARS);
		if (!title) return fail(400, 'Each rule needs a title');
		const textValue = typeof raw.text === 'string' ? raw.text.trim() : '';
		if (textValue.length > MAX_SUBSPACE_RULE_TEXT_CHARS) return fail(400, `Rule text is too long (max ${MAX_SUBSPACE_RULE_TEXT_CHARS})`);
		rules.push({ title, text: textValue || null });
	}
	return rules;
};

const FLAIR_ID_PATTERN = /^[a-z0-9_-]{1,40}$/;
// hex colors or plain CSS named colors — never arbitrary CSS (a flair color
// lands in a style attribute)
const CSS_COLOR_PATTERN = /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i;

export const slugifyFlairId = (label: string): string =>
	label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, MAX_SUBSPACE_FLAIR_ID_CHARS);

export const sanitizeColor = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const color = value.trim();
	if (!color || color.length > MAX_SUBSPACE_ACCENT_CHARS || !CSS_COLOR_PATTERN.test(color)) return null;
	return color;
};

// Emoji-ish short token: bounded, no markup characters. (Keeping this loose
// on purpose — it renders as text, never as HTML.)
export const sanitizeIcon = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const icon = value.trim();
	if (!icon || [...icon].length > 4 || icon.length > MAX_SUBSPACE_ICON_CHARS || /[<>"'&\s]/.test(icon)) return null;
	return icon;
};

export const sanitizeFlairs = (value: unknown): SubspaceFlair[] | Fail => {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) return fail(400, 'flairs must be a list');
	if (value.length > MAX_SUBSPACE_FLAIRS) return fail(400, `A subspace can have at most ${MAX_SUBSPACE_FLAIRS} flairs`);
	const flairs: SubspaceFlair[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		const raw = entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>) : typeof entry === 'string' ? { label: entry } : null;
		if (!raw) return fail(400, 'Each flair needs a label');
		const label = boundedText(raw.label, MAX_SUBSPACE_FLAIR_LABEL_CHARS);
		if (!label) return fail(400, 'Each flair needs a label');
		const requestedId = typeof raw.id === 'string' ? raw.id.trim().toLowerCase() : '';
		const id = requestedId || slugifyFlairId(label);
		if (!FLAIR_ID_PATTERN.test(id)) return fail(400, `Flair ids are 1–${MAX_SUBSPACE_FLAIR_ID_CHARS} lowercase letters, numbers, - or _ (got ${id || label})`);
		if (seen.has(id)) return fail(400, `Duplicate flair id: ${id}`);
		seen.add(id);
		flairs.push({ id, label, emoji: sanitizeIcon(raw.emoji), color: sanitizeColor(raw.color), modOnly: raw.modOnly === true });
	}
	return flairs;
};

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value) && value.length <= 2048;

export const sanitizeBranding = (value: unknown, previous: SubspaceBranding | null = null): SubspaceBranding | Fail => {
	const base: SubspaceBranding = previous || { icon: null, iconUrl: null, bannerUrl: null, accent: null };
	if (value === undefined) return base;
	if (value === null) return { icon: null, iconUrl: null, bannerUrl: null, accent: null };
	if (typeof value !== 'object' || Array.isArray(value)) return fail(400, 'branding must be an object');
	const raw = value as Record<string, unknown>;
	const next = { ...base };
	if ('icon' in raw) next.icon = sanitizeIcon(raw.icon);
	if ('accent' in raw) next.accent = sanitizeColor(raw.accent);
	for (const key of ['iconUrl', 'bannerUrl'] as const) {
		if (!(key in raw)) continue;
		const url = typeof raw[key] === 'string' ? (raw[key] as string).trim() : '';
		if (url && !isHttpUrl(url)) return fail(400, `${key} must be an http(s) URL`);
		next[key] = url || null;
	}
	return next;
};

export const flairById = (flairs: readonly SubspaceFlair[] | null | undefined, id: string | null | undefined): SubspaceFlair | null =>
	id ? (flairs || []).find((flair) => flair.id === id) || null : null;

// ---------------------------------------------------------------------------
// Removal reasons — the canned reasons a moderator picks when removing a post
// (Reddit's "removal reasons"). They live on the subspace crystal as
// `removalReasons: { id, title, message }[]` (ids share the flair-id grammar,
// minted from the title); `moderate remove` takes `reasonId` and the reason's
// title + message (+ the mod's free-text `reason` as a note) become the
// stored reason the author sees on the card and in their bell.
export type SubspaceRemovalReason = { id: string; title: string; message: string };

export const sanitizeRemovalReasons = (value: unknown): SubspaceRemovalReason[] | Fail => {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) return fail(400, 'removalReasons must be a list');
	if (value.length > MAX_SUBSPACE_REMOVAL_REASONS) return fail(400, `A subspace can have at most ${MAX_SUBSPACE_REMOVAL_REASONS} removal reasons`);
	const reasons: SubspaceRemovalReason[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		const raw = entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>) : typeof entry === 'string' ? { title: entry } : null;
		if (!raw) return fail(400, 'Each removal reason needs a title');
		const title = boundedText(raw.title, MAX_SUBSPACE_REMOVAL_REASON_TITLE_CHARS);
		if (!title) return fail(400, 'Each removal reason needs a title');
		const message = typeof raw.message === 'string' ? raw.message.replace(/\s+/g, ' ').trim() : '';
		if (message.length > MAX_SUBSPACE_REMOVAL_REASON_MESSAGE_CHARS) return fail(400, `Removal reason message is too long (max ${MAX_SUBSPACE_REMOVAL_REASON_MESSAGE_CHARS})`);
		const requestedId = typeof raw.id === 'string' ? raw.id.trim().toLowerCase() : '';
		const id = requestedId || slugifyFlairId(title);
		if (!FLAIR_ID_PATTERN.test(id)) return fail(400, `Removal reason ids are 1–${MAX_SUBSPACE_FLAIR_ID_CHARS} lowercase letters, numbers, - or _ (got ${id || title})`);
		if (seen.has(id)) return fail(400, `Duplicate removal reason id: ${id}`);
		seen.add(id);
		reasons.push({ id, title, message });
	}
	return reasons;
};

// a stored subspace crystal's removal reasons (anything malformed reads as none)
export const removalReasonsOf = (crystal: Record<string, any> | null | undefined): SubspaceRemovalReason[] => {
	const raw = crystal?.removalReasons;
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string' && typeof entry.title === 'string' && entry.title)
		.map((entry) => ({ id: entry.id, title: entry.title, message: typeof entry.message === 'string' ? entry.message : '' }));
};

export const removalReasonById = (reasons: readonly SubspaceRemovalReason[] | null | undefined, id: string | null | undefined): SubspaceRemovalReason | null =>
	id ? (reasons || []).find((reason) => reason.id === id) || null : null;

// What `moderate remove` stores. `reasonId` names one of the subspace's
// removal reasons (unknown → 400): its title — message becomes the reason,
// with the mod's free-text `reason` appended as a note ("· note"). Without a
// reasonId the free text alone is the reason (≤ MAX_SUBSPACE_MOD_REASON_CHARS,
// the pre-S4 behaviour); neither → null (a removal with no stated reason).
// The composed text is bounded by MAX_SUBSPACE_POST_REMOVAL_REASON_CHARS.
export type ResolvedRemovalReason = { reason: string | null; reasonId: string | null };
export const resolveRemovalReason = (input: { reason?: unknown; reasonId?: unknown }, reasons: readonly SubspaceRemovalReason[]): ResolvedRemovalReason | Fail => {
	const note = sanitizeReason(input.reason);
	const reasonId = typeof input.reasonId === 'string' ? input.reasonId.trim().toLowerCase() : '';
	if (!reasonId) return { reason: note, reasonId: null };
	const canned = removalReasonById(reasons, reasonId);
	if (!canned) return fail(400, `No removal reason "${reasonId}" here — pick one of the subspace’s reasons or write your own`);
	const text = [canned.message ? `${canned.title} — ${canned.message}` : canned.title, note].filter(Boolean).join(' · ');
	return { reason: text.slice(0, MAX_SUBSPACE_POST_REMOVAL_REASON_CHARS), reasonId: canned.id };
};

// ---------------------------------------------------------------------------
// User flairs — the flair a member wears beside their name in ONE subspace.
// Templates live on the subspace (`userFlairs`, the post-flair shape); the
// member's pick lives on their subspace-member row as `userFlair`: a template
// id + a snapshot of its text/emoji/color, or id null + custom text. Posts and
// comments project it as `authorFlair`, resolved against the live templates
// (a renamed template updates every wearer; a deleted one keeps the snapshot).
export type SubspaceUserFlair = { id: string | null; text: string; emoji: string | null; color: string | null };
// the wire shape (PublicPost.authorFlair / viewer.userFlair / member.userFlair)
export type PublicUserFlair = { id: string | null; label: string; emoji: string | null; color: string | null };
export type UserFlairSettings = { userFlairs: SubspaceFlair[]; userFlairSelfAssign: boolean; allowCustomUserFlair: boolean };

// user-flair templates share the post-flair grammar and cap
export const sanitizeUserFlairs = (value: unknown): SubspaceFlair[] | Fail => {
	const flairs = sanitizeFlairs(value);
	if (isFail(flairs)) return fail(flairs.status, `User flairs: ${flairs.error}`);
	return flairs;
};

// the three settings with their defaults (self-assign ON, custom text OFF)
export const userFlairSettingsOf = (crystal: Record<string, any> | null | undefined): UserFlairSettings => ({
	userFlairs: Array.isArray(crystal?.userFlairs) ? crystal!.userFlairs : [],
	userFlairSelfAssign: crystal?.userFlairSelfAssign !== false,
	allowCustomUserFlair: crystal?.allowCustomUserFlair === true
});

// a stored member row's flair, normalized (anything malformed reads as none)
export const userFlairOfCrystal = (crystal: Record<string, any> | null | undefined): SubspaceUserFlair | null => {
	const raw = crystal?.userFlair;
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const text = typeof raw.text === 'string' ? raw.text.trim() : '';
	if (!text) return null;
	return {
		id: typeof raw.id === 'string' && raw.id ? raw.id : null,
		text: text.slice(0, MAX_SUBSPACE_FLAIR_LABEL_CHARS),
		emoji: sanitizeIcon(raw.emoji),
		color: sanitizeColor(raw.color)
	};
};

// The stored pick resolved against the subspace's CURRENT templates: a
// template pick follows the template (label/emoji/color edits reach every
// wearer, and a template the mods deleted keeps its snapshot rather than
// vanishing mid-thread); custom text is what it is.
export const liveUserFlair = (stored: SubspaceUserFlair | null, templates: readonly SubspaceFlair[] | null | undefined): SubspaceUserFlair | null => {
	if (!stored) return null;
	const template = flairById(templates, stored.id);
	return template ? { id: template.id, text: template.label, emoji: template.emoji, color: template.color } : stored;
};

export const toPublicUserFlair = (flair: SubspaceUserFlair | null): PublicUserFlair | null =>
	flair ? { id: flair.id, label: flair.text, emoji: flair.emoji, color: flair.color } : null;

// Does a member's pick survive losing the mod hat? A MOD-ONLY template is
// handed out by moderators and worn by moderators — a demoted moderator (or
// a member a mod once dressed) does not keep it. Ordinary templates and
// custom text stay: the member could have picked those themselves. A pick
// whose template was deleted meanwhile is a plain snapshot and stays too.
export const userFlairSurvivesDemotion = (stored: SubspaceUserFlair | null, templates: readonly SubspaceFlair[] | null | undefined): boolean => {
	if (!stored?.id) return true;
	const template = flairById(templates, stored.id);
	return !template?.modOnly;
};

export type UserFlairRequest = { flairId?: unknown; text?: unknown; emoji?: unknown; color?: unknown };
export type UserFlairActor = { moderator: boolean; self: boolean };

// The one decision every user-flair write runs. `flairId` picks a template
// (unknown → 400; modOnly → moderators only, 403); `text` without an id is
// custom text (≤ MAX_SUBSPACE_USER_FLAIR_TEXT_CHARS, optional emoji/color
// under the icon/color rules); neither (null id + empty text) clears. A
// member may only serve themselves while userFlairSelfAssign is on and, for
// custom text, allowCustomUserFlair is on — clearing their own is always
// allowed. Moderators are bound by neither switch and may dress anyone.
export const resolveUserFlair = (request: UserFlairRequest, settings: UserFlairSettings, actor: UserFlairActor): SubspaceUserFlair | null | Fail => {
	const flairId = typeof request.flairId === 'string' ? request.flairId.trim().toLowerCase() : '';
	const text = boundedText(request.text, MAX_SUBSPACE_FLAIR_LABEL_CHARS);
	if (!flairId && !text) return null; // clear
	if (!actor.moderator && !settings.userFlairSelfAssign) return fail(403, 'Members can’t pick their own flair here — ask a moderator 🎩');
	if (flairId) {
		const template = flairById(settings.userFlairs, flairId);
		if (!template) return fail(400, `No user flair "${flairId}" here`);
		if (template.modOnly && !actor.moderator) return fail(403, `The "${template.label}" flair is moderator-only`);
		return { id: template.id, text: template.label, emoji: template.emoji, color: template.color };
	}
	if (!actor.moderator && !settings.allowCustomUserFlair) return fail(403, 'Custom flair text is off here — pick one of the templates');
	if (text.length > MAX_SUBSPACE_USER_FLAIR_TEXT_CHARS) return fail(400, `Flair text is too long (max ${MAX_SUBSPACE_USER_FLAIR_TEXT_CHARS} characters)`);
	return { id: null, text, emoji: sanitizeIcon(request.emoji), color: sanitizeColor(request.color) };
};

export const sanitizeSort = (value: unknown): SubspaceFeedSort => ((SUBSPACE_FEED_SORTS as readonly string[]).includes(value as string) ? (value as SubspaceFeedSort) : 'hot');

export const TOP_RANGES = ['hour', 'day', 'week', 'month', 'year', 'all'] as const;
export type TopRange = (typeof TOP_RANGES)[number];
export const sanitizeTopRange = (value: unknown): TopRange => ((TOP_RANGES as readonly string[]).includes(value as string) ? (value as TopRange) : 'all');
export const topRangeSince = (range: TopRange, nowMs: number): Date | null => {
	const hour = 3_600_000;
	switch (range) {
		case 'hour':
			return new Date(nowMs - hour);
		case 'day':
			return new Date(nowMs - 24 * hour);
		case 'week':
			return new Date(nowMs - 7 * 24 * hour);
		case 'month':
			return new Date(nowMs - 30 * 24 * hour);
		case 'year':
			return new Date(nowMs - 365 * 24 * hour);
		default:
			return null;
	}
};

// ---------------------------------------------------------------------------
// Ranking. Candidates are lean rows (id, createdAt, up/down tally, pinned);
// the result is the ordered id list for the requested sort. Pinned posts lead
// hot/new (the two "front page" sorts); top/rising/controversial are pure
// rankings. Deterministic tie-breaks (newer first, then id) keep pagination
// stable for a fixed dataset + timestamp.
export type RankCandidate = { id: string; createdAtMs: number; up: number; down: number; pinned: boolean };

export const rankSubspacePosts = (candidates: readonly RankCandidate[], sort: SubspaceFeedSort, nowMs: number): string[] => {
	const scoreOf = (candidate: RankCandidate): number => {
		const score = candidate.up - candidate.down;
		switch (sort) {
			case 'new':
				return candidate.createdAtMs;
			case 'top':
				return score;
			case 'rising':
				return risingScore(score, candidate.createdAtMs, nowMs);
			case 'controversial':
				return controversyScore(candidate.up, candidate.down);
			case 'hot':
			default:
				return hotScore(score, candidate.createdAtMs);
		}
	};
	const pinFirst = sort === 'hot' || sort === 'new';
	return [...candidates]
		.map((candidate) => ({ candidate, score: scoreOf(candidate) }))
		.sort((a, b) => {
			if (pinFirst && a.candidate.pinned !== b.candidate.pinned) return a.candidate.pinned ? -1 : 1;
			return b.score - a.score || b.candidate.createdAtMs - a.candidate.createdAtMs || a.candidate.id.localeCompare(b.candidate.id);
		})
		.map((entry) => entry.candidate.id);
};

// ---------------------------------------------------------------------------
// Roles + membership state.
export const ROLE_RANK: Record<SubspaceRole, number> = { member: 0, moderator: 1, owner: 2 };
export const isModeratorRole = (role: SubspaceRole | null | undefined): boolean => role === 'owner' || role === 'moderator';

// The lean membership flags every predicate below reads (gate.ts's
// SubspaceMembership is a superset). `pending` = a join request awaiting a
// moderator: the row exists so it can be listed / accepted / denied, but it is
// NOT a membership — it cannot read a private feed, post, or count as a
// member. `approvalRequested` = an active member of a restricted subspace
// asking for posting rights.
export type MembershipState = { role: SubspaceRole; approved: boolean; banned: boolean; left: boolean; pending: boolean; approvalRequested: boolean };

// isActiveMember: row exists && !left && !banned && !pending
export const isActiveMembershipState = (membership: Partial<MembershipState> | null | undefined): boolean =>
	!!membership && membership.left !== true && membership.banned !== true && membership.pending !== true;

// May this viewer post here? Moderators always; otherwise the access mode
// decides: public → anyone not banned (members and strangers alike),
// restricted → approved posters, private → active members. A pending
// requester of a private subspace can't post (they are not a member yet).
export const canPostIn = (access: SubspaceAccessMode, membership: Partial<MembershipState> | null | undefined): boolean => {
	if (membership?.banned) return false;
	const active = isActiveMembershipState(membership);
	if (active && isModeratorRole(membership!.role)) return true;
	if (access === 'public') return true;
	if (access === 'restricted') return active && membership!.approved === true;
	return active;
};

// Which queue a member row belongs in, if any — the mod page's Requests tab
// shows join requests (pending) and posting-approval requests (an active,
// unapproved member who asked).
export const requestKindOf = (membership: Partial<MembershipState> | null | undefined): 'join' | 'approval' | null => {
	if (!membership || membership.left === true || membership.banned === true) return null;
	if (membership.pending === true) return 'join';
	if (membership.approvalRequested === true && membership.approved !== true) return 'approval';
	return null;
};

// ---------------------------------------------------------------------------
// Lifecycle (transfer / delete).

// Deleting a subspace asks the owner to retype its slug. Intent is the point,
// not typing precision: a leading "s/", case and surrounding whitespace are
// forgiven, anything else (another slug, empty, non-string) is a mismatch.
export const confirmSlugMatches = (confirm: unknown, slug: string): boolean =>
	typeof confirm === 'string' && !!slug && confirm.trim().toLowerCase().replace(/^s\//, '') === slug;

// What a post loses when its subspace is deleted — it survives as a plain
// post (the title stays: any post may carry one), so the subspace pointer +
// flair and the server-owned moderation state + private fence go. These are
// the exact Mongo paths the accounted bulk updater $unsets.
export const RELEASED_POST_UNSET = Object.freeze({ 'crystal.subspaceId': '', 'crystal.flairId': '', subspaceMod: '', subspacePrivate: '' });
export const releasedPostUpdate = (now: Date) => ({ $unset: { ...RELEASED_POST_UNSET }, $set: { updatedAt: now } });
// The owner's click must never publish what an author never chose to
// publish: a post written behind a private subspace's wall, and a post the
// community's moderators removed, leave the subspace as an author-only
// (private) post instead of a world-readable one — same strip, plus the acl
// narrowed to the owner. The author can re-share it deliberately.
export const privatizedPostUpdate = (now: Date) => ({ $unset: { ...RELEASED_POST_UNSET }, $set: { updatedAt: now, acl: [ACL_OWNER] } });
// Which release a post gets when its subspace goes: everything in a private
// subspace stays private; elsewhere only moderator-removed posts do.
export const releaseKindFor = (subspaceAccess: SubspaceAccessMode, postRemoved: boolean): 'released' | 'privatized' =>
	subspaceAccess === 'private' || postRemoved ? 'privatized' : 'released';

// Slug hold after deletion (see SUBSPACE_SLUG_HOLD_DAYS): the tombstone's
// owner (the last owner of the deleted subspace) may re-found the slug at
// once; everyone else waits out the hold. `until` is when the hold lapses.
export const SUBSPACE_SLUG_HOLD_MS = SUBSPACE_SLUG_HOLD_DAYS * 86_400_000;
export type SlugHoldState = { held: boolean; until: Date | null };
export const slugHoldState = (tombstone: { ownerId?: unknown; crystal?: { deletedAt?: unknown } } | null | undefined, viewerId: string, nowMs: number): SlugHoldState => {
	if (!tombstone) return { held: false, until: null };
	const raw = tombstone.crystal?.deletedAt;
	const deletedAt = raw instanceof Date ? raw : typeof raw === 'string' || typeof raw === 'number' ? new Date(raw) : null;
	const deletedMs = deletedAt && Number.isFinite(deletedAt.getTime()) ? deletedAt.getTime() : nowMs;
	const until = new Date(deletedMs + SUBSPACE_SLUG_HOLD_MS);
	if (String(tombstone.ownerId || '') === viewerId) return { held: false, until };
	return { held: until.getTime() > nowMs, until };
};

export const isFailValue = isFail;
