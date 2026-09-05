import React from 'react';
import {
	Box,
	Button,
	Checkbox,
	Flex,
	Input,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalOverlay,
	Radio,
	RadioGroup,
	Text,
	Textarea
} from '@chakra-ui/react';

import { MAX_SUBSPACE_REPORT_NOTE_CHARS } from '~/schemas/registry';
import type { useApi } from '~/hooks/useApi';
import { buildRemoveChoice, CUSTOM_PICK, noteMaxFor, reasonValue, ruleValue, type RemoveChoice } from './moderationModalsCore';
import { REPORT_OTHER_REASON, type SubspaceFlair, type SubspaceRemovalReason, type SubspaceRule } from './subspaceTypes';

// Moderation modals — Chakra modals replacing every window.prompt/confirm in
// the subspace UI (round 2, S4):
//   • RemoveModal — the card menu's Remove 🧹: a radio list of the subspace's
//     rules + removal reasons + "Custom", a free-text note, "Also lock
//     comments" and "Also ban the author (days)". The caller sequences
//     moderate(remove) [+ lock] [+ members ban].
//   • BanModal — the mod page's Ban 🚫 (per member row and by username):
//     reason (shown to the user), days (blank = permanent), a private note
//     (mod log only).
//   • ReportModal — the card menu's / comment row's Report to moderators 🚩
//     (round 2, S5): a radio list of the subspace's rules + "Other", a note
//     for the mods. The caller files POST /api/v1/subspaces/report.
// The subspace detail the RemoveModal needs (rules, removal reasons — and the
// post flairs the card menu's Flair submenu lists) is loaded lazily through
// ONE cached loader, so opening the menu and then the modal costs one GET.

const INK = 'var(--tt-ink, #16161a)';
const TEXT = 'var(--tt-text, #5a5a66)';
const MUTED = 'var(--tt-muted, #9a9aa6)';
const BORDER = '1px solid var(--tt-border, #ececef)';
const RADIUS_MD = 'var(--tt-radius-md, 12px)';
const RADIUS_LG = 'var(--tt-radius-lg, 16px)';
const DANGER = 'var(--tt-danger, #e5484d)';
// Chakra's radio / checkbox controls inherit their border colour, which
// resolves to the card's white here (an unchecked control vanished on the
// card) — pin a visible one; the checked state keeps the colour scheme.
// Radio forwards style props to the control span itself (so borderColor
// lands on it directly); Checkbox forwards them to the root label, whose
// control inherits — hence the descendant rule there.
const CONTROL_BORDER = 'var(--tt-muted, #9a9aa6)';
const CONTROL_SX = { '.chakra-checkbox__control': { borderColor: CONTROL_BORDER } } as const;

// ── shared lazy subspace loader ────────────────────────────────────────────
export type ModerationSubspace = { id: string; slug: string; flairs: SubspaceFlair[]; rules: SubspaceRule[]; removalReasons: SubspaceRemovalReason[] };
type ApiClient = ReturnType<typeof useApi>;
// per-subspace cache with a short TTL: the card menu (Flair submenu) and the
// Remove modal share one GET; a mod who just edited the rules on the mod
// page sees them here within a minute (or on the next page load)
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; promise: Promise<ModerationSubspace> }>();

const asModerationSubspace = (subspace: any): ModerationSubspace => ({
	id: String(subspace?.id || ''),
	slug: String(subspace?.slug || ''),
	flairs: ((subspace?.flairs || []) as any[]).map((flair) => ({ id: flair.id, label: flair.label, emoji: flair.emoji ?? null, color: flair.color ?? null, modOnly: flair.modOnly === true })),
	rules: ((subspace?.rules || []) as any[]).filter((rule) => rule && typeof rule.title === 'string').map((rule) => ({ title: rule.title, text: rule.text ?? null })),
	removalReasons: ((subspace?.removalReasons || []) as any[])
		.filter((reason) => reason && typeof reason.id === 'string' && typeof reason.title === 'string')
		.map((reason) => ({ id: reason.id, title: reason.title, message: typeof reason.message === 'string' ? reason.message : '' }))
});

