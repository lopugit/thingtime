import React from 'react';
import { Box, Button, Flex, Input, Select, Text } from '@chakra-ui/react';
import { Link, useParams, useSearchParams } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { clearLocalCache, readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useLopu } from '~/components/Lopu/useLopu';
import { AuthorFlairChip } from '~/components/Feed/PostCard';
import { PostComposer } from '~/components/Feed/PostComposer';
import { PostList } from '~/components/Feed/PostList';
import { mergeReactionOverlays } from '~/components/Feed/reactionOverlay';
import type { PostChange, PublicPost } from '~/components/Feed/feedTypes';
import { SubspaceIcon } from './SubspaceCard';
import { useSubspacePrefs } from './useSubspacePrefs';
import {
	ACCESS_META,
	composerContextOf,
	modQueueCount,
	openRequestCount,
	subspaceAccent,
	SUBSPACE_SORTS,
	TOP_RANGES,
	userFlairChoices,
	type PublicAuthorFlair,
	type PublicSubspace,
	type SubspaceFeedResponse,
	type SubspaceFeedSort,
	type SubspaceJoinResponse,
	type SubspaceMemberResponse,
	type TopRange
} from './subspaceTypes';

// /s/:slug — the subspace's home: banner + icon + name, join/leave, sort tabs
// (hot/new/top/rising/controversial, top with a range), the composer locked
// to this subspace (when the viewer may post), the post column, and the
// sidebar (about, rules, flairs, moderators, mod tools). Optimistic first
// paint from tt-subspace-<slug>-<viewer>; a 403 renders the private wall.

const INK = 'var(--tt-ink, #16161a)';
const TEXT = 'var(--tt-text, #5a5a66)';
const MUTED = 'var(--tt-muted, #9a9aa6)';
const BORDER = '1px solid var(--tt-border, #ececef)';
const RADIUS_MD = 'var(--tt-radius-md, 12px)';
const RADIUS_LG = 'var(--tt-radius-lg, 16px)';

type CachedSubspace = { at: number; subspace: PublicSubspace; posts: PublicPost[]; sort: SubspaceFeedSort };
const cacheKeyFor = (slug: string, viewerId: string | null | undefined) => `tt-subspace-${slug}-${viewerId || 'anon'}`;

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
	<Text fontFamily="mono" fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color={MUTED}>
		{children}
	</Text>
);

const SidebarCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
	<Flex flexDirection="column" rowGap={2} background="var(--tt-card, #ffffff)" border={BORDER} borderRadius={RADIUS_LG} padding={4}>
		<Eyebrow>{title}</Eyebrow>
		{children}
	</Flex>
);

