import React from 'react';
import { Box, Button, Center, Flex, Text } from '@chakra-ui/react';
import { Link, useNavigate } from 'react-router';
import { SlidersHorizontal } from 'lucide-react';

import { ActivityHeatmap } from './ActivityHeatmap';
import { EditProfileModal } from './EditProfileModal';
import { RelationshipControls } from './RelationshipControls';
import {
  AdvancedFilters,
  advancedSearchBody,
  searchResponsePosts,
  useAdvancedFilters,
  type AdvancedFiltersState
} from '~/components/Feed/AdvancedFilters';
import { PostComposer } from '~/components/Feed/PostComposer';
import { PostList } from '~/components/Feed/PostList';
import { mergeReactionOverlays } from '~/components/Feed/reactionOverlay';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';
import { RAINBOW, RAINBOW_TEXT } from '~/theme/rainbow';
import type { PostChange, PublicPost, PublicProfile } from '~/components/Feed/feedTypes';
import { LOGIN_TO_CLAIM_LABEL, getUserDisplayName, getUserIdentityDetail, getUserMention } from '~/utils/userIdentity';

// Full profile page. SELF mode (no username param, or the param is the logged-in
// user) shows email/verification + edit/logout controls; PUBLIC mode fetches the
// stripped PublicProfile projection for any other username. Self profiles get
// the feed composer above their posts; every profile gets an Advanced search
// panel locked to that user's posts (the same structured search as /feed).

export type ProfilePageProps = {
  username?: string;
};

type RemoteProfileState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; profile: PublicProfile; postCount: number }
  | { status: 'missing' };

const POSTS_PAGE_SIZE = 20;

const RAINBOW_ANIM = 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)';

const formatJoined = (iso: string): string | null => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date);
};

// Banner strip: image when a URL is set, animated rainbow fallback otherwise.
// Shared with EditProfileModal's live preview.
export const ProfileBanner = (props: { bannerUrl: string | null; height: string | string[]; radius?: string }) => {
  const src = (props.bannerUrl || '').trim();

  return (
    <Box
      width="100%"
      height={props.height}
      borderRadius={props.radius ?? 'var(--tt-radius-lg, 16px)'}
      overflow="hidden"
      background="var(--tt-surface-alt, #f5f5f7)"
      flexShrink={0}
    >
      {src ? (
				<Box as="img" src={src} alt="" referrerPolicy="no-referrer" width="100%" height="100%" objectFit="cover" display="block" />
      ) : (
				<Box width="100%" height="100%" background={RAINBOW} backgroundSize="calc(100px + 200%)" sx={{ animation: RAINBOW_ANIM }} />
      )}
    </Box>
  );
};

// Avatar circle: image when a URL is set, rainbow initial otherwise (the
// UserAvatarCircle idiom, sized). Shared with EditProfileModal's live preview.
export const ProfileAvatarCircle = (props: { avatarUrl: string | null; name: string; size: string; fontSize?: string; borderWidth?: string }) => {
  const src = (props.avatarUrl || '').trim();
  const initial = (props.name || '?').trim().charAt(0).toUpperCase() || '?';

  return (
    <Center
      flexShrink={0}
      width={props.size}
      height={props.size}
      borderRadius="999px"
      overflow="hidden"
      border={props.borderWidth ? `${props.borderWidth} solid var(--tt-card, #ffffff)` : undefined}
      background={src ? 'var(--tt-surface-alt, #f5f5f7)' : RAINBOW}
      color="white"
      fontFamily="heading"
      fontWeight={700}
      fontSize={props.fontSize || '2xl'}
    >
			{src ? <Box as="img" src={src} alt="" referrerPolicy="no-referrer" width="100%" height="100%" objectFit="cover" display="block" /> : initial}
    </Center>
  );
};

const Eyebrow = (props: { children: React.ReactNode }) => (
	<Text fontFamily="mono" fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)">
    {props.children}
  </Text>
);