export const loadModerationSubspace = (api: ApiClient, subspaceId: string): Promise<ModerationSubspace> => {
	const hit = cache.get(subspaceId);
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise;
	const promise = api.v1.subspaces
		.get({ id: subspaceId })
		.then((resp: any) => asModerationSubspace(resp?.subspace))
		.catch((err: unknown) => {
			// a failed load is not cached — the next open retries
			if (cache.get(subspaceId)?.promise === promise) cache.delete(subspaceId);
			throw err;
		});
	cache.set(subspaceId, { at: Date.now(), promise });
	return promise;
};
// the mod page edits rules / reasons / flairs — drop the copy so the next
// menu or modal open reads the fresh ones
export const forgetModerationSubspace = (subspaceId: string) => {
	cache.delete(subspaceId);
};

// ── RemoveModal ────────────────────────────────────────────────────────────
// the pick grammar, the note bound and the request shape live in
// moderationModalsCore.ts (pure, unit-tested); re-exported for the card
export { buildRemoveChoice, noteMaxFor, type RemoveChoice } from './moderationModalsCore';
const CUSTOM = CUSTOM_PICK;

export const RemoveModal = ({
	isOpen,
	onClose,
	api,
	subspaceId,
	subspaceSlug,
	authorName,
	canBanAuthor,
	alreadyLocked,
	onRemove
}: {
	isOpen: boolean;
	onClose: () => void;
	api: ApiClient;
	subspaceId: string;
	subspaceSlug: string;
	authorName: string | null;
	// false for your own post (you can't ban yourself) or when the author is
	// unknown; the API refuses banning moderators anyway (toast says why)
	canBanAuthor: boolean;
	alreadyLocked: boolean;
	// resolves once the sequence is done (the caller toasts + reconciles);
	// rejects when the REMOVE itself was refused so the form stays open
	onRemove: (choice: RemoveChoice) => Promise<void>;
}) => {
	const [detail, setDetail] = React.useState<ModerationSubspace | null>(null);
	const [loadFailed, setLoadFailed] = React.useState(false);
	const [pick, setPick] = React.useState<string>(CUSTOM);
	const [note, setNote] = React.useState('');
	const [lock, setLock] = React.useState(false);
	const [ban, setBan] = React.useState(false);
	const [banDays, setBanDays] = React.useState('');
	const [saving, setSaving] = React.useState(false);
	// whether the mod has touched the reason (picked a radio or typed) — the
	// lazy load's default pick must never flip the radio under someone who
	// already chose Custom or started writing (a cold load lands 100–500 ms
	// after the modal opens, well within typing time)
	const touchedRef = React.useRef(false);

	// lazy: the subspace's rules + reasons load when the modal opens (cached
	// across the card menu's flair list and re-opens); the form paints at once
	// with Custom selected — a cold load only fills the list in
	React.useEffect(() => {
		if (!isOpen) return;
		let cancelled = false;
		setLoadFailed(false);
		loadModerationSubspace(api, subspaceId)
			.then((loaded) => {
				if (cancelled) return;
				setDetail(loaded);
				// default to the first removal reason when there is one — the
				// most common removal is a canned one — but only while the form
				// is untouched
				setPick((current) => (!touchedRef.current && current === CUSTOM && loaded.removalReasons.length ? reasonValue(loaded.removalReasons[0].id) : current));
			})
			.catch(() => {
				if (!cancelled) setLoadFailed(true);
			});
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isOpen, subspaceId]);

	const reset = () => {
		setPick(CUSTOM);
		setNote('');
		setLock(false);
		setBan(false);
		setBanDays('');
		touchedRef.current = false;
	};
	// the note's bound follows the pick: beside a canned reason / a rule only
	// what the composed cap leaves is allowed, so what the mod sees in the
	// preview is exactly what gets stored (a longer note written under Custom
	// is trimmed to fit when the pick changes)
	const noteMax = noteMaxFor(pick, detail);
	const choosePick = (value: string) => {
		touchedRef.current = true;
		setPick(value);
		const nextMax = noteMaxFor(value, detail);
		setNote((current) => (current.length > nextMax ? current.slice(0, nextMax) : current));
	};
	const close = () => {
		if (saving) return;
		onClose();
		reset();
	};
	const submit = async () => {
		if (saving) return;
		setSaving(true);
		try {
			await onRemove(buildRemoveChoice(pick, note, detail, { lock, ban: canBanAuthor && ban, banDays }));
			onClose();
			reset();
		} catch {
			// the remove was refused — the caller reverted + toasted; keep the
			// form so the mod can adjust and retry
		} finally {
			setSaving(false);
		}
	};
	const custom = pick === CUSTOM;
	const rules = detail?.rules || [];
	const reasons = detail?.removalReasons || [];

	return (
		<Modal isOpen={isOpen} onClose={close} isCentered size="md" scrollBehavior="inside">
			<ModalOverlay />
			<ModalContent borderRadius={RADIUS_LG} background="var(--tt-card, #ffffff)" marginX={4} data-testid="remove-modal">
				<ModalHeader fontFamily="heading" fontSize="lg" color={INK} paddingBottom={1}>
					Remove from s/{subspaceSlug} 🧹
				</ModalHeader>
				<ModalCloseButton isDisabled={saving} />
				<ModalBody>
					<Flex flexDirection="column" rowGap={3}>
						<Text fontSize="xs" color={MUTED}>
							The author sees the reason on their post and in their bell; it lands in the mod log too.
						</Text>
						<RadioGroup value={pick} onChange={(value) => choosePick(String(value))}>
							<Flex flexDirection="column" rowGap={1.5} data-testid="remove-reason-list">
								{reasons.map((reason) => (
									<Radio borderColor={CONTROL_BORDER} key={reason.id} value={reasonValue(reason.id)} size="sm" alignItems="flex-start" data-testid="remove-reason-option" data-reason-id={reason.id}>
										<Box>
											<Text fontSize="sm" color={INK} fontWeight={600} lineHeight="1.3">
												{reason.title}
											</Text>
											{reason.message && (
												<Text fontSize="xs" color={TEXT} whiteSpace="normal">
													{reason.message}
												</Text>
											)}
										</Box>
									</Radio>
								))}
								{rules.map((rule, index) => (
									<Radio borderColor={CONTROL_BORDER} key={ruleValue(index)} value={ruleValue(index)} size="sm" alignItems="flex-start" data-testid="remove-rule-option">
										<Text fontSize="sm" color={INK} lineHeight="1.3">
											<Text as="span" color={MUTED} fontFamily="mono" fontSize="xs">
												Rule {index + 1}
											</Text>{' '}
											{rule.title}
										</Text>
									</Radio>
								))}
								<Radio borderColor={CONTROL_BORDER} value={CUSTOM} size="sm" data-testid="remove-custom-option">
									<Text fontSize="sm" color={INK}>
										Custom{rules.length + reasons.length ? '' : ' reason'}
									</Text>
								</Radio>
								{!detail && !loadFailed && (
									<Text fontSize="xs" color={MUTED}>
										Loading the rules…
									</Text>
								)}
								{detail && rules.length + reasons.length === 0 && (
									<Text fontSize="xs" color={MUTED}>
										No rules or removal reasons yet — add some on the mod page’s Rules tab.
									</Text>
								)}
								{loadFailed && (
									<Text fontSize="xs" color={DANGER}>
										Couldn’t load the rules — write a reason below.
									</Text>
								)}
							</Flex>
						</RadioGroup>
						<Box>
							<Textarea
								size="sm"
								borderRadius={RADIUS_MD}
								rows={2}
								placeholder={custom ? 'Reason (shown to the author) — optional' : 'Add a note for the author — optional'}
								value={note}
								maxLength={noteMax}
								onChange={(event) => {
									touchedRef.current = true;
									setNote(event.target.value.slice(0, noteMax));
								}}
								data-testid="remove-note"
							/>
							<Text fontSize="10px" fontFamily="mono" color={MUTED} textAlign="right" marginTop={0.5} data-testid="remove-note-count">
								{note.length}/{noteMax}
							</Text>
						</Box>
						<Flex flexDirection="column" rowGap={2} paddingTop={1} borderTop={BORDER}>
							<Checkbox sx={CONTROL_SX} size="sm" isChecked={lock || alreadyLocked} isDisabled={alreadyLocked} onChange={(event) => setLock(event.target.checked)} data-testid="remove-also-lock">
								<Text fontSize="sm" color={INK}>
									Also lock comments 🔒{alreadyLocked ? ' (already locked)' : ''}
								</Text>
							</Checkbox>
							{canBanAuthor && (
								<Flex alignItems="center" columnGap={2} flexWrap="wrap" rowGap={1}>
									<Checkbox sx={CONTROL_SX} size="sm" isChecked={ban} onChange={(event) => setBan(event.target.checked)} data-testid="remove-also-ban">
										<Text fontSize="sm" color={INK}>
											Also ban {authorName ? `@${authorName}` : 'the author'} 🚫
										</Text>
									</Checkbox>
									{ban && (
										<Flex alignItems="center" columnGap={1.5}>
											<Input size="xs" width="64px" type="number" min={1} max={3650} borderRadius={RADIUS_MD} placeholder="∞" value={banDays} onChange={(event) => setBanDays(event.target.value)} data-testid="remove-ban-days" />
											<Text fontSize="xs" color={MUTED}>
												days (blank = permanent)
											</Text>
										</Flex>
									)}
								</Flex>
							)}
						</Flex>
					</Flex>
				</ModalBody>
				<ModalFooter columnGap={2}>
					<Button size="sm" variant="ghost" borderRadius={RADIUS_MD} onClick={close} isDisabled={saving}>
						Keep it
					</Button>
					<Button size="sm" colorScheme="red" borderRadius={RADIUS_MD} isLoading={saving} onClick={submit} data-testid="remove-confirm">
						Remove 🧹{lock && !alreadyLocked ? ' + lock' : ''}{canBanAuthor && ban ? ' + ban' : ''}
					</Button>
				</ModalFooter>
			</ModalContent>
		</Modal>
	);
};