// ── Your flair ───────────────────────────────────────────────────────────
// Members pick the flair worn beside their name in THIS subspace: one of the
// templates (mod-only ones for moderators), custom text when the mods allow
// it, or none. Paints the pick first (viewer.userFlair), reconciles from the
// member row the API answers, reverts on failure. Hidden for non-members and
// when the subspace offers nothing to pick (no templates, no custom text) —
// unless the viewer already wears one, so they can still take it off.
const MAX_CUSTOM_FLAIR_CHARS = 40;
const UserFlairCard = ({ subspace, onViewerFlair }: { subspace: PublicSubspace; onViewerFlair: (flair: PublicAuthorFlair | null) => void }) => {
	const api = useApi();
	const lopu = useLopu();
	const { viewer } = subspace;
	const choices = userFlairChoices(subspace);
	const current = viewer.userFlair;
	const [custom, setCustom] = React.useState(current && !current.id ? current.label : '');
	const [busy, setBusy] = React.useState(false);
	React.useEffect(() => {
		setCustom(current && !current.id ? current.label : '');
	}, [current?.id, current?.label]); // eslint-disable-line react-hooks/exhaustive-deps
	if (!viewer.member || (!choices.templates.length && !choices.custom && !current)) return null;

	const apply = async (request: { flairId?: string | null; text?: string | null }, optimistic: PublicAuthorFlair | null) => {
		if (busy) return;
		setBusy(true);
		const before = current;
		onViewerFlair(optimistic);
		try {
			const resp = (await api.v1.subspaces.setUserFlair({ id: subspace.id, ...request })) as SubspaceMemberResponse;
			onViewerFlair(resp.member?.userFlair ?? null);
			lopu({ title: resp.member?.userFlair ? `Flair on — ${resp.member.userFlair.emoji ? `${resp.member.userFlair.emoji} ` : ''}${resp.member.userFlair.label} 🏷️` : 'Flair removed', status: 'success', duration: 3500 });
		} catch (err: any) {
			onViewerFlair(before ?? null);
			lopu({ title: err?.error || 'Could not change your flair 😞', status: 'error' });
		} finally {
			setBusy(false);
		}
	};
	const pickTemplate = (flair: { id: string; label: string; emoji: string | null; color: string | null }) =>
		current?.id === flair.id ? apply({ flairId: null, text: '' }, null) : apply({ flairId: flair.id }, { id: flair.id, label: flair.label, emoji: flair.emoji, color: flair.color });
	const saveCustom = () => {
		const text = custom.replace(/\s+/g, ' ').trim();
		if (!text) return apply({ flairId: null, text: '' }, null);
		return apply({ flairId: null, text }, { id: null, label: text, emoji: null, color: null });
	};

	return (
		<SidebarCard title="Your flair">
			<Flex alignItems="center" columnGap={2} flexWrap="wrap" minHeight="22px" data-testid="user-flair-current" data-flair-id={current ? current.id || '~custom' : '~none'}>
				<Text fontSize="xs" color={MUTED}>
					{current ? 'You wear' : 'You wear no flair here yet'}
				</Text>
				{current && <AuthorFlairChip flair={current} />}
				{current && (
					<Button size="xs" variant="ghost" borderRadius="999px" color={MUTED} isDisabled={busy} onClick={() => apply({ flairId: null, text: '' }, null)} data-testid="user-flair-clear">
						Take it off ✕
					</Button>
				)}
			</Flex>
			{choices.templates.length > 0 && (
				<Flex columnGap={1} rowGap={1} flexWrap="wrap" data-testid="user-flair-templates">
					{choices.templates.map((flair) => {
						const active = current?.id === flair.id;
						return (
							<Button
								key={flair.id}
								size="xs"
								variant="outline"
								borderRadius="999px"
								fontWeight={600}
								border={`1px solid ${flair.color || 'var(--tt-border, #ececef)'}`}
								color={flair.color || TEXT}
								background={active ? 'var(--tt-surface-hover, #ececee)' : 'transparent'}
								aria-pressed={active}
								isDisabled={busy}
								onClick={() => pickTemplate(flair)}
								title={flair.modOnly ? 'Moderator-only flair' : active ? 'Click to take it off' : `Wear ${flair.label}`}
								data-testid="user-flair-template"
								data-flair-id={flair.id}
							>
								{flair.emoji ? `${flair.emoji} ` : ''}
								{flair.label}
								{flair.modOnly ? ' 🎩' : ''}
								{active ? ' ✓' : ''}
							</Button>
						);
					})}
				</Flex>
			)}
			{choices.custom && (
				<Flex columnGap={2} alignItems="center">
					<Input
						size="xs"
						borderRadius="999px"
						placeholder="Your own words…"
						value={custom}
						maxLength={MAX_CUSTOM_FLAIR_CHARS}
						onChange={(event) => setCustom(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter') saveCustom();
						}}
						data-testid="user-flair-custom"
					/>
					<Button size="xs" borderRadius="999px" flexShrink={0} isDisabled={busy || (!custom.trim() && !(current && !current.id))} onClick={saveCustom} data-testid="user-flair-custom-save">
						Wear it
					</Button>
				</Flex>
			)}
			{!choices.templates.length && !choices.custom && (
				<Text fontSize="xs" color={MUTED}>
					The moderators turned self-service flairs off here.
				</Text>
			)}
		</SidebarCard>
	);
};

