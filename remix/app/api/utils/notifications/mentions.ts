import { findUsersByUsernames } from '../auth/users';
import { emitNotification } from './notifications';
import type { NotificationActor } from './notifications';
import { extractMentionUsernames } from '~/utils/mentions';

// @mention notifications. Mentions are deliberately notification-only: no
// mention kind is ever stored — the notification IS the artifact, and the
// mention's source of truth stays the literal @username text on the post or
// comment (re-parsed by the renderer, exactly like inline #hashtags).
//
// Called from two funnels in things.ts (both through emitTextMentions there,
// which derives the required visibility gate):
//  - createThing's emitCreationNotifications — every creation path (dedicated
//    post/comment routes and generic POST alike) parses one grammar
//    (~/utils/mentions — shared with the composer and PostCard);
//  - updateThing's edit pass — a text-changing edit notifies only NEWLY added
//    usernames (`previousText` carries the pre-edit text; names already
//    present never re-ring).
// Bounded: at most MENTION_CAP unique usernames are honoured per text,
// resolved in ONE batched two-store lookup (findUsersByUsernames); unknown
// names simply don't resolve and emit nothing. Never throws — a mention
// hiccup must not fail the write that carried it (same contract as
// emitNotification itself).
//
// VISIBILITY: a mention notification carries a preview of the text (bell AND
// default-on email), so it must never reach someone who cannot view the doc
// itself — otherwise a mention inside a private or friends-only post would
// leak its content past the acl. `canRecipientView` is therefore REQUIRED:
// the caller derives it from the doc's effective acl (the inherit-chain
// terminal for comments) using the exact same evaluation reads use, so
// specific-user grants still notify and exclusions still deny. Recipients
// failing the gate are skipped entirely — no stripped-down ping either: that
// a private text mentions someone is itself private.

export type EmitMentionInput = {
	// the doc's body text (unknown-shaped crystal field — non-strings no-op)
	text: unknown;
	// edit pass only: the pre-edit text — usernames already mentioned there are
	// skipped so an edit notifies just the mentions it ADDED
	previousText?: unknown;
	actor: NotificationActor;
	// shareId of the mentioning thing (the bell row's subject)
	targetId: string;
	// post for click-through (the parent post for comments, the doc itself for posts)
	postId: string;
	// recipients already covered by a more specific notification for this same
	// doc (the comment/reply/share target owner) — mentioning them again would
	// double-ring the bell for one event
	excludeIds?: readonly string[];
	// per-recipient visibility gate (see module header) — only recipients this
	// returns true for are notified
	canRecipientView: (recipient: { id: string; username: string }) => boolean;
};

// Returns the recipient ids actually notified so the caller can also exclude
// them from the post fan-out (each person gets exactly one notification per
// event — the most specific one).
export const emitMentionNotifications = async (input: EmitMentionInput): Promise<Set<string>> => {
	const notified = new Set<string>();
	try {
		const text = typeof input.text === 'string' ? input.text : '';
		const previous = typeof input.previousText === 'string' ? new Set(extractMentionUsernames(input.previousText)) : null;
		const usernames = extractMentionUsernames(text).filter((username) => !previous?.has(username));
		if (!usernames.length) return notified;
		const exclude = new Set<string>([input.actor.id, ...(input.excludeIds || [])]);
		const users = await findUsersByUsernames(usernames);
		for (const user of users) {
			const recipientId = user?._id ? String(user._id) : '';
			const username = typeof user?.username === 'string' ? user.username : '';
			if (!recipientId || exclude.has(recipientId) || notified.has(recipientId)) continue;
			if (!input.canRecipientView({ id: recipientId, username })) continue;
			notified.add(recipientId);
			// sequential emit: bounded at MENTION_CAP and each call is one indexed
			// pref read + insert; emitNotification never throws
			await emitNotification({
				recipientId,
				type: 'mention',
				actor: input.actor,
				targetId: input.targetId,
				postId: input.postId,
				preview: text
			});
		}
	} catch (err: any) {
		console.error('[notifications] mention emit failed:', err?.message || err);
	}
	return notified;
};
