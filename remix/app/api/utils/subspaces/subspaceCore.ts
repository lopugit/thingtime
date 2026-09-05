// Pure subspace helpers — slug/rule/flair/branding sanitizers, the public
// subspace projection shape, and the feed ranking — with no mongo/things
// imports so they unit-test in isolation and can be shared by the server
// util (subspaces.ts), the posting gate (gate.ts) and the read path.
import {
	MAX_SUBSPACE_ACCENT_CHARS,
	MAX_SUBSPACE_DESCRIPTION_CHARS,
	MAX_SUBSPACE_FLAIR_ID_CHARS,
	MAX_SUBSPACE_FLAIR_LABEL_CHARS,
	MAX_SUBSPACE_FLAIRS,
	MAX_SUBSPACE_ICON_CHARS,
	MAX_SUBSPACE_MOD_REASON_CHARS,
	MAX_SUBSPACE_NAME_CHARS,
	MAX_SUBSPACE_RULE_TEXT_CHARS,
	MAX_SUBSPACE_RULE_TITLE_CHARS,
	MAX_SUBSPACE_RULES,
	SUBSPACE_ACCESS_MODES,
	SUBSPACE_FEED_SORTS,
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
// Roles.
export const ROLE_RANK: Record<SubspaceRole, number> = { member: 0, moderator: 1, owner: 2 };
export const isModeratorRole = (role: SubspaceRole | null | undefined): boolean => role === 'owner' || role === 'moderator';

export const isFailValue = isFail;
