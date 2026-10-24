// Attachment moderation core. Verdicts stamp a PROTECTED root field
// (`moderation`) on the attachment thing — root fields never pass through
// generic Thing input (see attachmentCore.ts AttachmentPrivateObjectFields),
// so only the server-side moderation pipeline and admin review can write
// them. Public projections expose at most a boolean `nsfw`; `blocked`
// attachments disappear from public payloads entirely and the content route
// refuses to serve them.

export const MODERATION_STATUSES = ['pending', 'skipped', 'clear', 'nsfw', 'blocked'] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

// The analysis provider's raw answer, before it becomes a stored stamp.
export type ModerationVerdict = {
	// true when the image contains adult/sexual/graphic content that stays
	// visible but blurred behind a consent click
	nsfw: boolean;
	// true when the image violates the TOS or the law — the attachment is
	// quarantined (never publicly served) and flagged for admin review
	tosViolation: boolean;
	categories: string[];
	// short machine-written justification; admin-only, never projected
	reason?: string;
};

// The stored stamp on the attachment thing root.
export type AttachmentModeration = {
	status: ModerationStatus;
	categories?: string[];
	provider?: string;
	model?: string;
	analyzedAt?: Date;
	// admin-only; never leaves admin surfaces
	reason?: string;
	// text pipeline only: hash of the exact text this verdict describes —
	// fences stale stamps and lets a block stay sticky across provider
	// flip-flops until the text actually changes
	textHash?: string;
	// text pipeline only: the admin moderationFlag for this verdict has not
	// landed yet; the hourly sweep drains docs still carrying this marker
	flagPending?: boolean;
};

export const MODERATION_CATEGORY_MAX = 12;
export const MODERATION_CATEGORY_CHARS = 48;
export const MODERATION_REASON_CHARS = 500;

// Bound provider output before it becomes a stored stamp — a hallucinated
// 10k-item category list must not bloat the attachment doc or the admin UI.
export const sanitizeModerationCategories = (value: unknown): string[] =>
	Array.isArray(value)
		? value
				.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim())
				.map((entry) => entry.trim().toLowerCase().slice(0, MODERATION_CATEGORY_CHARS))
				.slice(0, MODERATION_CATEGORY_MAX)
		: [];

export const moderationFromVerdict = (
	verdict: ModerationVerdict,
	context: { provider: string; model?: string; now?: Date }
): AttachmentModeration => ({
	// tosViolation outranks nsfw: a blocked attachment is never served, so the
	// blur treatment is moot
	status: verdict.tosViolation ? 'blocked' : verdict.nsfw ? 'nsfw' : 'clear',
	categories: sanitizeModerationCategories(verdict.categories),
	provider: context.provider,
	...(context.model ? { model: context.model } : {}),
	analyzedAt: context.now ?? new Date(),
	...(verdict.reason ? { reason: String(verdict.reason).slice(0, MODERATION_REASON_CHARS) } : {})
});

export const isModerationStatus = (value: unknown): value is ModerationStatus =>
	typeof value === 'string' && (MODERATION_STATUSES as readonly string[]).includes(value);

// Read the stamp off a raw doc without trusting its shape.
export const attachmentModerationStatus = (doc: { moderation?: unknown } | null | undefined): ModerationStatus | null => {
	const status = (doc?.moderation as { status?: unknown } | undefined)?.status;
	return isModerationStatus(status) ? status : null;
};

export const attachmentIsBlocked = (doc: { moderation?: unknown } | null | undefined): boolean =>
	attachmentModerationStatus(doc) === 'blocked';

export const attachmentIsNsfw = (doc: { moderation?: unknown } | null | undefined): boolean =>
	attachmentModerationStatus(doc) === 'nsfw';
