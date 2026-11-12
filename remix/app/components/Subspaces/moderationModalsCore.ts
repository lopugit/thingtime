// Pure helpers behind the RemoveModal (components/Subspaces/ModerationModals
// .tsx) — the pick grammar, the note bound and the request the modal hands
// the card. No React / Chakra imports so they unit-test in isolation
// (moderationModalsCore.test.ts) and mirror the server's composition in
// api/utils/subspaces/subspaceCore.ts resolveRemovalReason exactly.
import { MAX_SUBSPACE_MOD_REASON_CHARS, MAX_SUBSPACE_POST_REMOVAL_REASON_CHARS } from '~/schemas/registry';
import type { SubspaceRemovalReason, SubspaceRule } from './subspaceTypes';

// the pick's radio value: a rule ("rule:<index>"), a removal reason
// ("reason:<id>") or custom text
export const CUSTOM_PICK = 'custom';
export const ruleValue = (index: number) => `rule:${index}`;
export const reasonValue = (id: string) => `reason:${id}`;

export type RemoveDetail = { rules: SubspaceRule[]; removalReasons: SubspaceRemovalReason[] };

export type RemoveChoice = {
	// free text sent as `reason`: the custom reason, or the note beside a
	// canned reason / a cited rule; null when nothing was written
	reason: string | null;
	// a removal reason's id (its title — message become the stored reason)
	reasonId: string | null;
	// a cited rule's 0-based index (the server composes "Rule N: title — text
	// · note" and bounds it — the client never guesses the stored text)
	ruleIndex: number | null;
	// what the card should paint while the request is in flight — composed
	// exactly like the server does, so the optimistic paint IS the stored text
	previewReason: string | null;
	// the short form the "Also ban" follow-up sends as the ban reason (a
	// canned reason's title / the rule citation / the custom text) — never
	// the full composed removal text, which the ban row would slice at 300
	banReason: string | null;
	lock: boolean;
	ban: boolean;
	banDays: number | null;
};

// the head the server prepends for a pick ("title — message" / "Rule N:
// title — text") and its short citation; null means the pick is custom, or
// names a reason / rule the loaded detail does not list (not loaded yet, or
// edited meanwhile) — the note alone is sent then
export const pickHead = (pick: string, detail: RemoveDetail | null): { head: string; citation: string } | null => {
	if (pick.startsWith('reason:')) {
		const canned = detail?.removalReasons.find((reason) => reason.id === pick.slice('reason:'.length)) || null;
		return canned ? { head: canned.message ? `${canned.title} — ${canned.message}` : canned.title, citation: canned.title } : null;
	}
	if (pick.startsWith('rule:')) {
		const index = Number(pick.slice('rule:'.length));
		const rule = Number.isInteger(index) && index >= 0 ? detail?.rules[index] || null : null;
		if (!rule) return null;
		const citation = `Rule ${index + 1}: ${rule.title}`;
		return { head: rule.text ? `${citation} — ${rule.text}` : citation, citation };
	}
	return null;
};

// how long the note may be for this pick: the free-text bound on its own,
// and beside a canned reason / rule whatever the composed cap ("head · note")
// leaves — so nothing the mod types is silently sliced off server-side
export const noteMaxFor = (pick: string, detail: RemoveDetail | null): number => {
	const head = pickHead(pick, detail);
	if (!head) return MAX_SUBSPACE_MOD_REASON_CHARS;
	return Math.max(0, Math.min(MAX_SUBSPACE_MOD_REASON_CHARS, MAX_SUBSPACE_POST_REMOVAL_REASON_CHARS - head.head.length - ' · '.length));
};

export const buildRemoveChoice = (pick: string, note: string, detail: RemoveDetail | null, extras: { lock: boolean; ban: boolean; banDays: string }): RemoveChoice => {
	const trimmedNote = note.replace(/\s+/g, ' ').trim().slice(0, noteMaxFor(pick, detail));
	const days = Number(extras.banDays);
	const banDays = extras.ban && Number.isFinite(days) && days > 0 ? Math.floor(days) : null;
	const base = { lock: extras.lock, ban: extras.ban, banDays };
	const head = pickHead(pick, detail);
	const composed = [head?.head, trimmedNote].filter(Boolean).join(' · ') || null;
	const noteOnly = { reason: trimmedNote || null, reasonId: null, ruleIndex: null, previewReason: trimmedNote || null, banReason: trimmedNote || null, ...base };
	if (pick.startsWith('reason:')) {
		// the server resolves the id (400 when it is gone) — the preview and
		// the ban reason use the loaded copy when there is one
		return { ...noteOnly, reasonId: pick.slice('reason:'.length), previewReason: composed, banReason: head?.citation || trimmedNote || null };
	}
	if (pick.startsWith('rule:')) {
		// a rule the detail no longer lists (edited meanwhile) falls back to
		// the note alone rather than citing the wrong rule
		if (!head) return noteOnly;
		return { ...noteOnly, ruleIndex: Number(pick.slice('rule:'.length)), previewReason: composed, banReason: head.citation };
	}
	return noteOnly;
};
