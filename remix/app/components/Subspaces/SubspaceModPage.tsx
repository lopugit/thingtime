import React from 'react';
import {
	Box,
	Button,
	Flex,
	Input,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalOverlay,
	Select,
	Switch,
	Tab,
	TabList,
	TabPanel,
	TabPanels,
	Tabs,
	Text,
	Textarea
} from '@chakra-ui/react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { clearLocalCachePrefix } from '~/hooks/localCache';
import { useLopu } from '~/components/Lopu/useLopu';
import { SUBSPACE_SLUG_HOLD_DAYS } from '~/schemas/registry';
import { AuthorFlairChip } from '~/components/Feed/PostCard';
import { PostList } from '~/components/Feed/PostList';
import type { PostChange, PublicPost } from '~/components/Feed/feedTypes';
import { SubspaceIcon } from './SubspaceCard';
import {
	ACCESS_META,
	openRequestCount,
	type PublicModlogEntry,
	type PublicSubspace,
	type PublicSubspaceMember,
	type SubspaceAccess,
	type SubspaceDeleteResponse,
	type SubspaceFeedResponse,
	type SubspaceFlair,
	type SubspaceMemberResponse,
	type SubspaceRule,
	type SubspaceTransferResponse
} from './subspaceTypes';

// /s/:slug/mod — moderator tools: the queue (newest posts incl. removed ones,
// every card carrying its mod menu), requests (join requests to a private
// subspace + posting-approval requests in a restricted one: accept/deny),
// members (search + actions, incl. Set flair), the ban list, settings
// (identity/branding/access + the owner's Danger zone: transfer ownership /
// delete), rules, flairs (post flairs + user flairs), and the mod log.
// Every mutation goes through /api/v1/subspaces/* and re-projects in place.

const INK = 'var(--tt-ink, #16161a)';
const TEXT = 'var(--tt-text, #5a5a66)';
const MUTED = 'var(--tt-muted, #9a9aa6)';
const BORDER = '1px solid var(--tt-border, #ececef)';
const RADIUS_MD = 'var(--tt-radius-md, 12px)';
const RADIUS_LG = 'var(--tt-radius-lg, 16px)';

const TABS = ['queue', 'requests', 'members', 'banned', 'settings', 'rules', 'flairs', 'log'] as const;
type ModTab = (typeof TABS)[number];

const Label = ({ children }: { children: React.ReactNode }) => (
	<Text fontFamily="mono" fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color={MUTED}>
		{children}
	</Text>
);

const Card = ({ children }: { children: React.ReactNode }) => (
	<Flex flexDirection="column" rowGap={3} background="var(--tt-card, #ffffff)" border={BORDER} borderRadius={RADIUS_LG} padding={4}>
		{children}
	</Flex>
);

const memberName = (member: PublicSubspaceMember) => member.profile?.displayName || member.profile?.username || member.userId;