// ── BanModal ───────────────────────────────────────────────────────────────
export type BanInput = { reason: string; banDays: number | null; note: string };

export const BanModal = ({
	isOpen,
	onClose,
	targetName,
	subspaceSlug,
	onBan
}: {
	isOpen: boolean;
	onClose: () => void;
	// who is being banned — a display name / username (the modal is generic)
	targetName: string;
	subspaceSlug: string;
	// resolves once the API accepted the ban; rejects when it refused (the
	// caller reverted + toasted) so the form stays open
	onBan: (input: BanInput) => Promise<void>;
}) => {
	const [reason, setReason] = React.useState('');
	const [days, setDays] = React.useState('');
	const [note, setNote] = React.useState('');
	const [saving, setSaving] = React.useState(false);
	const reset = () => {
		setReason('');
		setDays('');
		setNote('');
	};
	const close = () => {
		if (saving) return;
		onClose();
		reset();
	};
	const parsedDays = Number(days);
	const banDays = Number.isFinite(parsedDays) && parsedDays > 0 ? Math.floor(parsedDays) : null;
	const submit = async () => {
		if (saving) return;
		setSaving(true);
		try {
			await onBan({ reason: reason.replace(/\s+/g, ' ').trim(), banDays, note: note.replace(/\s+/g, ' ').trim() });
			onClose();
			reset();
		} catch {
			// refused — the caller reverted + toasted; keep the form
		} finally {
			setSaving(false);
		}
	};
	return (
		<Modal isOpen={isOpen} onClose={close} isCentered size="md">
			<ModalOverlay />
			<ModalContent borderRadius={RADIUS_LG} background="var(--tt-card, #ffffff)" marginX={4} data-testid="ban-modal">
				<ModalHeader fontFamily="heading" fontSize="lg" color={INK} paddingBottom={1}>
					Ban {targetName} from s/{subspaceSlug}? 🚫
				</ModalHeader>
				<ModalCloseButton isDisabled={saving} />
				<ModalBody>
					<Flex flexDirection="column" rowGap={3}>
						<Box>
							<Text fontFamily="mono" fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color={MUTED}>
								Reason · shown to them
							</Text>
							<Input
								size="sm"
								borderRadius={RADIUS_MD}
								placeholder="e.g. Rule 2 — repeated spam"
								value={reason}
								maxLength={300}
								autoFocus
								onChange={(event) => setReason(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === 'Enter') submit();
								}}
								data-testid="ban-reason"
							/>
						</Box>
						<Box>
							<Text fontFamily="mono" fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color={MUTED}>
								Length
							</Text>
							<Flex alignItems="center" columnGap={2}>
								<Input size="sm" width="88px" type="number" min={1} max={3650} borderRadius={RADIUS_MD} placeholder="∞" value={days} onChange={(event) => setDays(event.target.value)} data-testid="ban-days" />
								<Text fontSize="xs" color={MUTED}>
									{banDays ? `${banDays} day${banDays === 1 ? '' : 's'}` : 'days — blank = permanent'}
								</Text>
							</Flex>
						</Box>
						<Box>
							<Text fontFamily="mono" fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color={MUTED}>
								Mod note · private, mod log only
							</Text>
							<Textarea size="sm" borderRadius={RADIUS_MD} rows={2} placeholder="Context for the other mods — never shown to them" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} data-testid="ban-note" />
						</Box>
						<Text fontSize="xs" color={MUTED}>
							A banned user can’t post, comment, vote or (re)join here; the ban outlives leaving. They get a bell notification with the reason.
						</Text>
					</Flex>
				</ModalBody>
				<ModalFooter columnGap={2}>
					<Button size="sm" variant="ghost" borderRadius={RADIUS_MD} onClick={close} isDisabled={saving}>
						Cancel
					</Button>
					<Button size="sm" colorScheme="red" borderRadius={RADIUS_MD} isLoading={saving} onClick={submit} data-testid="ban-confirm">
						Ban {banDays ? `for ${banDays}d` : 'permanently'} 🚫
					</Button>
				</ModalFooter>
			</ModalContent>
		</Modal>
	);
};