export const ProfilePage = (props: ProfilePageProps) => {
  const { username } = props;

  const user = useCurrentUser();
  const api = useApi();
  const navigate = useNavigate();
  const lopu = useLopu();

  // latest-ref so async loaders never retrigger effects via lopu identity
  const lopuRef = React.useRef(lopu);
  lopuRef.current = lopu;

  const isSelf = Boolean(user && (!username || username.toLowerCase() === user.username.toLowerCase()));

  // public profile fetch (other usernames only)
  const getProfile = api.v1.profile.get;
  const [remote, setRemote] = React.useState<RemoteProfileState>({ status: 'idle' });

  React.useEffect(() => {
    if (!username || isSelf) {
      setRemote({ status: 'idle' });
      return;
    }

    let cancelled = false;
    setRemote({ status: 'loading' });

    getProfile({ username })
      .then((resp: any) => {
        if (cancelled) return;
        if (resp?.profile) {
          setRemote({
            status: 'loaded',
            profile: resp.profile,
            postCount: typeof resp?.postCount === 'number' ? resp.postCount : 0
          });
        } else {
          setRemote({ status: 'missing' });
        }
      })
      .catch(() => {
        if (!cancelled) setRemote({ status: 'missing' });
      });

    return () => {
      cancelled = true;
    };
  }, [username, isSelf, getProfile]);

  // posts pager — self posts load immediately; public posts wait for the
  // profile to resolve so a missing user never fires a second failing fetch
  const postsUsername = isSelf && user ? user.username : remote.status === 'loaded' ? remote.profile.username : null;

  const fetchUserPosts = api.v1.things.userPosts;
  // latest-ref (the Feed page's apiRef idiom): search is memoized on the
  // fetcher, whose identity can change per render — a plain dep would retrigger
  // the pager effect forever
  const searchThingsRef = React.useRef(api.v1.things.search);
  searchThingsRef.current = api.v1.things.search;
  const [posts, setPosts] = React.useState<PublicPost[]>([]);
  const [postsLoading, setPostsLoading] = React.useState(false);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [postCount, setPostCount] = React.useState<number | null>(null);
  const nextCursorRef = React.useRef<string | null>(null);
  const loadingRef = React.useRef(false);
  const generationRef = React.useRef(0);

  // advanced search over this profile's posts — the panel edits a draft;
  // Apply snapshots it into `applied` (null = plain chrono pager)
  const advancedFilters = useAdvancedFilters();
  const appliedAdvanced = advancedFilters.applied;

  const loadPage = React.useCallback(
		async (targetUsername: string, cursor: string | null, generation: number, advancedState: AdvancedFiltersState | null) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      // stamp the START — responses snapshotted before a reaction tap that
      // lands after it merge through the viewer's overlay, never clobber it
      const startedAt = Date.now();
      setPostsLoading(true);

      try {
        if (advancedState) {
          // structured search locked to this profile's user — same PostList,
          // same optimistic idioms, different pager underneath
          const resp: any = await searchThingsRef.current({
            ...advancedSearchBody(advancedState),
            author: targetUsername,
            cursor: cursor || undefined,
            limit: POSTS_PAGE_SIZE
          });
          if (generationRef.current !== generation) return;

          const page: PublicPost[] = mergeReactionOverlays(startedAt, searchResponsePosts(resp));
          setPosts((prev) => {
            if (!cursor) return page;
            const seen = new Set(prev.map((post) => post.id));
            return [...prev, ...page.filter((post) => !seen.has(post.id))];
          });
          nextCursorRef.current = resp?.nextCursor ?? null;
          setNextCursor(resp?.nextCursor ?? null);
          return;
        }

        const resp: any = await fetchUserPosts({
          username: targetUsername,
          cursor: cursor || undefined,
          limit: POSTS_PAGE_SIZE
        });
        if (generationRef.current !== generation) return;

        const page: PublicPost[] = mergeReactionOverlays(startedAt, Array.isArray(resp?.posts) ? resp.posts : []);
        setPosts((prev) => (cursor ? [...prev, ...page] : page));
        nextCursorRef.current = resp?.nextCursor ?? null;
        setNextCursor(resp?.nextCursor ?? null);
        if (typeof resp?.postCount === 'number') setPostCount(resp.postCount);
      } catch (err: any) {
        if (generationRef.current !== generation) return;
        // a failed first page must not leave the previous query's posts posing
        // as this one's results; a failed load-more keeps the list
        if (!cursor) setPosts([]);
        nextCursorRef.current = null;
        setNextCursor(null);
        lopuRef.current({
          title: 'Could not load posts 😔',
          description: err?.error || 'Please try again in a moment.',
          status: 'error'
        });
      } finally {
        loadingRef.current = false;
        if (generationRef.current === generation) setPostsLoading(false);
      }
    },
    [fetchUserPosts]
  );

  // Optimistic rendering: applying/clearing an advanced search over the SAME
  // profile keeps the last-known posts on screen while the new query loads
  // (the reset load replaces them when it lands); only a different profile
  // clears immediately — one user's posts must never linger under another's
  // header.
  const lastPostsUsernameRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    loadingRef.current = false;
    nextCursorRef.current = null;
    if (lastPostsUsernameRef.current !== postsUsername) {
      lastPostsUsernameRef.current = postsUsername;
      setPosts([]);
    }
    setNextCursor(null);
    setPostsLoading(false);

    if (!postsUsername) return;
    loadPage(postsUsername, null, generation, appliedAdvanced);
  }, [postsUsername, loadPage, appliedAdvanced]);

  const handleLoadMore = React.useCallback(() => {
    if (!postsUsername || !nextCursorRef.current) return;
    loadPage(postsUsername, nextCursorRef.current, generationRef.current, appliedAdvanced);
  }, [postsUsername, loadPage, appliedAdvanced]);

  // the header count belongs to the profile, not the current filter — reset it
  // only when the profile under the pager changes
  React.useEffect(() => {
    setPostCount(null);
  }, [postsUsername]);

  // the profile composer prepends the fresh post optimistically (same idiom as
  // the feed) and keeps the header's post count honest. Deliberately optimistic
  // even while an advanced search is applied — seeing your own fresh post beats
  // strict filter fidelity, and the next Apply reconciles the list.
  const handlePosted = React.useCallback((post: PublicPost) => {
    setPosts((prev) => [post, ...prev]);
    setPostCount((prev) => (typeof prev === 'number' ? prev + 1 : prev));
  }, []);

  const handlePostChanged = React.useCallback((id: string, next: PostChange) => {
    setPosts((prev) =>
      prev.flatMap((post) => {
        if (post.id !== id) return [post];
        const resolved = typeof next === 'function' ? next(post) : next;
        return resolved ? [resolved] : [];
      })
    );
    // deletes arrive as an explicit null (handleDelete); reaction updaters
    // never remove, so keying the count on null is correct.
    if (next === null) setPostCount((prev) => (typeof prev === 'number' ? Math.max(0, prev - 1) : prev));
  }, []);

  // self-mode actions
  const [editOpen, setEditOpen] = React.useState(false);

  const handleLogout = async () => {
    const resp = await api.v1.auth.logout();
    // Switcher semantics: with other accounts signed in the next one takes
    // over — stay put and let the page re-render on it.
    if (resp?.user) {
      lopu({ title: `Logged out — switched to ${getUserMention(resp.user)} ✨`, status: 'success', duration: 6000 });
      return;
    }
    navigate('/login');
  };

  const handleResend = async () => {
    if (!user) return;
    const resp = await api.v1.auth.resendVerification({ email: user.email });
    lopu({
      title: 'Verification email sent 📬',
      description: 'Check your inbox to verify your account.',
      status: 'success',
      link: resp?.verificationLink ? { label: '🔗 Verify now (dev)', href: resp.verificationLink } : undefined
    });
  };

  // logged-out visitor with no username param — hero copied verbatim from the
  // previous routes/profile.tsx
  if (!user && !username) {
    return (
			<Flex minHeight="100vh" width="100%" align="center" justify="center" direction="column" gap={4} background="var(--tt-surface, #fafafb)">
				<Box fontFamily="heading" fontSize="xs" fontWeight="600" letterSpacing="0.14em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)">
          Thingtime · Profile
        </Box>
        <Box
          as="h1"
          fontFamily="heading"
          fontSize="2xl"
          fontWeight="700"
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
          You're not logged in ✨
        </Box>
        <Text color="var(--tt-text, #5a5a66)">Log in to see your things.</Text>
        <Link to="/login">
          <Button
            mt={2}
            color="white"
            fontFamily="heading"
            fontWeight="600"
            background={RAINBOW}
            backgroundSize="calc(100px + 200%)"
            sx={{ animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)' }}
            _hover={{ opacity: 0.9 }}
            borderRadius="var(--tt-radius-md, 12px)"
          >
            Log in 🗝️ →
          </Button>
        </Link>
      </Flex>
    );
  }

  const pageShell = (children: React.ReactNode) => (
    <Flex
      minHeight="100vh"
      width="100%"
      direction="column"
      align="center"
      background="var(--tt-surface, #fafafb)"
      paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))"
      paddingBottom={16}
    >
      <Flex direction="column" width={['100%', '680px']} px={4} pt={[4, 6]}>
        {children}
      </Flex>
    </Flex>
  );

  // public mode — profile not found
  if (!isSelf && remote.status === 'missing') {
    return pageShell(
      <Flex direction="column" align="center" textAlign="center" gap={4} pt={[12, 20]}>
        <Eyebrow>Thingtime · Profile</Eyebrow>
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
            animation: RAINBOW_ANIM
          }}
        >
          Profile not found 🌫️
        </Box>
        <Text color="var(--tt-text, #5a5a66)">No one goes by @{username} here (yet).</Text>
        <Link to="/feed">
          <Button
            size="sm"
            variant="outline"
            borderColor="var(--tt-border, #ececef)"
            _hover={{ bg: 'var(--tt-surface-alt, #f5f5f7)' }}
            borderRadius="var(--tt-radius-md, 12px)"
          >
            Back to the feed 🌈
          </Button>
        </Link>
      </Flex>
    );
  }

  // public mode — still loading
  if (!isSelf && remote.status !== 'loaded') {
    return pageShell(
      <>
				<Box width="100%" height={['140px', '220px']} borderRadius="var(--tt-radius-lg, 16px)" background="var(--tt-surface-alt, #f5f5f7)" />
        <Text mt={4} px={[4, 6]} fontSize="sm" color="var(--tt-muted, #9a9aa6)">
          Loading profile ⏳
        </Text>
      </>
    );
  }

  const profile =
    isSelf && user
      ? {
          username: user.username,
          displayName: user.displayName,
          temporary: user.temporary,
          bio: user.bio,
          avatarUrl: user.avatarUrl,
          bannerUrl: user.bannerUrl,
          createdAt: user.createdAt
        }
      : remote.status === 'loaded'
        ? remote.profile
        : null;

  if (!profile) return null;

  const temporaryProfile = profile.temporary === true;

  const joinedLabel = formatJoined(profile.createdAt);
  const shownPostCount = postCount ?? (remote.status === 'loaded' ? remote.postCount : null);
  const metaParts = [
    joinedLabel ? `Joined ${joinedLabel}` : null,
    shownPostCount !== null ? `${shownPostCount} post${shownPostCount === 1 ? '' : 's'}` : null
  ].filter(Boolean);

  return pageShell(
    <>
      <ProfileBanner bannerUrl={profile.bannerUrl} height={['140px', '220px']} />

      <Flex px={[4, 6]} marginTop="-48px" position="relative" zIndex={1}>
				<ProfileAvatarCircle avatarUrl={profile.avatarUrl} name={getUserDisplayName(profile)} size="96px" borderWidth="4px" />
      </Flex>

      <Box px={[4, 6]} pt={3} whiteSpace="normal">
        <Text fontFamily="heading" fontSize="2xl" fontWeight={700} letterSpacing="-0.02em" color="var(--tt-ink, #16161a)">
          {getUserDisplayName(profile)}
        </Text>
        <Text fontSize="sm" color="var(--tt-muted, #9a9aa6)">
          {getUserIdentityDetail(profile)}
        </Text>
        {isSelf && user && !temporaryProfile && (
          <Text mt={1} fontSize="sm" color="var(--tt-text, #5a5a66)">
            {user.email} {user.emailVerified ? '✅' : '· ✉️ unverified'}
          </Text>
        )}

        {profile.bio ? (
          <Text mt={3} fontSize="sm" color="var(--tt-text, #5a5a66)" whiteSpace="pre-wrap">
            {profile.bio}
          </Text>
        ) : isSelf && !temporaryProfile ? (
          <Text mt={3} fontSize="sm" color="var(--tt-muted, #9a9aa6)">
            No bio yet ✍️
          </Text>
        ) : null}

        {metaParts.length > 0 && (
          <Text mt={2} fontSize="xs" color="var(--tt-muted, #9a9aa6)">
            {metaParts.join(' · ')}
          </Text>
        )}

        {/* follower/following/friend counts + follow/friend actions (and the
        pending friend-request inbox on your own profile) */}
        {!temporaryProfile && <RelationshipControls username={profile.username} isSelf={isSelf} />}

        {isSelf && user?.temporary ? (
          <Flex mt={4} columnGap={2} rowGap={2} flexWrap="wrap">
            <Link to="/login">
              <Button
                size="sm"
                color="white"
                fontFamily="heading"
                fontWeight="600"
                background={RAINBOW}
                backgroundSize="calc(100px + 200%)"
                sx={{ animation: RAINBOW_ANIM }}
                _hover={{ opacity: 0.9 }}
                borderRadius="var(--tt-radius-md, 12px)"
              >
                {LOGIN_TO_CLAIM_LABEL}
              </Button>
            </Link>
            <Link to="/register">
              <Button
                size="sm"
                variant="outline"
                borderColor="var(--tt-border, #ececef)"
                _hover={{ bg: 'var(--tt-surface-alt, #f5f5f7)' }}
                borderRadius="var(--tt-radius-md, 12px)"
              >
                Create account
              </Button>
            </Link>
          </Flex>
        ) : isSelf && user ? (
          <Flex mt={4} columnGap={2} rowGap={2} flexWrap="wrap">
            <Button
              size="sm"
              onClick={() => setEditOpen(true)}
              color="white"
              fontFamily="heading"
              fontWeight="600"
              background={RAINBOW}
              backgroundSize="calc(100px + 200%)"
              sx={{ animation: RAINBOW_ANIM }}
              _hover={{ opacity: 0.9 }}
              borderRadius="var(--tt-radius-md, 12px)"
            >
              Edit profile ✏️
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate('/settings')}
              borderColor="var(--tt-border, #ececef)"
              _hover={{ bg: 'var(--tt-surface-alt, #f5f5f7)' }}
              borderRadius="var(--tt-radius-md, 12px)"
            >
              All settings ⚙️
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleLogout}
              borderColor="var(--tt-border, #ececef)"
              _hover={{ bg: 'var(--tt-surface-alt, #f5f5f7)' }}
              borderRadius="var(--tt-radius-md, 12px)"
            >
              Log out 🗝️
            </Button>
            {!user.emailVerified && !user.temporary && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleResend}
                color="var(--tt-rainbow-5, #a555e8)"
                borderColor="var(--tt-border, #ececef)"
                _hover={{ bg: 'var(--tt-surface-alt, #f5f5f7)' }}
                borderRadius="var(--tt-radius-md, 12px)"
              >
                Resend verification email 📬
              </Button>
            )}
          </Flex>
        ) : null}
      </Box>

      {/* contribution heatmap of this profile's viewer-visible things — renders
      nothing until counts exist, so profiles with no visible activity keep
      their current layout */}
      {!temporaryProfile && <ActivityHeatmap username={profile.username} />}

      <Box mt={8}>
        <Flex mb={3} px={[4, 6]} alignItems="center" columnGap={2}>
          <Eyebrow>Posts</Eyebrow>
          {!temporaryProfile && (
            <Button
              size="xs"
              variant="outline"
              marginLeft="auto"
              fontWeight={600}
              color={advancedFilters.open || appliedAdvanced ? 'var(--tt-ink, #16161a)' : 'var(--tt-text, #5a5a66)'}
              borderColor="var(--tt-border, #ececef)"
              borderRadius="var(--tt-radius-md, 12px)"
              background={advancedFilters.open ? 'var(--tt-surface-alt, #f5f5f7)' : 'var(--tt-card, #ffffff)'}
              _hover={{ background: 'var(--tt-surface-alt, #f5f5f7)' }}
              leftIcon={<SlidersHorizontal size={12} />}
              onClick={() => advancedFilters.toggle()}
            >
              {appliedAdvanced ? 'Advanced · on 🔬' : 'Advanced 🔬'}
            </Button>
          )}
        </Flex>

        {!temporaryProfile && advancedFilters.open && (
          <Box mb={4}>
            <AdvancedFilters
              value={advancedFilters.draft}
              onChange={advancedFilters.setDraft}
              onApply={advancedFilters.apply}
              onClear={advancedFilters.clear}
              loading={postsLoading}
              lockedAuthor={profile.username}
            />
          </Box>
        )}

        {isSelf && user && (
          <Box mb={4}>
            <PostComposer onPosted={handlePosted} />
          </Box>
        )}

        <PostList
          posts={posts}
          loading={postsLoading}
          hasMore={Boolean(nextCursor)}
          onLoadMore={handleLoadMore}
          onPostChanged={handlePostChanged}
					emptyLabel={appliedAdvanced ? 'Nothing matched — loosen a filter, or try plain words ✨' : 'No posts yet 📭'}
        />
      </Box>

      {isSelf && user && !temporaryProfile && <EditProfileModal open={editOpen} onClose={() => setEditOpen(false)} />}
    </>
  );
};
