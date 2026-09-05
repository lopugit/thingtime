import React from 'react';
import { Box, Button, Flex, Input, Text } from '@chakra-ui/react';
import { useSearchParams } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useLopu } from '~/components/Lopu/useLopu';
import { RAINBOW, RAINBOW_TEXT } from '~/theme/rainbow';
import { CreateSubspaceModal } from './CreateSubspaceModal';
import { SubspaceCard } from './SubspaceCard';
import type { PublicSubspace } from './subspaceTypes';

// The /s directory: search + browse every subspace (newest first), a "Mine"
// filter for the viewer's memberships, join/leave straight from the row, and
// the create modal (?create=1 deep-links it, e.g. from the drawer). Optimistic
// first paint from the sync localCache tier (tt-subspaces-<viewer>-<mode>).

const INK = 'var(--tt-ink, #16161a)';
const MUTED = 'var(--tt-muted, #9a9aa6)';
const BORDER = '1px solid var(--tt-border, #ececef)';
const RADIUS_MD = 'var(--tt-radius-md, 12px)';

type CachedDirectory = { at: number; subspaces: PublicSubspace[] };
const cacheKeyFor = (viewerId: string | null | undefined, mine: boolean) => `tt-subspaces-${viewerId || 'anon'}-${mine ? 'mine' : 'all'}`;