// ── ReportModal ────────────────────────────────────────────────────────────
// A viewer flags a post / comment to the subspace's moderators: pick the rule
// it breaks (the citation "Rule N: title" becomes the reason the queue groups
// by) or "Other", add a note. Optimistic by contract: `onReport` is fired
// and the modal closes at once — the caller toasts "Reported" immediately
// and toasts the error if the API refuses (nothing on the card changes
// either way, so there is nothing to revert).
export type ReportChoice = { reason: string; note: string | null };
const OTHER_PICK = 'other';

export const ReportModal = ({
	isOpen,
	onClose,
	api,
	subspaceId,
	subspaceSlug,
	target,
	onReport
}: {
	isOpen: boolean;
	onClose: () => void;
	api: ApiClient;
	subspaceId: string;
	subspaceSlug: string;
	// what is being reported — copy only
	target: 'post' | 'comment';
	onReport: (choice: ReportChoice) => void;
}) => {
	const [detail, setDetail] = React.useState<ModerationSubspace | null>(null);
	const [loadFailed, setLoadFailed] = React.useState(false);
	const [pick, setPick] = React.useState<string>(OTHER_PICK);
	const [note, setNote] = React.useState('');
	const touchedRef = React.useRef(false);

	// lazy: the rules load when the modal opens (the same cached GET the
	// card menu and the Remove modal share); the form paints at once with
	// Other selected, and the first rule takes over only while untouched
	React.useEffect(() => {
		if (!isOpen) return;
		let cancelled = false;
		setLoadFailed(false);
		loadModerationSubspace(api, subspaceId)
			.then((loaded) => {
				if (cancelled) return;
				setDetail(loaded);
				setPick((current) => (!touchedRef.current && current === OTHER_PICK && loaded.rules.length ? ruleValue(0) : current));
			})
			.catch(() => {
				if (!cancelled) setLoadFailed(true);
			});
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isOpen, subspaceId]);

	const reset = () => {
		setPick(OTHER_PICK);
		setNote('');
		touchedRef.current = false;
	};
	const close = () => {
		onClose();
		reset();
	};
	const rules = detail?.rules || [];
	const reasonOf = (): string => {
		if (pick.startsWith('rule:')) {
			const index = Number(pick.slice('rule:'.length));
			const rule = Number.isInteger(index) && index >= 0 ? rules[index] : null;
			if (rule) return `Rule ${index + 1}: ${rule.title}`;
		}
		return REPORT_OTHER_REASON;
	};
	const submit = () => {
		const choice: ReportChoice = { reason: reasonOf(), note: note.replace(/\s+/g, ' ').trim() || null };
		onClose();
		reset();
		onReport(choice);
	};
	const other = pick === OTHER_PICK;

	return (
		<Modal isOpen={isOpen} onClose={close} isCentered size="md" scrollBehavior="inside">
			<ModalOverlay />
			<ModalContent borderRadius={RADIUS_LG} background="var(--tt-card, #ffffff)" marginX={4} data-testid="report-modal">
				<ModalHeader fontFamily="heading" fontSize="lg" color={INK} paddingBottom={1}>
					Report this {target} to the s/{subspaceSlug} mods 🚩
				</ModalHeader>
				<ModalCloseButton />
				<ModalBody>
					<Flex flexDirection="column" rowGap={3}>
						<Text fontSize="xs" color={MUTED}>
							Only the moderators see reports. Pick the rule it breaks, or tell them what is wrong.
						</Text>
						<RadioGroup
							value={pick}
							onChange={(value) => {
								touchedRef.current = true;
								setPick(String(value));
							}}
						>
							<Flex flexDirection="column" rowGap={1.5} data-testid="report-reason-list">
								{rules.map((rule, index) => (
									<Radio borderColor={CONTROL_BORDER} key={ruleValue(index)} value={ruleValue(index)} size="sm" alignItems="flex-start" data-testid="report-rule-option">
										<Text fontSize="sm" color={INK} lineHeight="1.3">
											<Text as="span" color={MUTED} fontFamily="mono" fontSize="xs">
												Rule {index + 1}
											</Text>{' '}
											{rule.title}
										</Text>
									</Radio>
								))}
								<Radio borderColor={CONTROL_BORDER} value={OTHER_PICK} size="sm" data-testid="report-other-option">
									<Text fontSize="sm" color={INK}>
										{rules.length ? 'Other' : 'Something else is wrong'}
									</Text>
								</Radio>
								{!detail && !loadFailed && (
									<Text fontSize="xs" color={MUTED}>
										Loading the rules…
									</Text>
								)}
								{loadFailed && (
									<Text fontSize="xs" color={DANGER}>
										Couldn’t load the rules — describe the problem below.
									</Text>
								)}
							</Flex>
						</RadioGroup>
						<Box>
							<Textarea
								size="sm"
								borderRadius={RADIUS_MD}
								rows={2}
								placeholder={other ? 'What is wrong with it? — helps the mods' : 'Anything the mods should know — optional'}
								value={note}
								maxLength={MAX_SUBSPACE_REPORT_NOTE_CHARS}
								onChange={(event) => {
									touchedRef.current = true;
									setNote(event.target.value.slice(0, MAX_SUBSPACE_REPORT_NOTE_CHARS));
								}}
								data-testid="report-note"
							/>
							<Text fontSize="10px" fontFamily="mono" color={MUTED} textAlign="right" marginTop={0.5}>
								{note.length}/{MAX_SUBSPACE_REPORT_NOTE_CHARS}
							</Text>
						</Box>
					</Flex>
				</ModalBody>
				<ModalFooter columnGap={2}>
					<Button size="sm" variant="ghost" borderRadius={RADIUS_MD} onClick={close}>
						Never mind
					</Button>
					<Button size="sm" colorScheme="red" borderRadius={RADIUS_MD} onClick={submit} data-testid="report-confirm">
						Report 🚩
					</Button>
				</ModalFooter>
			</ModalContent>
		</Modal>
	);
};