// ── Queue ──────────────────────────────────────────────────────────────────
const QueuePanel = ({ slug }: { slug: string }) => {
	const api = useApi();
	const lopu = useLopu();
	const [posts, setPosts] = React.useState<PublicPost[]>([]);
	const [nextCursor, setNextCursor] = React.useState<string | null>(null);
	const [loading, setLoading] = React.useState(true);
	const [onlyRemoved, setOnlyRemoved] = React.useState(false);
	const load = React.useCallback(
		async (cursor?: string | null) => {
			setLoading(true);
			try {
				const resp = (await api.v1.subspaces.feed({ slug, sort: 'new', includeRemoved: true, cursor: cursor || undefined, limit: 30 })) as SubspaceFeedResponse;
				setPosts((prev) => (cursor ? [...prev, ...resp.posts.filter((post) => !prev.some((existing) => existing.id === post.id))] : resp.posts));
				setNextCursor(resp.nextCursor ?? null);
			} catch (err: any) {
				lopu({ title: err?.error || 'Could not load the queue 😞', status: 'error' });
			} finally {
				setLoading(false);
			}
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[slug]
	);
	React.useEffect(() => {
		load();
	}, [load]);
	const handlePostChanged = React.useCallback((id: string, next: PostChange) => {
		setPosts((prev) =>
			prev.flatMap((post) => {
				if (post.id !== id) return [post];
				const resolved = typeof next === 'function' ? next(post) : next;
				return resolved ? [resolved] : [];
			})
		);
	}, []);
	const shown = onlyRemoved ? posts.filter((post) => post.subspaceMod?.removed) : posts;
	return (
		<Flex flexDirection="column" rowGap={3}>
			<Flex alignItems="center" columnGap={2}>
				<Text fontSize="sm" color={TEXT}>
					Newest first, removed posts included — use each card’s ··· menu to remove, approve, pin, lock or flair.
				</Text>
				<Flex as="label" marginLeft="auto" alignItems="center" columnGap={2} fontSize="xs" color={MUTED} cursor="pointer" flexShrink={0}>
					Removed only
					<Switch size="sm" isChecked={onlyRemoved} onChange={(event) => setOnlyRemoved(event.target.checked)} />
				</Flex>
			</Flex>
			<PostList posts={shown} loading={loading} hasMore={!!nextCursor} onLoadMore={() => nextCursor && load(nextCursor)} onPostChanged={handlePostChanged} emptyLabel="Queue is clear ✨" />
		</Flex>
	);
};

// ── Requests ───────────────────────────────────────────────────────────────
// Two queues from the same member rows: JOIN requests (pending: true — people
// asking into a private subspace; accept → member, deny → row dropped) and
// POSTING-APPROVAL requests (active members of a restricted subspace who
// asked; approve → approved poster, deny → flag cleared). Both paint the
// decision first (row leaves, badge count drops) and put it back on failure.
type RequestQueue = 'join' | 'approval';
const RequestRow = (props: { member: PublicSubspaceMember; queue: RequestQueue; busy: boolean; onDecide: (member: PublicSubspaceMember, decision: 'accept' | 'deny') => void }) => {
	const { member, queue, busy, onDecide } = props;
	return (
		<Flex alignItems="center" columnGap={2} rowGap={1} flexWrap="wrap" paddingY={2} borderBottom={BORDER} _last={{ borderBottom: 'none' }} data-request={member.userId} data-queue={queue}>
			<Box minWidth={0} flex="1">
				<Text as={Link} to={member.profile?.username ? `/profile/${member.profile.username}` : '#'} fontSize="sm" fontWeight={600} color={INK} _hover={{ textDecoration: 'underline' }}>
					{memberName(member)}
				</Text>
				<Text fontSize="xs" color={MUTED}>
					{queue === 'join' ? '🙋 wants to join' : '✋ wants to post'}
					{' · '}
					{queue === 'join' ? 'asked ' : 'member since '}
					{new Date(member.joinedAt).toLocaleDateString()}
				</Text>
			</Box>
			<Flex columnGap={1} flexWrap="wrap">
				<Button size="xs" borderRadius="999px" isDisabled={busy} onClick={() => onDecide(member, 'accept')} data-testid={queue === 'join' ? 'request-accept' : 'request-approve'}>
					{queue === 'join' ? 'Accept ✓' : 'Approve ✓'}
				</Button>
				<Button size="xs" borderRadius="999px" variant="outline" isDisabled={busy} onClick={() => onDecide(member, 'deny')} data-testid="request-deny">
					Deny
				</Button>
			</Flex>
		</Flex>
	);
};

const RequestsPanel = ({ subspace, onCounts }: { subspace: PublicSubspace; onCounts: (patch: { pendingCount?: number; approvalRequestCount?: number }) => void }) => {
	const api = useApi();
	const lopu = useLopu();
	const { slug } = subspace;
	const [joinRequests, setJoinRequests] = React.useState<PublicSubspaceMember[]>([]);
	const [approvalRequests, setApprovalRequests] = React.useState<PublicSubspaceMember[]>([]);
	const [cursors, setCursors] = React.useState<{ join: string | null; approval: string | null }>({ join: null, approval: null });
	const [loading, setLoading] = React.useState(true);
	const [busyId, setBusyId] = React.useState<string | null>(null);
	const onCountsRef = React.useRef(onCounts);
	onCountsRef.current = onCounts;

	const load = React.useCallback(
		async (queue?: RequestQueue, cursor?: string | null) => {
			setLoading(true);
			try {
				const wantJoin = !queue || queue === 'join';
				const wantApproval = !queue || queue === 'approval';
				const [joinResp, approvalResp]: any[] = await Promise.all([
					wantJoin ? api.v1.subspaces.members({ slug, pending: true, cursor: queue ? cursor || undefined : undefined, limit: 50 }) : null,
					wantApproval ? api.v1.subspaces.members({ slug, approvalRequests: true, cursor: queue ? cursor || undefined : undefined, limit: 50 }) : null
				]);
				if (joinResp) {
					setJoinRequests((prev) => (cursor ? [...prev, ...joinResp.members.filter((entry: PublicSubspaceMember) => !prev.some((known) => known.userId === entry.userId))] : joinResp.members));
					setCursors((prev) => ({ ...prev, join: joinResp.nextCursor ?? null }));
				}
				if (approvalResp) {
					setApprovalRequests((prev) => (cursor ? [...prev, ...approvalResp.members.filter((entry: PublicSubspaceMember) => !prev.some((known) => known.userId === entry.userId))] : approvalResp.members));
					setCursors((prev) => ({ ...prev, approval: approvalResp.nextCursor ?? null }));
				}
				// a fresh first page is the truth for the badges (no more pages → exact)
				if (!cursor && !queue) {
					onCountsRef.current({
						...(joinResp && !joinResp.nextCursor ? { pendingCount: joinResp.members.length } : {}),
						...(approvalResp && !approvalResp.nextCursor ? { approvalRequestCount: approvalResp.members.length } : {})
					});
				}
			} catch (err: any) {
				lopu({ title: err?.error || 'Could not load the requests 😞', status: 'error' });
			} finally {
				setLoading(false);
			}
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[slug]
	);
	React.useEffect(() => {
		load();
	}, [load]);

	const decide = async (queue: RequestQueue, member: PublicSubspaceMember, decision: 'accept' | 'deny') => {
		if (busyId) return;
		setBusyId(member.userId);
		const setList = queue === 'join' ? setJoinRequests : setApprovalRequests;
		const countKey = queue === 'join' ? 'pendingCount' : 'approvalRequestCount';
		const countBefore = subspace[countKey] || 0;
		// optimistic: the row leaves and the badge drops now
		setList((prev) => prev.filter((entry) => entry.userId !== member.userId));
		onCounts({ [countKey]: Math.max(0, countBefore - 1) });
		try {
			const action = decision === 'deny' ? 'deny' : queue === 'join' ? 'accept' : 'approve';
			const resp = (await api.v1.subspaces.mutateMember({ slug, userId: member.userId, action })) as SubspaceMemberResponse;
			const name = memberName(resp.member || member);
			lopu({
				title:
					decision === 'deny'
						? queue === 'join'
							? `Denied ${name}’s request to join`
							: `Denied ${name}’s posting request`
						: queue === 'join'
							? `${name} is in — welcome them 🎉`
							: `${name} can post now ✅`,
				status: 'success',
				duration: 4000
			});
		} catch (err: any) {
			if (err?.status === 409) {
				// the requester withdrew (or re-filed) while the row sat in the
				// queue — the server refused to decide a request that is gone;
				// the optimistic removal was right, the queue just needs a fresh read
				lopu({ title: err?.error || 'That request was withdrawn — refreshing the queue', status: 'info', duration: 4000 });
				load(queue);
				return;
			}
			// put the row (and the count) back exactly where it was
			setList((prev) => (prev.some((entry) => entry.userId === member.userId) ? prev : [member, ...prev]));
			onCounts({ [countKey]: countBefore });
			lopu({ title: err?.error || 'Could not decide that request 😞', status: 'error' });
		} finally {
			setBusyId(null);
		}
	};

	const empty = !loading && joinRequests.length === 0 && approvalRequests.length === 0;
	return (
		<Flex flexDirection="column" rowGap={3} data-testid="mod-requests">
			<Card>
				<Flex alignItems="baseline" columnGap={2}>
					<Label>Join requests · {joinRequests.length}</Label>
					<Text fontSize="xs" color={MUTED}>
						{subspace.access === 'private' ? 'people asking into this private subspace' : 'only private subspaces take join requests'}
					</Text>
				</Flex>
				{loading && joinRequests.length === 0 && (
					<Text fontSize="sm" color={MUTED}>
						Loading…
					</Text>
				)}
				{!loading && joinRequests.length === 0 && (
					<Text fontSize="sm" color={MUTED}>
						Nobody is waiting 🕊️
					</Text>
				)}
				{joinRequests.map((member) => (
					<RequestRow key={member.userId} member={member} queue="join" busy={busyId === member.userId} onDecide={(target, decision) => decide('join', target, decision)} />
				))}
				{cursors.join && (
					<Button size="sm" variant="outline" borderRadius={RADIUS_MD} alignSelf="center" onClick={() => load('join', cursors.join)}>
						Load more ⬇️
					</Button>
				)}
			</Card>
			<Card>
				<Flex alignItems="baseline" columnGap={2}>
					<Label>Posting approval requests · {approvalRequests.length}</Label>
					<Text fontSize="xs" color={MUTED}>
						{subspace.access === 'restricted' ? 'members asking to post here' : 'only restricted subspaces take posting requests'}
					</Text>
				</Flex>
				{loading && approvalRequests.length === 0 && (
					<Text fontSize="sm" color={MUTED}>
						Loading…
					</Text>
				)}
				{!loading && approvalRequests.length === 0 && (
					<Text fontSize="sm" color={MUTED}>
						No one is asking 🕊️
					</Text>
				)}
				{approvalRequests.map((member) => (
					<RequestRow key={member.userId} member={member} queue="approval" busy={busyId === member.userId} onDecide={(target, decision) => decide('approval', target, decision)} />
				))}
				{cursors.approval && (
					<Button size="sm" variant="outline" borderRadius={RADIUS_MD} alignSelf="center" onClick={() => load('approval', cursors.approval)}>
						Load more ⬇️
					</Button>
				)}
			</Card>
			{empty && (
				<Text fontSize="xs" color={MUTED} paddingX={1}>
					Requests land here the moment someone asks — you’ll also get a 🙋 bell notification.
				</Text>
			)}
		</Flex>
	);
};

// ── Members / banned ───────────────────────────────────────────────────────
// ── Set flair (moderator → member) ─────────────────────────────────────────
// A moderator dresses one member: a template (mod-only ones included), custom
// text (+ optional emoji), or none. Chakra modal — no window.prompt anywhere.
const MemberFlairModal = ({
	member,
	subspace,
	onClose,
	onApply
}: {
	member: PublicSubspaceMember | null;
	subspace: PublicSubspace;
	onClose: () => void;
	onApply: (member: PublicSubspaceMember, request: { flairId: string | null; text: string; emoji: string | null }) => Promise<void>;
}) => {
	const current = member?.userFlair || null;
	const [flairId, setFlairId] = React.useState<string>(current?.id || (current ? 'custom' : ''));
	const [text, setText] = React.useState(current && !current.id ? current.label : '');
	const [emoji, setEmoji] = React.useState(current && !current.id ? current.emoji || '' : '');
	const [saving, setSaving] = React.useState(false);
	// a different member (or a fresh row for the same one) reseeds the form
	React.useEffect(() => {
		const flair = member?.userFlair || null;
		setFlairId(flair?.id || (flair ? 'custom' : ''));
		setText(flair && !flair.id ? flair.label : '');
		setEmoji(flair && !flair.id ? flair.emoji || '' : '');
	}, [member]);
	const custom = flairId === 'custom';
	const canSave = !!member && (!custom || !!text.trim());
	const submit = async () => {
		if (!member || !canSave || saving) return;
		setSaving(true);
		try {
			await onApply(member, custom ? { flairId: null, text: text.trim(), emoji: emoji.trim() || null } : { flairId: flairId || null, text: '', emoji: null });
			onClose();
		} finally {
			setSaving(false);
		}
	};
	return (
		<Modal isOpen={!!member} onClose={() => !saving && onClose()} isCentered size="md">
			<ModalOverlay />
			<ModalContent borderRadius={RADIUS_LG} background="var(--tt-card, #ffffff)" marginX={4} data-testid="member-flair-modal">
				<ModalHeader fontFamily="heading" fontSize="lg" color={INK} paddingBottom={1}>
					Flair for {member ? memberName(member) : ''} 🏷️
				</ModalHeader>
				<ModalCloseButton isDisabled={saving} />
				<ModalBody>
					<Flex flexDirection="column" rowGap={3}>
						<Flex alignItems="center" columnGap={2} fontSize="xs" color={MUTED} minHeight="20px">
							{current ? 'Wears' : 'Wears no flair here'}
							{current && <AuthorFlairChip flair={current} />}
						</Flex>
						<Box>
							<Label>Flair</Label>
							<Select size="sm" borderRadius={RADIUS_MD} value={flairId} onChange={(event) => setFlairId(event.target.value)} data-testid="member-flair-select">
								<option value="">No flair</option>
								{subspace.userFlairs.map((flair) => (
									<option key={flair.id} value={flair.id}>
										{flair.emoji ? `${flair.emoji} ` : ''}
										{flair.label}
										{flair.modOnly ? ' 🎩' : ''}
									</option>
								))}
								<option value="custom">Custom text…</option>
							</Select>
						</Box>
						{custom && (
							<Flex columnGap={2} rowGap={2} flexWrap="wrap">
								<Input size="sm" width="64px" textAlign="center" borderRadius={RADIUS_MD} placeholder="🏷️" value={emoji} maxLength={8} onChange={(event) => setEmoji(event.target.value)} data-testid="member-flair-emoji" />
								<Input
									size="sm"
									flex="1"
									minWidth="160px"
									borderRadius={RADIUS_MD}
									placeholder="Flair text (≤ 40 chars)"
									value={text}
									maxLength={40}
									autoFocus
									onChange={(event) => setText(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === 'Enter') submit();
									}}
									data-testid="member-flair-text"
								/>
							</Flex>
						)}
						{subspace.userFlairs.length === 0 && !custom && (
							<Text fontSize="xs" color={MUTED}>
								No templates yet — add some under Flairs → User flairs, or pick Custom text.
							</Text>
						)}
					</Flex>
				</ModalBody>
				<ModalFooter columnGap={2}>
					<Button size="sm" variant="ghost" borderRadius={RADIUS_MD} onClick={onClose} isDisabled={saving}>
						Cancel
					</Button>
					<Button size="sm" borderRadius={RADIUS_MD} isDisabled={!canSave} isLoading={saving} onClick={submit} data-testid="member-flair-save">
						{flairId ? 'Set flair 🏷️' : 'Remove flair'}
					</Button>
				</ModalFooter>
			</ModalContent>
		</Modal>
	);
};

const MemberRow = (props: { member: PublicSubspaceMember; isOwner: boolean; onAction: (member: PublicSubspaceMember, action: string, extra?: Record<string, unknown>) => void; onFlair?: (member: PublicSubspaceMember) => void }) => {
	const { member, isOwner, onAction, onFlair } = props;
	return (
		<Flex alignItems="center" columnGap={2} rowGap={1} flexWrap="wrap" paddingY={2} borderBottom={BORDER} _last={{ borderBottom: 'none' }} data-member={member.userId}>
			<Box minWidth={0} flex="1">
				<Flex alignItems="center" columnGap={1.5} flexWrap="wrap">
					<Text as={Link} to={member.profile?.username ? `/profile/${member.profile.username}` : '#'} fontSize="sm" fontWeight={600} color={INK} _hover={{ textDecoration: 'underline' }}>
						{memberName(member)}
					</Text>
					<AuthorFlairChip flair={member.userFlair} size="xs" />
				</Flex>
				<Text fontSize="xs" color={MUTED}>
					{member.role === 'owner' ? '👑 owner' : member.role === 'moderator' ? '🎩 moderator' : 'member'}
					{member.approved && member.role === 'member' ? ' · ✅ approved poster' : ''}
					{member.approvalRequested ? ' · ✋ asked to post' : ''}
					{member.banned ? ` · 🚫 banned${member.banUntil ? ` until ${new Date(member.banUntil).toLocaleDateString()}` : ''}${member.banReason ? ` (${member.banReason})` : ''}` : ''}
					{' · joined '}
					{new Date(member.joinedAt).toLocaleDateString()}
				</Text>
			</Box>
			{member.role !== 'owner' && (
				<Flex columnGap={1} flexWrap="wrap">
					{member.banned ? (
						<Button size="xs" borderRadius="999px" onClick={() => onAction(member, 'unban')}>
							Unban
						</Button>
					) : (
						<>
							{onFlair && (
								<Button size="xs" borderRadius="999px" variant="outline" onClick={() => onFlair(member)} data-testid="member-set-flair">
									{member.userFlair ? 'Flair 🏷️' : 'Set flair'}
								</Button>
							)}
							<Button size="xs" borderRadius="999px" variant="outline" onClick={() => onAction(member, member.approved ? 'unapprove' : 'approve')}>
								{member.approved ? 'Unapprove' : 'Approve poster'}
							</Button>
							{isOwner && (
								<Button size="xs" borderRadius="999px" variant="outline" onClick={() => onAction(member, 'role', { role: member.role === 'moderator' ? 'member' : 'moderator' })}>
									{member.role === 'moderator' ? 'Demote' : 'Make mod'}
								</Button>
							)}
							{(isOwner || member.role !== 'moderator') && (
								<>
									<Button size="xs" borderRadius="999px" variant="outline" onClick={() => onAction(member, 'remove')}>
										Kick
									</Button>
									<Button
										size="xs"
										borderRadius="999px"
										colorScheme="red"
										variant="outline"
										onClick={() => {
											const reason = window.prompt('Ban reason (shown to the user)') || undefined;
											const days = window.prompt('Ban length in days (blank = permanent)') || '';
											onAction(member, 'ban', { reason, banDays: days ? Number(days) : undefined });
										}}
									>
										Ban
									</Button>
								</>
							)}
						</>
					)}
				</Flex>
			)}
		</Flex>
	);
};

const MembersPanel = ({ slug, banned, isOwner, subspace }: { slug: string; banned: boolean; isOwner: boolean; subspace: PublicSubspace }) => {
	const api = useApi();
	const lopu = useLopu();
	const [members, setMembers] = React.useState<PublicSubspaceMember[]>([]);
	const [nextCursor, setNextCursor] = React.useState<string | null>(null);
	const [loading, setLoading] = React.useState(true);
	const [username, setUsername] = React.useState('');
	const [action, setAction] = React.useState('add');
	const [busy, setBusy] = React.useState(false);
	const [flairTarget, setFlairTarget] = React.useState<PublicSubspaceMember | null>(null);

	const load = React.useCallback(
		async (cursor?: string | null) => {
			setLoading(true);
			try {
				const resp: any = await api.v1.subspaces.members({ slug, banned, cursor: cursor || undefined, limit: 50 });
				setMembers((prev) => (cursor ? [...prev, ...resp.members] : resp.members));
				setNextCursor(resp.nextCursor ?? null);
			} catch (err: any) {
				lopu({ title: err?.error || 'Could not load members 😞', status: 'error' });
			} finally {
				setLoading(false);
			}
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[slug, banned]
	);
	React.useEffect(() => {
		load();
	}, [load]);

	const mutate = async (target: { userId?: string; username?: string }, act: string, extra: Record<string, unknown> = {}) => {
		if (busy) return;
		setBusy(true);
		try {
			const resp: any = await api.v1.subspaces.mutateMember({ slug, ...target, action: act, ...extra });
			const member: PublicSubspaceMember = resp.member;
			setMembers((prev) => {
				const exists = prev.some((entry) => entry.userId === member.userId);
				const next = exists ? prev.map((entry) => (entry.userId === member.userId ? member : entry)) : [member, ...prev];
				// a row that no longer belongs in this list (unbanned in the ban
				// list, kicked/banned in the member list) drops out
				return next.filter((entry) => (banned ? entry.banned : !entry.banned && !entry.left));
			});
			lopu({ title: act === 'userFlair' ? (member.userFlair ? `${memberName(member)} now wears ${member.userFlair.emoji ? `${member.userFlair.emoji} ` : ''}${member.userFlair.label} 🏷️` : `Flair removed from ${memberName(member)}`) : `${act} → ${memberName(member)} ✓`, status: 'success', duration: 4000 });
		} catch (err: any) {
			lopu({ title: err?.error || 'Member action failed 😞', status: 'error' });
			throw err;
		} finally {
			setBusy(false);
		}
	};
	// the flair modal paints the row first and puts it back if the API says no
	const applyFlair = async (member: PublicSubspaceMember, request: { flairId: string | null; text: string; emoji: string | null }) => {
		const optimistic = request.flairId
			? (() => {
					const template = subspace.userFlairs.find((flair) => flair.id === request.flairId);
					return template ? { id: template.id, label: template.label, emoji: template.emoji, color: template.color } : member.userFlair;
				})()
			: request.text
				? { id: null, label: request.text, emoji: request.emoji, color: null }
				: null;
		setMembers((prev) => prev.map((entry) => (entry.userId === member.userId ? { ...entry, userFlair: optimistic } : entry)));
		try {
			await mutate({ userId: member.userId }, 'userFlair', request);
		} catch {
			setMembers((prev) => prev.map((entry) => (entry.userId === member.userId ? { ...entry, userFlair: member.userFlair } : entry)));
		}
	};

	return (
		<Flex flexDirection="column" rowGap={3}>
			<Card>
				<Label>{banned ? 'Ban someone' : 'Act on a username'}</Label>
				<Flex columnGap={2} rowGap={2} flexWrap="wrap" alignItems="center">
					<Input size="sm" width="200px" borderRadius={RADIUS_MD} placeholder="username" value={username} onChange={(event) => setUsername(event.target.value.trim())} />
					{!banned && (
						<Select size="sm" width="170px" borderRadius={RADIUS_MD} value={action} onChange={(event) => setAction(event.target.value)}>
							<option value="add">Add member</option>
							<option value="approve">Approve poster</option>
							<option value="unapprove">Unapprove poster</option>
							<option value="remove">Kick</option>
							{isOwner && <option value="role:moderator">Make moderator</option>}
							{isOwner && <option value="role:member">Demote to member</option>}
						</Select>
					)}
					<Button
						size="sm"
						borderRadius={RADIUS_MD}
						isDisabled={!username}
						isLoading={busy}
						onClick={() => {
							if (banned) {
								const reason = window.prompt('Ban reason (shown to the user)') || undefined;
								const days = window.prompt('Ban length in days (blank = permanent)') || '';
								mutate({ username }, 'ban', { reason, banDays: days ? Number(days) : undefined }).catch(() => undefined);
							} else if (action.startsWith('role:')) mutate({ username }, 'role', { role: action.split(':')[1] }).catch(() => undefined);
							else mutate({ username }, action).catch(() => undefined);
						}}
					>
						{banned ? 'Ban 🚫' : 'Apply'}
					</Button>
				</Flex>
			</Card>
			<Card>
				<Label>{banned ? 'Banned' : 'Members'}</Label>
				{loading && members.length === 0 && (
					<Text fontSize="sm" color={MUTED}>
						Loading…
					</Text>
				)}
				{!loading && members.length === 0 && (
					<Text fontSize="sm" color={MUTED}>
						{banned ? 'Nobody is banned 🕊️' : 'No members yet'}
					</Text>
				)}
				{members.map((member) => (
					<MemberRow
						key={member.userId}
						member={member}
						isOwner={isOwner}
						onAction={(target, act, extra) => mutate({ userId: target.userId }, act, extra).catch(() => undefined)}
						onFlair={banned ? undefined : setFlairTarget}
					/>
				))}
				{nextCursor && (
					<Button size="sm" variant="outline" borderRadius={RADIUS_MD} alignSelf="center" onClick={() => load(nextCursor)}>
						Load more ⬇️
					</Button>
				)}
			</Card>
			{!banned && <MemberFlairModal member={flairTarget} subspace={subspace} onClose={() => setFlairTarget(null)} onApply={applyFlair} />}
		</Flex>
	);
};

// ── Settings ───────────────────────────────────────────────────────────────
const SettingsPanel = ({ subspace, onSaved }: { subspace: PublicSubspace; onSaved: (next: PublicSubspace) => void }) => {
	const api = useApi();
	const lopu = useLopu();
	const isOwner = subspace.viewer.role === 'owner';
	const [name, setName] = React.useState(subspace.name);
	const [description, setDescription] = React.useState(subspace.description || '');
	const [access, setAccess] = React.useState<SubspaceAccess>(subspace.access);
	const [nsfw, setNsfw] = React.useState(subspace.nsfw);
	const [icon, setIcon] = React.useState(subspace.branding.icon || '');
	const [iconUrl, setIconUrl] = React.useState(subspace.branding.iconUrl || '');
	const [bannerUrl, setBannerUrl] = React.useState(subspace.branding.bannerUrl || '');
	const [accent, setAccent] = React.useState(subspace.branding.accent || '');
	const [saving, setSaving] = React.useState(false);
	const save = async () => {
		setSaving(true);
		try {
			const resp: any = await api.v1.subspaces.update({
				id: subspace.id,
				name,
				description,
				branding: { icon: icon || null, iconUrl: iconUrl || null, bannerUrl: bannerUrl || null, accent: accent || null },
				...(isOwner ? { access, nsfw } : {})
			});
			onSaved(resp.subspace);
			lopu({ title: 'Subspace settings saved ✨', status: 'success', duration: 4000 });
		} catch (err: any) {
			lopu({ title: err?.error || 'Could not save settings 😞', status: 'error' });
		} finally {
			setSaving(false);
		}
	};
	return (
		<Card>
			<Flex columnGap={3} alignItems="center">
				<SubspaceIcon subspace={{ ...subspace, branding: { ...subspace.branding, icon, iconUrl, accent } }} size="56px" fontSize="2xl" />
				<Box>
					<Label>Identity</Label>
					<Text fontSize="xs" color={MUTED}>
						/s/{subspace.slug} · slug is permanent
					</Text>
				</Box>
			</Flex>
			<Box>
				<Label>Name</Label>
				<Input size="sm" borderRadius={RADIUS_MD} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
			</Box>
			<Box>
				<Label>Description</Label>
				<Textarea size="sm" borderRadius={RADIUS_MD} rows={3} value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} />
			</Box>
			<Flex columnGap={3} rowGap={3} flexWrap="wrap">
				<Box width="80px">
					<Label>Icon emoji</Label>
					<Input size="sm" borderRadius={RADIUS_MD} textAlign="center" value={icon} maxLength={8} onChange={(event) => setIcon(event.target.value)} />
				</Box>
				<Box width="140px">
					<Label>Accent</Label>
					<Input size="sm" borderRadius={RADIUS_MD} fontFamily="mono" placeholder="#7c5cff" value={accent} maxLength={32} onChange={(event) => setAccent(event.target.value)} />
				</Box>
				<Box flex="1" minWidth="200px">
					<Label>Icon image URL</Label>
					<Input size="sm" borderRadius={RADIUS_MD} placeholder="https://…" value={iconUrl} onChange={(event) => setIconUrl(event.target.value)} />
				</Box>
				<Box flex="1" minWidth="200px">
					<Label>Banner image URL</Label>
					<Input size="sm" borderRadius={RADIUS_MD} placeholder="https://…" value={bannerUrl} onChange={(event) => setBannerUrl(event.target.value)} />
				</Box>
			</Flex>
			<Flex columnGap={3} rowGap={3} flexWrap="wrap" alignItems="flex-end">
				<Box minWidth="220px">
					<Label>Who can post {isOwner ? '' : '(owner only)'}</Label>
					<Select size="sm" borderRadius={RADIUS_MD} value={access} isDisabled={!isOwner} onChange={(event) => setAccess(event.target.value as SubspaceAccess)}>
						{(Object.keys(ACCESS_META) as SubspaceAccess[]).map((key) => (
							<option key={key} value={key}>
								{ACCESS_META[key].emoji} {ACCESS_META[key].label} — {ACCESS_META[key].hint}
							</option>
						))}
					</Select>
				</Box>
				<Flex as="label" alignItems="center" columnGap={2} fontSize="sm" color={INK} cursor={isOwner ? 'pointer' : 'default'} paddingBottom={1}>
					<Switch isChecked={nsfw} isDisabled={!isOwner} onChange={(event) => setNsfw(event.target.checked)} />
					18+ subspace 🔞
				</Flex>
				<Button marginLeft="auto" size="sm" borderRadius={RADIUS_MD} isLoading={saving} onClick={save} data-testid="mod-save-settings">
					Save ✨
				</Button>
			</Flex>
		</Card>
	);
};

// ── Danger zone (owner only) ───────────────────────────────────────────────
// Transfer ownership to an active member (username → confirm modal; the
// owner steps down to moderator and may then leave) and delete the subspace
// (modal: retype the slug to arm the red button; posts survive as plain
// posts). Both are Chakra modals — no window.prompt/confirm anywhere here.
const DANGER = 'var(--tt-danger, #e5484d)';
const normalizeSlugInput = (value: string) => value.trim().toLowerCase().replace(/^s\//, '');

// `isOwner` follows the (optimistically flipped) viewer role; the parent keeps
// this panel MOUNTED while a transfer is in flight (`onTransferPending`) so the
// optimistic crown flip dims the controls instead of unmounting the panel —
// the confirm modal and its spinner stay put, and a failed transfer lands
// back on the same panel with the username still typed in.
const DangerZonePanel = ({
	subspace,
	isOwner,
	onTransferred,
	onTransferPending
}: {
	subspace: PublicSubspace;
	isOwner: boolean;
	onTransferred: (next: PublicSubspace) => void;
	onTransferPending: (pending: boolean) => void;
}) => {
	const api = useApi();
	const lopu = useLopu();
	const navigate = useNavigate();
	const [username, setUsername] = React.useState('');
	const [transferOpen, setTransferOpen] = React.useState(false);
	const [transferring, setTransferring] = React.useState(false);
	const [deleteOpen, setDeleteOpen] = React.useState(false);
	const [confirmSlug, setConfirmSlug] = React.useState('');
	const [deleting, setDeleting] = React.useState(false);
	const cleanUsername = username.trim().replace(/^@/, '');
	const deleteArmed = normalizeSlugInput(confirmSlug) === subspace.slug;

	const transfer = async () => {
		if (!cleanUsername || transferring) return;
		setTransferring(true);
		onTransferPending(true);
		// optimistic: the crown moves now (the owner-only controls on this page
		// dim instantly); a failure puts it straight back
		const before = subspace;
		onTransferred({ ...subspace, viewer: { ...subspace.viewer, role: 'moderator' } });
		try {
			const resp = (await api.v1.subspaces.transfer({ id: subspace.id, username: cleanUsername })) as SubspaceTransferResponse;
			// the viewer's cached /s/<slug> copy still says owner — drop it
			clearLocalCachePrefix(`tt-subspace-${subspace.slug}-`);
			// one batched commit: the real role lands, the modal closes and the
			// pending flag clears together, so the panel unmounts with the modal
			// already shut instead of vanishing mid-spinner
			setTransferOpen(false);
			setUsername('');
			setTransferring(false);
			onTransferred(resp.subspace);
			onTransferPending(false);
			lopu({
				title: `s/${subspace.slug} now belongs to @${resp.newOwner.profile?.username || cleanUsername} 👑`,
				description: 'You stay on as a moderator — and can leave whenever you like.',
				status: 'success',
				duration: 8000
			});
		} catch (err: any) {
			// the crown comes straight back; the modal stays open with the name
			// still typed so the owner can fix a typo and go again
			setTransferring(false);
			onTransferred(before);
			onTransferPending(false);
			lopu({ title: err?.error || 'Could not transfer the subspace 😞', status: 'error' });
		}
	};

	const remove = async () => {
		if (!deleteArmed || deleting) return;
		setDeleting(true);
		try {
			const resp = (await api.v1.subspaces.delete({ id: subspace.id, confirmSlug: normalizeSlugInput(confirmSlug) })) as SubspaceDeleteResponse;
			// nothing may repaint the dead subspace from cache: its page copies
			// (every viewer key) and the directory lists go
			clearLocalCachePrefix(`tt-subspace-${subspace.slug}-`);
			clearLocalCachePrefix('tt-subspaces-');
			setDeleteOpen(false);
			const privateNote = resp.privatePosts > 0 ? ` (${resp.privatePosts} of them stay private to their authors)` : '';
			lopu({
				title: `s/${subspace.slug} is gone 🗑️`,
				description: `${resp.releasedPosts} post${resp.releasedPosts === 1 ? '' : 's'} live on as plain posts${privateNote} · ${resp.removedMembers} membership${resp.removedMembers === 1 ? '' : 's'} removed. The slug is held for you for ${SUBSPACE_SLUG_HOLD_DAYS} days.`,
				status: 'success',
				duration: 9000
			});
			navigate('/s');
		} catch (err: any) {
			lopu({ title: err?.error || 'Could not delete the subspace 😞', status: 'error' });
		} finally {
			setDeleting(false);
		}
	};

	return (
		<Flex flexDirection="column" rowGap={3} background="var(--tt-card, #ffffff)" border={`1px solid ${DANGER}`} borderRadius={RADIUS_LG} padding={4} data-testid="mod-danger-zone">
			<Box>
				<Text fontFamily="mono" fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color={DANGER}>
					Danger zone ⚠️
				</Text>
				<Text fontSize="xs" color={MUTED}>
					Owner only. Neither of these can be undone from here.
				</Text>
			</Box>
			<Flex flexDirection="column" rowGap={2} paddingTop={2} borderTop={BORDER} opacity={isOwner ? 1 : 0.55} transition="opacity 160ms ease">
				<Text fontSize="sm" fontWeight={600} color={INK}>
					Transfer ownership 👑
				</Text>
				<Text fontSize="xs" color={TEXT}>
					Hand s/{subspace.slug} to an active member. They become the owner; you stay on as a moderator (and can leave afterwards).
				</Text>
				<Flex columnGap={2} rowGap={2} flexWrap="wrap" alignItems="center">
					<Input
						size="sm"
						width="220px"
						maxWidth="100%"
						borderRadius={RADIUS_MD}
						placeholder="username of the new owner"
						value={username}
						isDisabled={!isOwner}
						onChange={(event) => setUsername(event.target.value)}
						data-testid="mod-transfer-username"
					/>
					<Button
						size="sm"
						variant="outline"
						borderRadius={RADIUS_MD}
						borderColor={DANGER}
						color={DANGER}
						isDisabled={!cleanUsername || !isOwner}
						onClick={() => setTransferOpen(true)}
						data-testid="mod-transfer-open"
					>
						Transfer ownership →
					</Button>
				</Flex>
			</Flex>
			<Flex flexDirection="column" rowGap={2} paddingTop={2} borderTop={BORDER} opacity={isOwner ? 1 : 0.55} transition="opacity 160ms ease">
				<Text fontSize="sm" fontWeight={600} color={INK}>
					Delete subspace 🗑️
				</Text>
				<Text fontSize="xs" color={TEXT}>
					Removes s/{subspace.slug}, its members, rules, flairs and mod log. Posts are NOT deleted — they live on as plain posts without the subspace, flair or moderation state.
					{subspace.access === 'private'
						? ' Because this subspace is private, every post stays private to its author (they can re-share it themselves).'
						: ' Posts the moderators removed stay private to their authors rather than reappearing in public.'}{' '}
					The slug is held for you for {SUBSPACE_SLUG_HOLD_DAYS} days.
				</Text>
				<Button size="sm" alignSelf="flex-start" borderRadius={RADIUS_MD} colorScheme="red" variant="outline" isDisabled={!isOwner} onClick={() => setDeleteOpen(true)} data-testid="mod-delete-open">
					Delete subspace…
				</Button>
			</Flex>

			<Modal isOpen={transferOpen} onClose={() => !transferring && setTransferOpen(false)} isCentered size="md">
				<ModalOverlay />
				<ModalContent borderRadius={RADIUS_LG} background="var(--tt-card, #ffffff)" marginX={4}>
					<ModalHeader fontFamily="heading" fontSize="lg" color={INK} paddingBottom={1}>
						Hand over s/{subspace.slug}? 👑
					</ModalHeader>
					<ModalCloseButton isDisabled={transferring} />
					<ModalBody>
						<Text fontSize="sm" color={TEXT} whiteSpace="normal">
							<Text as="span" fontWeight={700} color={INK}>
								@{cleanUsername}
							</Text>{' '}
							becomes the owner of s/{subspace.slug} — they can change access, promote and demote moderators, transfer it again or delete it. You stay on as a moderator. Only the new owner can give it back.
						</Text>
					</ModalBody>
					<ModalFooter columnGap={2}>
						<Button size="sm" variant="ghost" borderRadius={RADIUS_MD} onClick={() => setTransferOpen(false)} isDisabled={transferring}>
							Keep it
						</Button>
						<Button size="sm" colorScheme="red" borderRadius={RADIUS_MD} isLoading={transferring} onClick={transfer} data-testid="mod-transfer-confirm">
							Transfer to @{cleanUsername}
						</Button>
					</ModalFooter>
				</ModalContent>
			</Modal>

			<Modal
				isOpen={deleteOpen}
				onClose={() => {
					if (deleting) return;
					setDeleteOpen(false);
					setConfirmSlug('');
				}}
				isCentered
				size="md"
			>
				<ModalOverlay />
				<ModalContent borderRadius={RADIUS_LG} background="var(--tt-card, #ffffff)" marginX={4}>
					<ModalHeader fontFamily="heading" fontSize="lg" color={INK} paddingBottom={1}>
						Delete s/{subspace.slug}? 🗑️
					</ModalHeader>
					<ModalCloseButton isDisabled={deleting} />
					<ModalBody>
						<Flex flexDirection="column" rowGap={3}>
							<Text fontSize="sm" color={TEXT} whiteSpace="normal">
								This removes the subspace, every membership and ban, the rules, flairs and the mod log. The {typeof subspace.postCount === 'number' ? `${subspace.postCount.toLocaleString()} ` : ''}
								posts stay on Thingtime as plain posts
								{subspace.access === 'private' ? ' — private to their authors, since this subspace is private' : ' (posts the mods removed stay private to their authors)'}. Nobody
								else can take s/{subspace.slug} for {SUBSPACE_SLUG_HOLD_DAYS} days; you can re-found it any time.
							</Text>
							<Box>
								<Label>
									Type <Text as="span" fontFamily="mono" textTransform="none" letterSpacing="0" color={INK}>s/{subspace.slug}</Text> to confirm
								</Label>
								<Input
									size="sm"
									fontFamily="mono"
									borderRadius={RADIUS_MD}
									placeholder={`s/${subspace.slug}`}
									value={confirmSlug}
									onChange={(event) => setConfirmSlug(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === 'Enter') remove();
									}}
									autoFocus
									data-testid="mod-delete-confirm-input"
								/>
							</Box>
						</Flex>
					</ModalBody>
					<ModalFooter columnGap={2}>
						<Button
							size="sm"
							variant="ghost"
							borderRadius={RADIUS_MD}
							onClick={() => {
								setDeleteOpen(false);
								setConfirmSlug('');
							}}
							isDisabled={deleting}
						>
							Cancel
						</Button>
						<Button size="sm" colorScheme="red" borderRadius={RADIUS_MD} isDisabled={!deleteArmed} isLoading={deleting} onClick={remove} data-testid="mod-delete-confirm">
							Delete s/{subspace.slug} forever
						</Button>
					</ModalFooter>
				</ModalContent>
			</Modal>
		</Flex>
	);
};

// ── Rules ──────────────────────────────────────────────────────────────────
const RulesPanel = ({ subspace, onSaved }: { subspace: PublicSubspace; onSaved: (next: PublicSubspace) => void }) => {
	const api = useApi();
	const lopu = useLopu();
	const [rules, setRules] = React.useState<SubspaceRule[]>(subspace.rules);
	const [saving, setSaving] = React.useState(false);
	const update = (index: number, patch: Partial<SubspaceRule>) => setRules((prev) => prev.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
	const move = (index: number, delta: number) =>
		setRules((prev) => {
			const next = [...prev];
			const target = index + delta;
			if (target < 0 || target >= next.length) return prev;
			[next[index], next[target]] = [next[target], next[index]];
			return next;
		});
	const save = async () => {
		setSaving(true);
		try {
			const resp: any = await api.v1.subspaces.update({ id: subspace.id, rules: rules.filter((rule) => rule.title.trim()) });
			onSaved(resp.subspace);
			setRules(resp.subspace.rules);
			lopu({ title: 'Rules saved 📜', status: 'success', duration: 4000 });
		} catch (err: any) {
			lopu({ title: err?.error || 'Could not save rules 😞', status: 'error' });
		} finally {
			setSaving(false);
		}
	};
	return (
		<Card>
			<Label>Rules · {rules.length}/15</Label>
			{rules.map((rule, index) => (
				<Flex key={index} flexDirection="column" rowGap={1} border={BORDER} borderRadius={RADIUS_MD} padding={3} data-rule-index={index}>
					<Flex columnGap={2} alignItems="center">
						<Text fontSize="xs" color={MUTED} width="18px">
							{index + 1}.
						</Text>
						<Input size="sm" borderRadius={RADIUS_MD} placeholder="Rule title" value={rule.title} maxLength={100} onChange={(event) => update(index, { title: event.target.value })} />
						<Button size="xs" variant="ghost" onClick={() => move(index, -1)} aria-label="Move up">
							▲
						</Button>
						<Button size="xs" variant="ghost" onClick={() => move(index, 1)} aria-label="Move down">
							▼
						</Button>
						<Button size="xs" variant="ghost" color="var(--tt-danger, #e5484d)" onClick={() => setRules((prev) => prev.filter((_, i) => i !== index))} aria-label="Remove rule">
							✕
						</Button>
					</Flex>
					<Textarea size="sm" borderRadius={RADIUS_MD} rows={2} placeholder="Detail (optional)" value={rule.text || ''} maxLength={500} onChange={(event) => update(index, { text: event.target.value || null })} />
				</Flex>
			))}
			<Flex columnGap={2}>
				<Button size="sm" variant="outline" borderRadius={RADIUS_MD} isDisabled={rules.length >= 15} onClick={() => setRules((prev) => [...prev, { title: '', text: null }])}>
					Add rule ➕
				</Button>
				<Button marginLeft="auto" size="sm" borderRadius={RADIUS_MD} isLoading={saving} onClick={save} data-testid="mod-save-rules">
					Save 📜
				</Button>
			</Flex>
		</Card>
	);
};

// ── Flairs ─────────────────────────────────────────────────────────────────
const FlairsPanel = ({ subspace, onSaved }: { subspace: PublicSubspace; onSaved: (next: PublicSubspace) => void }) => {
	const api = useApi();
	const lopu = useLopu();
	const [flairs, setFlairs] = React.useState<SubspaceFlair[]>(subspace.flairs);
	const [saving, setSaving] = React.useState(false);
	const update = (index: number, patch: Partial<SubspaceFlair>) => setFlairs((prev) => prev.map((flair, i) => (i === index ? { ...flair, ...patch } : flair)));
	const save = async () => {
		setSaving(true);
		try {
			const resp: any = await api.v1.subspaces.update({
				id: subspace.id,
				flairs: flairs.filter((flair) => flair.label.trim()).map((flair) => ({ ...flair, id: flair.id || undefined }))
			});
			onSaved(resp.subspace);
			setFlairs(resp.subspace.flairs);
			lopu({ title: 'Flairs saved 🏷️', status: 'success', duration: 4000 });
		} catch (err: any) {
			lopu({ title: err?.error || 'Could not save flairs 😞', status: 'error' });
		} finally {
			setSaving(false);
		}
	};
	return (
		<Card>
			<Label>Post flairs · {flairs.length}/50</Label>
			{flairs.map((flair, index) => (
				<Flex key={index} columnGap={2} rowGap={2} alignItems="center" flexWrap="wrap" border={BORDER} borderRadius={RADIUS_MD} padding={2} data-flair-index={index}>
					<Input size="sm" width="56px" textAlign="center" borderRadius={RADIUS_MD} placeholder="🏷️" value={flair.emoji || ''} maxLength={8} onChange={(event) => update(index, { emoji: event.target.value || null })} />
					<Input size="sm" flex="1" minWidth="140px" borderRadius={RADIUS_MD} placeholder="Label" value={flair.label} maxLength={64} onChange={(event) => update(index, { label: event.target.value })} />
					<Input size="sm" width="110px" fontFamily="mono" borderRadius={RADIUS_MD} placeholder="#color" value={flair.color || ''} maxLength={32} onChange={(event) => update(index, { color: event.target.value || null })} />
					<Flex as="label" alignItems="center" columnGap={1} fontSize="xs" color={MUTED} cursor="pointer">
						<Switch size="sm" isChecked={flair.modOnly} onChange={(event) => update(index, { modOnly: event.target.checked })} />
						mods only
					</Flex>
					<Text fontSize="10px" fontFamily="mono" color={MUTED} title="Flair id (set on first save)">
						{flair.id || 'new'}
					</Text>
					<Button size="xs" variant="ghost" color="var(--tt-danger, #e5484d)" onClick={() => setFlairs((prev) => prev.filter((_, i) => i !== index))} aria-label="Remove flair">
						✕
					</Button>
				</Flex>
			))}
			<Flex columnGap={2}>
				<Button size="sm" variant="outline" borderRadius={RADIUS_MD} isDisabled={flairs.length >= 50} onClick={() => setFlairs((prev) => [...prev, { id: '', label: '', emoji: null, color: null, modOnly: false }])}>
					Add flair ➕
				</Button>
				<Button marginLeft="auto" size="sm" borderRadius={RADIUS_MD} isLoading={saving} onClick={save} data-testid="mod-save-flairs">
					Save 🏷️
				</Button>
			</Flex>
		</Card>
	);
};

// ── User flairs ────────────────────────────────────────────────────────────
// The templates members wear beside their name (the post-flair editor again;
// mod-only templates are handed out by moderators only) plus the two
// self-service switches. Moderators are bound by neither switch.
const UserFlairsPanel = ({ subspace, onSaved }: { subspace: PublicSubspace; onSaved: (next: PublicSubspace) => void }) => {
	const api = useApi();
	const lopu = useLopu();
	const [flairs, setFlairs] = React.useState<SubspaceFlair[]>(subspace.userFlairs);
	const [selfAssign, setSelfAssign] = React.useState(subspace.userFlairSelfAssign);
	const [allowCustom, setAllowCustom] = React.useState(subspace.allowCustomUserFlair);
	const [saving, setSaving] = React.useState(false);
	const update = (index: number, patch: Partial<SubspaceFlair>) => setFlairs((prev) => prev.map((flair, i) => (i === index ? { ...flair, ...patch } : flair)));
	const save = async () => {
		setSaving(true);
		try {
			const resp: any = await api.v1.subspaces.update({
				id: subspace.id,
				userFlairs: flairs.filter((flair) => flair.label.trim()).map((flair) => ({ ...flair, id: flair.id || undefined })),
				userFlairSelfAssign: selfAssign,
				allowCustomUserFlair: allowCustom
			});
			onSaved(resp.subspace);
			setFlairs(resp.subspace.userFlairs);
			setSelfAssign(resp.subspace.userFlairSelfAssign);
			setAllowCustom(resp.subspace.allowCustomUserFlair);
			lopu({ title: 'User flairs saved 🏷️', status: 'success', duration: 4000 });
		} catch (err: any) {
			lopu({ title: err?.error || 'Could not save user flairs 😞', status: 'error' });
		} finally {
			setSaving(false);
		}
	};
	return (
		<Card>
			<Box>
				<Label>User flairs · {flairs.length}/50</Label>
				<Text fontSize="xs" color={MUTED}>
					What members wear beside their name here — on their posts and comments in s/{subspace.slug}. Set one for a member from the Members tab.
				</Text>
			</Box>
			<Flex flexDirection="column" rowGap={2} data-testid="mod-user-flairs">
				{flairs.map((flair, index) => (
					<Flex key={index} columnGap={2} rowGap={2} alignItems="center" flexWrap="wrap" border={BORDER} borderRadius={RADIUS_MD} padding={2} data-user-flair-index={index}>
						<Input size="sm" width="56px" textAlign="center" borderRadius={RADIUS_MD} placeholder="🏷️" value={flair.emoji || ''} maxLength={8} onChange={(event) => update(index, { emoji: event.target.value || null })} />
						<Input size="sm" flex="1" minWidth="140px" borderRadius={RADIUS_MD} placeholder="Label" value={flair.label} maxLength={64} onChange={(event) => update(index, { label: event.target.value })} />
						<Input size="sm" width="110px" fontFamily="mono" borderRadius={RADIUS_MD} placeholder="#color" value={flair.color || ''} maxLength={32} onChange={(event) => update(index, { color: event.target.value || null })} />
						<Flex as="label" alignItems="center" columnGap={1} fontSize="xs" color={MUTED} cursor="pointer" title="Only moderators can give this flair to someone">
							<Switch size="sm" isChecked={flair.modOnly} onChange={(event) => update(index, { modOnly: event.target.checked })} />
							mods only
						</Flex>
						<Text fontSize="10px" fontFamily="mono" color={MUTED} title="Flair id (set on first save)">
							{flair.id || 'new'}
						</Text>
						<Button size="xs" variant="ghost" color="var(--tt-danger, #e5484d)" onClick={() => setFlairs((prev) => prev.filter((_, i) => i !== index))} aria-label="Remove user flair">
							✕
						</Button>
					</Flex>
				))}
			</Flex>
			<Flex columnGap={4} rowGap={2} flexWrap="wrap">
				<Flex as="label" alignItems="center" columnGap={2} fontSize="sm" color={INK} cursor="pointer">
					<Switch size="sm" isChecked={selfAssign} onChange={(event) => setSelfAssign(event.target.checked)} data-testid="mod-user-flair-self-assign" />
					Members pick their own flair
				</Flex>
				<Flex as="label" alignItems="center" columnGap={2} fontSize="sm" color={INK} cursor="pointer" opacity={selfAssign ? 1 : 0.55}>
					<Switch size="sm" isChecked={allowCustom} onChange={(event) => setAllowCustom(event.target.checked)} data-testid="mod-user-flair-allow-custom" />
					Members may type their own text (≤ 40 chars)
				</Flex>
			</Flex>
			<Flex columnGap={2}>
				<Button size="sm" variant="outline" borderRadius={RADIUS_MD} isDisabled={flairs.length >= 50} onClick={() => setFlairs((prev) => [...prev, { id: '', label: '', emoji: null, color: null, modOnly: false }])}>
					Add user flair ➕
				</Button>
				<Button marginLeft="auto" size="sm" borderRadius={RADIUS_MD} isLoading={saving} onClick={save} data-testid="mod-save-user-flairs">
					Save 🏷️
				</Button>
			</Flex>
		</Card>
	);
};

// ── Mod log ────────────────────────────────────────────────────────────────
const LogPanel = ({ slug }: { slug: string }) => {
	const api = useApi();
	const lopu = useLopu();
	const [entries, setEntries] = React.useState<PublicModlogEntry[]>([]);
	const [nextCursor, setNextCursor] = React.useState<string | null>(null);
	const [loading, setLoading] = React.useState(true);
	const load = React.useCallback(
		async (cursor?: string | null) => {
			setLoading(true);
			try {
				const resp: any = await api.v1.subspaces.modlog({ slug, cursor: cursor || undefined, limit: 50 });
				setEntries((prev) => (cursor ? [...prev, ...resp.entries] : resp.entries));
				setNextCursor(resp.nextCursor ?? null);
			} catch (err: any) {
				lopu({ title: err?.error || 'Could not load the mod log 😞', status: 'error' });
			} finally {
				setLoading(false);
			}
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[slug]
	);
	React.useEffect(() => {
		load();
	}, [load]);
	return (
		<Card>
			<Label>Mod log</Label>
			{!loading && entries.length === 0 && (
				<Text fontSize="sm" color={MUTED}>
					Nothing logged yet 🕊️
				</Text>
			)}
			{entries.map((entry) => (
				<Flex key={entry.id} flexDirection="column" paddingY={2} borderBottom={BORDER} _last={{ borderBottom: 'none' }} data-modlog-action={entry.action}>
					<Flex columnGap={2} alignItems="baseline" flexWrap="wrap">
						<Text fontFamily="mono" fontSize="xs" fontWeight={700} color={INK}>
							{entry.action}
						</Text>
						<Text fontSize="xs" color={MUTED}>
							by {entry.actor?.displayName || entry.actor?.username || 'someone'}
							{entry.user ? ` → ${entry.user.displayName || entry.user.username}` : ''}
							{entry.postId ? (
								<>
									{' · '}
									<Link to={`/post/${entry.postId}`}>post ↗</Link>
								</>
							) : null}
							{' · '}
							{new Date(entry.createdAt).toLocaleString()}
						</Text>
					</Flex>
					{(entry.reason || entry.detail) && (
						<Text fontSize="xs" color={TEXT}>
							{entry.reason || ''}
							{entry.detail ? ` ${JSON.stringify(entry.detail)}` : ''}
						</Text>
					)}
				</Flex>
			))}
			{nextCursor && (
				<Button size="sm" variant="outline" borderRadius={RADIUS_MD} alignSelf="center" onClick={() => load(nextCursor)}>
					Load more ⬇️
				</Button>
			)}
		</Card>
	);
};

// ── Page ───────────────────────────────────────────────────────────────────
export const SubspaceModPage = () => {
	const { slug = '' } = useParams();
	const api = useApi();
	const user = useCurrentUser();
	const lopu = useLopu();
	const [searchParams, setSearchParams] = useSearchParams();
	const tab = (TABS as readonly string[]).includes(searchParams.get('tab') || '') ? (searchParams.get('tab') as ModTab) : 'queue';
	const [subspace, setSubspace] = React.useState<PublicSubspace | null>(null);
	const [denied, setDenied] = React.useState(false);
	// an ownership transfer in flight keeps the Danger zone mounted while the
	// optimistic role flip already dims the owner-only controls
	const [transferPending, setTransferPending] = React.useState(false);

	React.useEffect(() => {
		let cancelled = false;
		api.v1.subspaces
			.get({ slug })
			.then((resp: any) => {
				if (cancelled) return;
				setSubspace(resp.subspace);
				setDenied(!resp.subspace?.viewer?.canModerate);
			})
			.catch((err: any) => {
				if (!cancelled) lopu({ title: err?.error || 'Could not load the subspace 😞', status: 'error' });
			});
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [slug, user?.id]);

	const setTab = (next: ModTab) => {
		const params = new URLSearchParams(searchParams);
		params.set('tab', next);
		setSearchParams(params, { replace: true });
	};

	return (
		<Flex
			justifyContent="center"
			width="100%"
			minHeight="100vh"
			background="var(--tt-surface, #fafafb)"
			paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))"
			paddingBottom={16}
		>
			{/* full-width like the subspace page; panels stretch with the viewport */}
			<Flex flexDirection="column" rowGap={4} width="100%" paddingX={[3, 4, 6, 8]} paddingTop={[3, 4, 5]}>
				<Flex alignItems="center" columnGap={3}>
					{subspace && <SubspaceIcon subspace={subspace} size="44px" fontSize="xl" />}
					<Box>
						<Label>Mod tools 🎩</Label>
						<Text as="h1" fontFamily="heading" fontSize="2xl" fontWeight={700} letterSpacing="-0.02em" color={INK} lineHeight="1.1">
							{subspace?.name || `s/${slug}`}
						</Text>
					</Box>
					<Button as={Link} to={`/s/${slug}`} marginLeft="auto" size="sm" variant="outline" borderRadius="999px" borderColor="var(--tt-border, #ececef)">
						← Back to s/{slug}
					</Button>
				</Flex>
				{denied && (
					<Flex border={BORDER} borderRadius={RADIUS_LG} padding={6} justifyContent="center" background="var(--tt-card, #ffffff)">
						<Text fontSize="sm" color={MUTED}>
							Moderators only — you need a mod hat for this page 🎩
						</Text>
					</Flex>
				)}
				{subspace && !denied && (
					<Tabs index={TABS.indexOf(tab)} onChange={(index) => setTab(TABS[index])} variant="soft-rounded" size="sm" colorScheme="gray" isLazy>
						<TabList flexWrap="wrap" rowGap={1} data-testid="mod-tabs">
							{TABS.map((entry) => {
								const badge = entry === 'requests' ? openRequestCount(subspace) : 0;
								return (
									<Tab
										key={entry}
										textTransform="capitalize"
										fontSize="xs"
										data-tab={entry}
										data-badge={badge || undefined}
										// explicit selected colours: the theme paints the selected soft-rounded
										// tab ink-on-ink (label invisible), so pin ink background + card text;
										// the count pill inverts on it so it stays legible
										_selected={{ background: INK, color: 'var(--tt-card, #ffffff)' }}
										sx={{ '&[aria-selected="true"] [data-count-pill]': { background: 'var(--tt-card, #ffffff)', color: INK } }}
									>
										{entry}
										{badge > 0 && (
											<Text as="span" data-count-pill marginLeft={1.5} fontSize="10px" fontWeight={700} lineHeight="1" paddingX={1.5} paddingY="3px" borderRadius="999px" background={INK} color="var(--tt-card, #ffffff)" data-testid="mod-requests-badge">
												{badge}
											</Text>
										)}
									</Tab>
								);
							})}
						</TabList>
						<TabPanels>
							<TabPanel paddingX={0}>
								<QueuePanel slug={slug} />
							</TabPanel>
							<TabPanel paddingX={0}>
								<RequestsPanel subspace={subspace} onCounts={(patch) => setSubspace((prev) => (prev ? { ...prev, ...patch } : prev))} />
							</TabPanel>
							<TabPanel paddingX={0}>
								<MembersPanel slug={slug} banned={false} isOwner={subspace.viewer.role === 'owner'} subspace={subspace} />
							</TabPanel>
							<TabPanel paddingX={0}>
								<MembersPanel slug={slug} banned isOwner={subspace.viewer.role === 'owner'} subspace={subspace} />
							</TabPanel>
							<TabPanel paddingX={0}>
								<Flex flexDirection="column" rowGap={4}>
									<SettingsPanel subspace={subspace} onSaved={setSubspace} />
									{/* stays mounted through an in-flight transfer: the optimistic crown
									    flip dims it rather than unmounting the open confirm modal */}
									{subspace.viewer.role === 'owner' || transferPending ? (
										<DangerZonePanel subspace={subspace} isOwner={subspace.viewer.role === 'owner'} onTransferred={setSubspace} onTransferPending={setTransferPending} />
									) : (
										<Text fontSize="xs" color={MUTED} paddingX={1}>
											Transferring or deleting s/{slug} is up to its owner 👑
										</Text>
									)}
								</Flex>
							</TabPanel>
							<TabPanel paddingX={0}>
								<RulesPanel subspace={subspace} onSaved={setSubspace} />
							</TabPanel>
							<TabPanel paddingX={0}>
								<Flex flexDirection="column" rowGap={4}>
									<FlairsPanel subspace={subspace} onSaved={setSubspace} />
									<UserFlairsPanel subspace={subspace} onSaved={setSubspace} />
								</Flex>
							</TabPanel>
							<TabPanel paddingX={0}>
								<LogPanel slug={slug} />
							</TabPanel>
						</TabPanels>
					</Tabs>
				)}
			</Flex>
		</Flex>
	);
};