export const SubspacesDirectoryPage = () => {
	const api = useApi();
	const user = useCurrentUser();
	const lopu = useLopu();
	const [searchParams, setSearchParams] = useSearchParams();
	const mine = searchParams.get('mine') === '1' && !!user;
	const createOpen = searchParams.get('create') === '1' && !!user;

	const [query, setQuery] = React.useState(searchParams.get('q') || '');
	const cacheKey = cacheKeyFor(user?.id, mine);
	const [subspaces, setSubspaces] = React.useState<PublicSubspace[]>(() => readLocalCache<CachedDirectory>(cacheKey)?.subspaces || []);
	const [nextCursor, setNextCursor] = React.useState<string | null>(null);
	const [loading, setLoading] = React.useState(subspaces.length === 0);
	const [busyId, setBusyId] = React.useState<string | null>(null);

	const requestSeqRef = React.useRef(0);
	const apiRef = React.useRef(api);
	apiRef.current = api;

	const load = React.useCallback(
		async (options: { reset?: boolean; cursor?: string | null; q?: string } = {}) => {
			const seq = ++requestSeqRef.current;
			const q = options.q ?? query;
			if (options.reset && !subspaces.length) setLoading(true);
			try {
				const resp: any = await apiRef.current.v1.subspaces.list({ q: q || undefined, mine, cursor: options.cursor || undefined, limit: 30 });
				if (seq !== requestSeqRef.current) return;
				const page: PublicSubspace[] = resp.subspaces || [];
				setSubspaces((prev) => {
					const next = options.reset ? page : [...prev, ...page.filter((entry) => !prev.some((existing) => existing.id === entry.id))];
					if (!q) writeLocalCache(cacheKey, { at: Date.now(), subspaces: next.slice(0, 30) } satisfies CachedDirectory);
					return next;
				});
				setNextCursor(resp.nextCursor ?? null);
			} catch (err: any) {
				if (seq !== requestSeqRef.current) return;
				lopu({ title: err?.error || 'Could not load subspaces 😞', status: 'error' });
			} finally {
				if (seq === requestSeqRef.current) setLoading(false);
			}
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[mine, cacheKey, query]
	);

	// initial + mode/viewer change: re-seed from that slot's cache, then refetch
	React.useEffect(() => {
		const seeded = readLocalCache<CachedDirectory>(cacheKey)?.subspaces || [];
		setSubspaces(seeded);
		setLoading(seeded.length === 0);
		load({ reset: true });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [cacheKey]);

	// debounced search
	React.useEffect(() => {
		const handle = setTimeout(() => load({ reset: true, q: query }), query ? 250 : 0);
		return () => clearTimeout(handle);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [query]);

	const setParam = (key: string, value: string | null) => {
		const next = new URLSearchParams(searchParams);
		if (value) next.set(key, value);
		else next.delete(key);
		setSearchParams(next, { replace: true });
	};

	const toggleMembership = async (subspace: PublicSubspace) => {
		if (!user) {
			lopu({ title: 'Log in to join subspaces 🗝️', status: 'info', duration: 6000 });
			return;
		}
		if (busyId) return;
		setBusyId(subspace.id);
		const joining = !subspace.viewer.member;
		// optimistic: flip membership + count instantly, revert on failure
		const patch = (entry: PublicSubspace, member: boolean, delta: number): PublicSubspace => ({
			...entry,
			memberCount: Math.max(0, entry.memberCount + delta),
			viewer: { ...entry.viewer, member, role: member ? entry.viewer.role || 'member' : null }
		});
		setSubspaces((prev) => prev.map((entry) => (entry.id === subspace.id ? patch(entry, joining, joining ? 1 : -1) : entry)));
		try {
			const resp: any = joining ? await api.v1.subspaces.join({ id: subspace.id }) : await api.v1.subspaces.leave({ id: subspace.id });
			if (resp?.subspace) setSubspaces((prev) => prev.map((entry) => (entry.id === subspace.id ? { ...entry, ...resp.subspace } : entry)));
			lopu({ title: joining ? `Joined s/${subspace.slug} 🪐` : `Left s/${subspace.slug}`, status: 'success', duration: 4000 });
		} catch (err: any) {
			setSubspaces((prev) => prev.map((entry) => (entry.id === subspace.id ? patch(entry, !joining, joining ? -1 : 1) : entry)));
			lopu({ title: err?.error || 'Could not update your membership 😞', status: 'error' });
		} finally {
			setBusyId(null);
		}
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
			{/* full-width, Reddit-style: header + search span the viewport and the
			cards flow in a responsive grid (one column on phones, as many
			~340px columns as fit on wide screens) */}
			<Flex flexDirection="column" rowGap={4} width="100%" paddingX={[3, 4, 6, 8]} paddingTop={[3, 4, 5]}>
				<Flex flexDirection="column" rowGap={1}>
					<Box fontFamily="mono" fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color={MUTED}>
						Thingtime · communities you can join, run and moderate 🪐
					</Box>
					<Flex alignItems="center" columnGap={3}>
						<Box
							as="h1"
							fontFamily="heading"
							fontSize="2xl"
							fontWeight={700}
							letterSpacing="-0.02em"
							background={RAINBOW_TEXT}
							backgroundSize="calc(100px + 200%)"
							sx={{
								WebkitBackgroundClip: 'text',
								backgroundClip: 'text',
								WebkitTextFillColor: 'transparent',
								animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)'
							}}
						>
							Subspaces 🪐
						</Box>
						{user && (
							<Button
								marginLeft="auto"
								size="sm"
								color="white"
								fontFamily="heading"
								fontWeight={600}
								background={RAINBOW}
								backgroundSize="calc(100px + 200%)"
								sx={{ animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)' }}
								_hover={{ opacity: 0.9 }}
								borderRadius={RADIUS_MD}
								onClick={() => setParam('create', '1')}
								data-testid="subspaces-create"
							>
								Create ➕
							</Button>
						)}
					</Flex>
				</Flex>

				<Flex alignItems="center" columnGap={2} rowGap={2} flexWrap="wrap">
					<Input
						size="sm"
						flex="1"
						minWidth="180px"
						borderRadius={RADIUS_MD}
						placeholder="Search subspaces 🔍"
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setParam('q', event.target.value || null);
						}}
						aria-label="Search subspaces"
					/>
					{user && (
						<Flex border={BORDER} borderRadius="999px" padding="2px" columnGap="2px">
							{[
								{ id: 'all', label: 'All' },
								{ id: 'mine', label: 'Mine ⭐' }
							].map((tab) => {
								const active = tab.id === 'mine' ? mine : !mine;
								return (
									<Button
										key={tab.id}
										size="xs"
										borderRadius="999px"
										variant="ghost"
										background={active ? 'var(--tt-surface-hover, #ececee)' : 'transparent'}
										color={active ? INK : MUTED}
										onClick={() => setParam('mine', tab.id === 'mine' ? '1' : null)}
										aria-pressed={active}
									>
										{tab.label}
									</Button>
								);
							})}
						</Flex>
					)}
				</Flex>

				<Flex flexDirection="column" rowGap={3}>
					<Box display="grid" gridTemplateColumns={['1fr', '1fr', 'repeat(auto-fill, minmax(340px, 1fr))']} gap={3} data-testid="subspaces-grid">
						{subspaces.map((subspace) => (
							<SubspaceCard key={subspace.id} subspace={subspace} onToggleMembership={toggleMembership} busy={busyId === subspace.id} />
						))}
					</Box>
					{!loading && subspaces.length === 0 && (
						<Flex
							flexDirection="column"
							alignItems="center"
							rowGap={2}
							paddingY={16}
							border="1px dashed var(--tt-border, #ececef)"
							borderRadius="var(--tt-radius-lg, 16px)"
						>
							<Text fontSize="3xl">🪐</Text>
							<Text fontSize="sm" color={MUTED} textAlign="center" whiteSpace="normal" paddingX={6}>
								{mine ? 'You haven’t joined any subspaces yet — browse All and jump in ✨' : query ? 'No subspace matches that — found one yourself? ✨' : 'No subspaces yet — be the first to found one ✨'}
							</Text>
						</Flex>
					)}
					{loading && subspaces.length === 0 && (
						<Text fontSize="sm" color={MUTED} textAlign="center" paddingY={8}>
							Loading subspaces…
						</Text>
					)}
					{nextCursor && !loading && (
						<Button size="sm" variant="outline" borderRadius={RADIUS_MD} borderColor="var(--tt-border, #ececef)" alignSelf="center" onClick={() => load({ cursor: nextCursor })}>
							Load more ⬇️
						</Button>
					)}
				</Flex>
			</Flex>
			<CreateSubspaceModal isOpen={createOpen} onClose={() => setParam('create', null)} onCreated={(created) => setSubspaces((prev) => [created, ...prev])} />
		</Flex>
	);
};