export const SubspaceSidebar = (props: { subspace: PublicSubspace; moderators: { userId: string; profile: any; role: string }[]; onViewerFlair?: (flair: PublicAuthorFlair | null) => void }) => {
	const { subspace, moderators, onViewerFlair } = props;
	const access = ACCESS_META[subspace.access];
	return (
		<Flex flexDirection="column" rowGap={3} width="100%">
			{onViewerFlair && <UserFlairCard subspace={subspace} onViewerFlair={onViewerFlair} />}
			<SidebarCard title="About">
				<Text fontSize="sm" color={TEXT} whiteSpace="pre-wrap">
					{subspace.description || 'No description yet.'}
				</Text>
				<Flex columnGap={4} rowGap={1} flexWrap="wrap" fontSize="xs" color={MUTED}>
					<Text as="span" title="Members">
						👥 {subspace.memberCount.toLocaleString()} members
					</Text>
					{typeof subspace.postCount === 'number' && <Text as="span">📝 {subspace.postCount.toLocaleString()} posts</Text>}
					<Text as="span" title={access.hint}>
						{access.emoji} {access.label}
					</Text>
					<Text as="span">🎂 {new Date(subspace.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
				</Flex>
			</SidebarCard>
			{subspace.rules.length > 0 && (
				<SidebarCard title={`Rules · ${subspace.rules.length}`}>
					<Flex as="ol" flexDirection="column" rowGap={2} paddingLeft={4} margin={0}>
						{subspace.rules.map((rule, index) => (
							<Box as="li" key={`${index}-${rule.title}`} fontSize="sm" color={INK}>
								<Text fontWeight={600}>{rule.title}</Text>
								{rule.text && (
									<Text fontSize="xs" color={TEXT} whiteSpace="pre-wrap">
										{rule.text}
									</Text>
								)}
							</Box>
						))}
					</Flex>
				</SidebarCard>
			)}
			{subspace.flairs.length > 0 && (
				<SidebarCard title="Flairs">
					<Flex columnGap={1} rowGap={1} flexWrap="wrap">
						{subspace.flairs.map((flair) => (
							<Text
								key={flair.id}
								as="span"
								fontSize="xs"
								fontWeight={600}
								paddingX={2}
								paddingY="2px"
								borderRadius="999px"
								border={`1px solid ${flair.color || 'var(--tt-border, #ececef)'}`}
								color={flair.color || TEXT}
								title={flair.modOnly ? 'Moderator-only flair' : undefined}
							>
								{flair.emoji ? `${flair.emoji} ` : ''}
								{flair.label}
								{flair.modOnly ? ' 🎩' : ''}
							</Text>
						))}
					</Flex>
				</SidebarCard>
			)}
			<SidebarCard title="Moderators">
				<Flex flexDirection="column" rowGap={1}>
					{moderators.length === 0 && (
						<Text fontSize="xs" color={MUTED}>
							—
						</Text>
					)}
					{moderators.map((mod) => (
						<Flex key={mod.userId} alignItems="center" columnGap={2} fontSize="sm">
							<Text as={Link} to={mod.profile?.username ? `/profile/${mod.profile.username}` : '#'} color={INK} fontWeight={600} _hover={{ textDecoration: 'underline' }}>
								{mod.profile?.displayName || mod.profile?.username || 'Someone'}
							</Text>
							<Text as="span" fontSize="10px" fontWeight={700} letterSpacing="0.06em" textTransform="uppercase" color={MUTED}>
								{mod.role === 'owner' ? '👑 owner' : '🎩 mod'}
							</Text>
						</Flex>
					))}
				</Flex>
			</SidebarCard>
		</Flex>
	);
};

export const SubspacePage = () => {
	const { slug = '' } = useParams();
	const api = useApi();
	const user = useCurrentUser();
	const lopu = useLopu();
	const [prefs] = useSubspacePrefs();
	const [searchParams, setSearchParams] = useSearchParams();
	const sortParam = searchParams.get('sort') as SubspaceFeedSort | null;
	const sort: SubspaceFeedSort = sortParam && SUBSPACE_SORTS.some((entry) => entry.id === sortParam) ? sortParam : prefs.defaultSort;
	const range = (searchParams.get('t') as TopRange | null) || 'all';

	const cacheKey = cacheKeyFor(slug, user?.id);
	const cached = React.useMemo(() => readLocalCache<CachedSubspace>(cacheKey), [cacheKey]);
	const [subspace, setSubspace] = React.useState<PublicSubspace | null>(cached?.subspace || null);
	const [moderators, setModerators] = React.useState<{ userId: string; profile: any; role: string }[]>([]);
	const [posts, setPosts] = React.useState<PublicPost[]>(() => (cached && cached.sort === sort ? mergeReactionOverlays(cached.at, cached.posts) : []));
	const [nextCursor, setNextCursor] = React.useState<string | null>(null);
	const [loading, setLoading] = React.useState(true);
	const [wall, setWall] = React.useState<string | null>(null);
	const [notFound, setNotFound] = React.useState(false);
	const [membershipBusy, setMembershipBusy] = React.useState(false);
	const [approvalBusy, setApprovalBusy] = React.useState(false);

	const requestSeqRef = React.useRef(0);
	const apiRef = React.useRef(api);
	apiRef.current = api;

	// detail (subspace + moderators) — refreshed on slug/viewer change
	React.useEffect(() => {
		let cancelled = false;
		setNotFound(false);
		apiRef.current.v1.subspaces
			.get({ slug })
			.then((resp: any) => {
				if (cancelled) return;
				setSubspace(resp.subspace);
				setModerators(resp.moderators || []);
			})
			.catch((err: any) => {
				if (cancelled) return;
				if (Number(err?.status) === 404) {
					// a deleted subspace must not keep repainting from its cached copy
					clearLocalCache(cacheKey);
					setNotFound(true);
				} else lopu({ title: err?.error || 'Could not load the subspace 😞', status: 'error' });
			});
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [slug, user?.id]);

	const load = React.useCallback(
		async (options: { reset?: boolean; cursor?: string | null } = {}) => {
			const seq = ++requestSeqRef.current;
			const startedAt = Date.now();
			setLoading(true);
			try {
				const resp = (await apiRef.current.v1.subspaces.feed({
					slug,
					sort,
					range: sort === 'top' || sort === 'controversial' ? range : undefined,
					cursor: options.reset ? undefined : options.cursor || undefined,
					limit: 20
				})) as SubspaceFeedResponse;
				if (seq !== requestSeqRef.current) return;
				setWall(null);
				setSubspace((prev) => (prev ? { ...prev, ...resp.subspace, postCount: prev.postCount } : resp.subspace));
				const page = mergeReactionOverlays(startedAt, resp.posts || []);
				setPosts((prev) => {
					const next = options.reset ? page : [...prev, ...page.filter((post) => !prev.some((existing) => existing.id === post.id))];
					if (options.reset) writeLocalCache(cacheKey, { at: startedAt, subspace: resp.subspace, posts: next.slice(0, 20), sort } satisfies CachedSubspace);
					return next;
				});
				setNextCursor(resp.nextCursor ?? null);
			} catch (err: any) {
				if (seq !== requestSeqRef.current) return;
				if (Number(err?.status) === 403) {
					setWall(err?.error || 'This subspace is private 🔒');
					setPosts([]);
				} else if (Number(err?.status) === 404) {
					clearLocalCache(cacheKey);
					setNotFound(true);
				} else {
					lopu({ title: err?.error || 'Could not load posts 😞', status: 'error' });
				}
				setNextCursor(null);
			} finally {
				if (seq === requestSeqRef.current) setLoading(false);
			}
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[slug, sort, range, cacheKey]
	);

	React.useEffect(() => {
		load({ reset: true });
	}, [load, user?.id]);

	const setParam = (key: string, value: string | null) => {
		const next = new URLSearchParams(searchParams);
		if (value) next.set(key, value);
		else next.delete(key);
		setSearchParams(next, { replace: true });
	};

	const handlePostChanged = React.useCallback((id: string, next: PostChange) => {
		setPosts((prev) =>
			prev.flatMap((post) => {
				if (post.id !== id) return [post];
				const resolved = typeof next === 'function' ? next(post) : next;
				return resolved ? [resolved] : [];
			})
		);
	}, []);

	const handlePosted = React.useCallback((post: PublicPost) => {
		setPosts((prev) => [post, ...prev]);
		setSubspace((prev) => (prev && typeof prev.postCount === 'number' ? { ...prev, postCount: prev.postCount + 1 } : prev));
	}, []);

	// the viewer's own flair changed (Your flair card): the header state and
	// every card of theirs on this page repaint at once
	const handleViewerFlair = React.useCallback(
		(flair: PublicAuthorFlair | null) => {
			setSubspace((prev) => (prev ? { ...prev, viewer: { ...prev.viewer, userFlair: flair } } : prev));
			if (!user?.id) return;
			const paintComment = (comment: any): any => (comment?.author?.id === user.id ? { ...comment, authorFlair: flair, comments: comment.comments?.map(paintComment) } : comment?.comments ? { ...comment, comments: comment.comments.map(paintComment) } : comment);
			setPosts((prev) => prev.map((post) => ({ ...(post.author?.id === user.id ? { ...post, authorFlair: flair } : post), comments: (post.comments || []).map(paintComment) })));
		},
		[user?.id]
	);

	// Join / leave — and, for a PRIVATE subspace, request to join / cancel the
	// request. Paints first (count ±1, button flips), reconciles from the
	// response, reverts on failure.
	const toggleMembership = async () => {
		if (!subspace) return;
		if (!user) {
			lopu({ title: 'Log in to join subspaces 🗝️', status: 'info', duration: 6000 });
			return;
		}
		if (membershipBusy) return;
		setMembershipBusy(true);
		const { viewer } = subspace;
		// an active membership ends, a pending request is cancelled. A request
		// only exists on a PRIVATE subspace (the server resolves them when the
		// access mode changes); a stray pending flag anywhere else is a plain
		// "Join" — the same call activates the row.
		const pendingRequest = viewer.pending && subspace.access === 'private';
		const leaving = viewer.member || pendingRequest;
		const requesting = !leaving && subspace.access === 'private';
		const before = subspace;
		setSubspace({
			...subspace,
			memberCount: Math.max(0, subspace.memberCount + (leaving ? (viewer.member ? -1 : 0) : requesting ? 0 : 1)),
			viewer: {
				...viewer,
				member: !leaving && !requesting,
				pending: requesting,
				approvalRequested: leaving ? false : viewer.approvalRequested,
				role: leaving || requesting ? null : viewer.role || 'member'
			}
		});
		try {
			const resp = leaving ? ((await api.v1.subspaces.leave({ id: subspace.id })) as { subspace?: PublicSubspace }) : ((await api.v1.subspaces.join({ id: subspace.id })) as SubspaceJoinResponse);
			if (resp?.subspace) setSubspace((prev) => ({ ...(prev || resp.subspace!), ...resp.subspace!, postCount: prev?.postCount }));
			const pendingNow = !leaving && 'pending' in resp && resp.pending;
			lopu({
				title: leaving
					? pendingRequest
						? `Join request to s/${subspace.slug} cancelled`
						: `Left s/${subspace.slug}`
					: pendingNow
						? `Asked to join s/${subspace.slug} 🙋`
						: `Joined s/${subspace.slug} 🪐`,
				description: pendingNow ? 'The moderators will take a look — you’ll get a notification when you’re in.' : undefined,
				status: 'success',
				duration: pendingNow ? 6000 : 4000
			});
			if (!leaving && !pendingNow && wall) load({ reset: true });
		} catch (err: any) {
			setSubspace(before);
			lopu({ title: err?.error || 'Could not update your membership 😞', status: 'error' });
		} finally {
			setMembershipBusy(false);
		}
	};

	// Restricted subspaces: an active, unapproved member asks the mods for
	// posting rights (paints "Approval requested ✓" first, reverts on failure).
	const requestApproval = async () => {
		if (!subspace || approvalBusy) return;
		if (!user) {
			lopu({ title: 'Log in to ask for posting approval 🗝️', status: 'info', duration: 6000 });
			return;
		}
		setApprovalBusy(true);
		const before = subspace;
		setSubspace({ ...subspace, viewer: { ...subspace.viewer, approvalRequested: true } });
		try {
			const resp = (await api.v1.subspaces.requestApproval({ id: subspace.id })) as SubspaceMemberResponse;
			setSubspace((prev) => (prev ? { ...prev, viewer: { ...prev.viewer, approvalRequested: resp.member?.approvalRequested !== false, approved: resp.member?.approved === true } } : prev));
			lopu({ title: `Asked the mods of s/${subspace.slug} for posting approval ✋`, description: 'You’ll be able to post here once a moderator approves you.', status: 'success', duration: 6000 });
		} catch (err: any) {
			setSubspace(before);
			lopu({ title: err?.error || 'Could not send the request 😞', status: 'error' });
		} finally {
			setApprovalBusy(false);
		}
	};

	const accent = subspaceAccent(subspace);
	const isOwner = subspace?.viewer.role === 'owner';
	const viewer = subspace?.viewer;
	const openRequests = openRequestCount(subspace);
	// the Mod tools 🎩 badge counts everything waiting for a mod: requests +
	// open reports; the button opens whichever queue has work (requests first)
	const modQueue = modQueueCount(subspace);
	// a join request is a private-subspace state only (see toggleMembership)
	const viewerPending = !!viewer?.pending && subspace?.access === 'private';
	// join button copy per state (private subspaces request instead of join)
	const joinLabel = !viewer
		? 'Join'
		: viewer.banned
			? 'Banned 🚫'
			: viewer.member
				? 'Joined ✓'
				: viewerPending
					? 'Requested ✓ · cancel'
					: subspace!.access === 'private'
						? 'Request to join 🔒'
						: 'Join';

	if (notFound) {
		return (
			<Flex justifyContent="center" width="100%" minHeight="100vh" paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))">
				<Flex flexDirection="column" alignItems="center" rowGap={3} paddingTop={24} paddingX={4} width="100%">
					<Text fontSize="4xl">🌫️</Text>
					<Text fontSize="lg" fontWeight={700} color={INK}>
						s/{slug} doesn’t exist
					</Text>
					<Button as={Link} to="/s?create=1" size="sm" borderRadius={RADIUS_MD}>
						Found it yourself ➕
					</Button>
				</Flex>
			</Flex>
		);
	}

	return (
		<Flex
			justifyContent="center"
			width="100%"
			minHeight="100vh"
			background="var(--tt-surface, #fafafb)"
			paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))"
			paddingBottom={16}
		>
			{/* Reddit-style full-width layout: no fixed container — the header spans
			the viewport, the post column takes every pixel the sidebar leaves, and
			the sidebar is a fixed-width sticky rail on wide screens (stacked below
			the posts under the `lg` breakpoint). Gutters scale with the viewport. */}
			<Flex flexDirection="column" rowGap={4} width="100%" paddingX={[3, 4, 6, 8]} paddingTop={[3, 4, 5]}>
				{/* banner + identity */}
				<Box background="var(--tt-card, #ffffff)" border={BORDER} borderRadius={RADIUS_LG} overflow="hidden" data-testid="subspace-header">
					<Box
						height={['96px', '140px']}
						background={subspace?.branding.bannerUrl ? `center / cover no-repeat url(${JSON.stringify(subspace.branding.bannerUrl)})` : `linear-gradient(120deg, ${accent}, var(--tt-surface-alt, #f5f5f7))`}
					/>
					<Flex alignItems="flex-end" columnGap={3} rowGap={2} flexWrap="wrap" paddingX={[4, 5]} paddingBottom={4} marginTop="-28px">
						{subspace ? <SubspaceIcon subspace={subspace} size="64px" fontSize="3xl" /> : <Box width="64px" height="64px" borderRadius="999px" background="var(--tt-surface-alt, #f5f5f7)" />}
						<Box flex="1" minWidth="160px" paddingTop={7}>
							<Flex alignItems="center" columnGap={2} flexWrap="wrap">
								<Text as="h1" fontFamily="heading" fontSize="2xl" fontWeight={700} letterSpacing="-0.02em" color={INK} lineHeight="1.1">
									{subspace?.name || `s/${slug}`}
								</Text>
								{subspace?.nsfw && (
									<Text as="span" fontSize="10px" fontWeight={700} color="var(--tt-danger, #e5484d)" border="1px solid currentColor" borderRadius="999px" paddingX={1.5}>
										18+
									</Text>
								)}
							</Flex>
							<Flex alignItems="center" columnGap={3} fontSize="xs" color={MUTED} flexWrap="wrap">
								<Text as="span" fontFamily="mono">
									s/{slug}
								</Text>
								{subspace && (
									<>
										<Text as="span">👥 {subspace.memberCount.toLocaleString()}</Text>
										{subspace.access !== 'public' && (
											<Text as="span" title={ACCESS_META[subspace.access].hint}>
												{ACCESS_META[subspace.access].emoji} {ACCESS_META[subspace.access].label}
											</Text>
										)}
									</>
								)}
							</Flex>
						</Box>
						<Flex alignItems="center" columnGap={2} paddingTop={7}>
							{subspace?.viewer.canModerate && (
								<Button
									as={Link}
									to={openRequests > 0 ? `/s/${slug}/mod?tab=requests` : modQueue > 0 ? `/s/${slug}/mod?tab=reports` : `/s/${slug}/mod`}
									size="sm"
									variant="outline"
									borderRadius="999px"
									borderColor="var(--tt-border, #ececef)"
									color={INK}
									data-testid="subspace-mod-tools"
									data-open-requests={openRequests}
									data-open-reports={subspace.openReportCount || 0}
								>
									Mod tools 🎩
									{modQueue > 0 && (
										<Text as="span" marginLeft={2} fontSize="10px" fontWeight={700} lineHeight="1" paddingX={1.5} paddingY="3px" borderRadius="999px" background={accent} color="white" title={`${openRequests} open request${openRequests === 1 ? '' : 's'} · ${subspace.openReportCount || 0} open report${(subspace.openReportCount || 0) === 1 ? '' : 's'}`} data-testid="subspace-mod-tools-badge">
											{modQueue}
										</Text>
									)}
								</Button>
							)}
							{subspace && viewer && !isOwner && (
								<Button
									size="sm"
									borderRadius="999px"
									variant={viewer.member || viewerPending ? 'outline' : 'solid'}
									background={viewer.member || viewerPending ? 'transparent' : accent}
									color={viewer.member || viewerPending ? INK : 'white'}
									borderColor="var(--tt-border, #ececef)"
									_hover={{ opacity: 0.85 }}
									isLoading={membershipBusy}
									isDisabled={viewer.banned}
									onClick={toggleMembership}
									title={viewerPending ? 'Your join request is waiting for a moderator — click to cancel it' : undefined}
									data-testid="subspace-join"
									data-membership={viewer.member ? 'member' : viewerPending ? 'pending' : 'none'}
								>
									{joinLabel}
								</Button>
							)}
						</Flex>
					</Flex>
				</Box>

				<Flex columnGap={[4, 4, 6, 8]} rowGap={4} alignItems="flex-start" flexDirection={['column', 'column', 'column', 'row']}>
					{/* main column — full width, no max */}
					<Flex flexDirection="column" rowGap={3} flex="1" minWidth={0} width="100%">
						{/* sort tabs */}
						<Flex alignItems="center" columnGap={1} rowGap={1} flexWrap="wrap" data-testid="subspace-sorts">
							{SUBSPACE_SORTS.map((entry) => {
								const active = entry.id === sort;
								return (
									<Button
										key={entry.id}
										size="xs"
										borderRadius="999px"
										variant="ghost"
										background={active ? 'var(--tt-surface-hover, #ececee)' : 'transparent'}
										color={active ? INK : MUTED}
										fontWeight={active ? 700 : 600}
										onClick={() => setParam('sort', entry.id)}
										aria-pressed={active}
										data-sort={entry.id}
									>
										{entry.emoji} {entry.label}
									</Button>
								);
							})}
							{(sort === 'top' || sort === 'controversial') && (
								<Select size="xs" width="130px" borderRadius="999px" marginLeft="auto" value={range} onChange={(event) => setParam('t', event.target.value === 'all' ? null : event.target.value)} aria-label="Time range">
									{TOP_RANGES.map((entry) => (
										<option key={entry.id} value={entry.id}>
											{entry.label}
										</option>
									))}
								</Select>
							)}
						</Flex>

						{subspace?.viewer.banned && (
							<Flex border={BORDER} borderRadius={RADIUS_MD} padding={3} fontSize="sm" color={TEXT} background="var(--tt-card, #ffffff)">
								🚫 You are banned from s/{slug}
								{subspace.viewer.banReason ? ` — ${subspace.viewer.banReason}` : ''}
								{subspace.viewer.banUntil ? ` (until ${new Date(subspace.viewer.banUntil).toLocaleDateString()})` : ''}
							</Flex>
						)}
						{user && subspace && subspace.viewer.canPost && !wall && <PostComposer onPosted={handlePosted} subspace={composerContextOf(subspace)} />}
						{user && subspace && viewer && !viewer.canPost && !viewer.banned && !wall && (
							<Flex alignItems="center" columnGap={2} rowGap={1} flexWrap="wrap" paddingX={1} data-testid="subspace-post-hint">
								<Text fontSize="xs" color={MUTED}>
									{subspace.access === 'restricted'
										? viewer.member
											? viewer.approvalRequested
												? '✋ Only approved posters can post here — your request is with the moderators.'
												: '✋ Only approved posters can post here — ask the moderators.'
											: '✋ Only approved posters can post here — join, then ask the moderators.'
										: subspace.access === 'private'
											? viewer.pending
												? '🔒 Members only — your join request is waiting for a moderator.'
												: '🔒 Members only.'
											: ''}
								</Text>
								{subspace.access === 'restricted' && viewer.member && (
									<Button
										size="xs"
										borderRadius="999px"
										variant={viewer.approvalRequested ? 'ghost' : 'outline'}
										color={viewer.approvalRequested ? MUTED : INK}
										borderColor="var(--tt-border, #ececef)"
										isDisabled={viewer.approvalRequested}
										isLoading={approvalBusy}
										onClick={requestApproval}
										data-testid="subspace-request-approval"
									>
										{viewer.approvalRequested ? 'Approval requested ✓' : 'Request posting approval ✋'}
									</Button>
								)}
							</Flex>
						)}

						{wall ? (
							<Flex flexDirection="column" alignItems="center" rowGap={2} paddingY={16} border="1px dashed var(--tt-border, #ececef)" borderRadius={RADIUS_LG} data-testid="subspace-wall">
								<Text fontSize="3xl">{viewer?.pending ? '🙋' : '🔒'}</Text>
								<Text fontSize="sm" color={MUTED} textAlign="center" whiteSpace="normal" paddingX={6}>
									{wall}
								</Text>
								{viewer?.pending && (
									<Text fontSize="xs" color={TEXT} textAlign="center" whiteSpace="normal" paddingX={6} data-testid="subspace-wall-pending">
										Your join request is waiting for a moderator — you’ll get a notification when you’re in.
									</Text>
								)}
								{user && subspace && !viewer?.pending && !viewer?.banned && subspace.access === 'private' && (
									<Text fontSize="xs" color={TEXT} textAlign="center" whiteSpace="normal" paddingX={6}>
										Use <Text as="strong">Request to join 🔒</Text> above — a moderator lets you in.
									</Text>
								)}
							</Flex>
						) : (
							<PostList
								posts={posts}
								loading={loading}
								hasMore={!!nextCursor}
								onLoadMore={() => nextCursor && load({ cursor: nextCursor })}
								onPostChanged={handlePostChanged}
								emptyLabel={subspace?.viewer.canPost ? 'Nothing here yet — start the first thread ✨' : 'Nothing here yet ✨'}
							/>
						)}
					</Flex>

					{/* sidebar — fixed rail, sticky under the nav on wide screens */}
					<Box
						width={['100%', '100%', '100%', '320px', '340px']}
						flexShrink={0}
						position={['static', 'static', 'static', 'sticky']}
						top="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 16px)"
						maxHeight={['none', 'none', 'none', 'calc(100vh - var(--tt-nav-clearance, 54px) - 32px)']}
						overflowY={['visible', 'visible', 'visible', 'auto']}
						data-testid="subspace-sidebar"
					>
						{subspace && <SubspaceSidebar subspace={subspace} moderators={moderators} onViewerFlair={user ? handleViewerFlair : undefined} />}
					</Box>
				</Flex>
			</Flex>
		</Flex>
	);
};
