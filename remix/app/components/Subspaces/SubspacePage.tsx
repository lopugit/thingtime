import React from 'react';
import { Box, Button, Flex, Select, Text } from '@chakra-ui/react';
import { Link, useParams, useSearchParams } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { clearLocalCache, readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useLopu } from '~/components/Lopu/useLopu';
import { PostComposer } from '~/components/Feed/PostComposer';
import { PostList } from '~/components/Feed/PostList';
import { mergeReactionOverlays } from '~/components/Feed/reactionOverlay';
import type { PostChange, PublicPost } from '~/components/Feed/feedTypes';
import { SubspaceIcon } from './SubspaceCard';
import { useSubspacePrefs } from './useSubspacePrefs';
import {
	ACCESS_META,
	composerContextOf,
	subspaceAccent,
	SUBSPACE_SORTS,
	TOP_RANGES,
	type PublicSubspace,
	type SubspaceFeedResponse,
	type SubspaceFeedSort,
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

export const SubspaceSidebar = (props: { subspace: PublicSubspace; moderators: { userId: string; profile: any; role: string }[] }) => {
	const { subspace, moderators } = props;
	const access = ACCESS_META[subspace.access];
	return (
		<Flex flexDirection="column" rowGap={3} width="100%">
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

	const toggleMembership = async () => {
		if (!subspace) return;
		if (!user) {
			lopu({ title: 'Log in to join subspaces 🗝️', status: 'info', duration: 6000 });
			return;
		}
		if (membershipBusy) return;
		setMembershipBusy(true);
		const joining = !subspace.viewer.member;
		const before = subspace;
		setSubspace({
			...subspace,
			memberCount: Math.max(0, subspace.memberCount + (joining ? 1 : -1)),
			viewer: { ...subspace.viewer, member: joining, role: joining ? subspace.viewer.role || 'member' : null }
		});
		try {
			const resp: any = joining ? await api.v1.subspaces.join({ id: subspace.id }) : await api.v1.subspaces.leave({ id: subspace.id });
			if (resp?.subspace) setSubspace((prev) => ({ ...(prev || resp.subspace), ...resp.subspace, postCount: prev?.postCount }));
			lopu({ title: joining ? `Joined s/${subspace.slug} 🪐` : `Left s/${subspace.slug}`, status: 'success', duration: 4000 });
			if (joining && wall) load({ reset: true });
		} catch (err: any) {
			setSubspace(before);
			lopu({ title: err?.error || 'Could not update your membership 😞', status: 'error' });
		} finally {
			setMembershipBusy(false);
		}
	};

	const accent = subspaceAccent(subspace);
	const isOwner = subspace?.viewer.role === 'owner';

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
								<Button as={Link} to={`/s/${slug}/mod`} size="sm" variant="outline" borderRadius="999px" borderColor="var(--tt-border, #ececef)" color={INK} data-testid="subspace-mod-tools">
									Mod tools 🎩
								</Button>
							)}
							{subspace && !isOwner && (
								<Button
									size="sm"
									borderRadius="999px"
									variant={subspace.viewer.member ? 'outline' : 'solid'}
									background={subspace.viewer.member ? 'transparent' : accent}
									color={subspace.viewer.member ? INK : 'white'}
									borderColor="var(--tt-border, #ececef)"
									_hover={{ opacity: 0.85 }}
									isLoading={membershipBusy}
									isDisabled={subspace.viewer.banned || (subspace.access === 'private' && !subspace.viewer.member)}
									onClick={toggleMembership}
									data-testid="subspace-join"
								>
									{subspace.viewer.banned ? 'Banned 🚫' : subspace.viewer.member ? 'Joined ✓' : subspace.access === 'private' ? 'Private 🔒' : 'Join'}
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
						{user && subspace && !subspace.viewer.canPost && !subspace.viewer.banned && !wall && (
							<Text fontSize="xs" color={MUTED} paddingX={1}>
								{subspace.access === 'restricted' ? '✋ Only approved posters can post here — ask a moderator.' : subspace.access === 'private' ? '🔒 Members only.' : ''}
							</Text>
						)}

						{wall ? (
							<Flex flexDirection="column" alignItems="center" rowGap={2} paddingY={16} border="1px dashed var(--tt-border, #ececef)" borderRadius={RADIUS_LG} data-testid="subspace-wall">
								<Text fontSize="3xl">🔒</Text>
								<Text fontSize="sm" color={MUTED} textAlign="center" whiteSpace="normal" paddingX={6}>
									{wall}
								</Text>
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
						{subspace && <SubspaceSidebar subspace={subspace} moderators={moderators} />}
					</Box>
				</Flex>
			</Flex>
		</Flex>
	);
};
