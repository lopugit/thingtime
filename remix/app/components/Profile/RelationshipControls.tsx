import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { Check, UserMinus, UserPlus, X } from 'lucide-react';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { RAINBOW } from '~/theme/rainbow';
import { getUserDisplayName, getUserIdentityDetail } from '~/utils/userIdentity';
import type { PublicProfile } from '~/components/Feed/feedTypes';

// Profile social block: follower/following/friend counts (everyone), the
// Follow + Friend action buttons (other users), and the pending
// friend-request inbox (your own profile). Optimistic per the house rule —
// buttons flip instantly from cached state and reconcile/revert when the
// server answers; counts seed from localCache so revisits never flash empty.

const RAINBOW_ANIM = 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)';
const BORDER = 'var(--tt-border, #ececef)';
const MUTED = 'var(--tt-muted, #9a9aa6)';
const TEXT = 'var(--tt-text, #5a5a66)';
const INK = 'var(--tt-ink, #16161a)';
const RADIUS = 'var(--tt-radius-md, 12px)';

type FriendState = 'none' | 'pending-outgoing' | 'pending-incoming' | 'friends';

type Summary = {
  counts: { followers: number; following: number; friends: number };
  viewer: {
    following: boolean;
    followedBy: boolean;
    friendState: FriendState;
    incomingRequests?: number;
  } | null;
};

const cacheKey = (username: string) => `tt-social-${username.toLowerCase()}`;

export type RelationshipControlsProps = {
  username: string;
  isSelf: boolean;
};

export const RelationshipControls = (props: RelationshipControlsProps) => {
  const { username, isSelf } = props;
  const user = useCurrentUser();
  const api = useApi();
  const lopu = useLopu();

  // first paint from the synchronous cache (optimistic-rendering house rule)
  const [summary, setSummary] = React.useState<Summary | null>(() => readLocalCache<Summary>(cacheKey(username)));
  const [requests, setRequests] = React.useState<PublicProfile[]>([]);
  // second-click confirm state for unfriend (guards the accidental tap)
  const [confirmUnfriend, setConfirmUnfriend] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const lopuRef = React.useRef(lopu);
  lopuRef.current = lopu;

  const persist = React.useCallback(
    (next: Summary | null) => {
      setSummary(next);
      if (next) writeLocalCache(cacheKey(username), next);
    },
    [username]
  );

  // background reconcile (also the cold-start fetch)
  const getRelationships = api.v1.social.relationships;
  const getConnections = api.v1.social.connections;
  React.useEffect(() => {
    let cancelled = false;
    setSummary(readLocalCache<Summary>(cacheKey(username)));
    setRequests([]);
    setConfirmUnfriend(false);
    getRelationships({ username })
      .then((resp: any) => {
        if (cancelled || !resp?.counts) return;
        const next: Summary = { counts: resp.counts, viewer: resp.viewer ?? null };
        setSummary(next);
        writeLocalCache(cacheKey(username), next);
        if (isSelf && (resp.viewer?.incomingRequests || 0) > 0) {
          getConnections({ username, type: 'requests', limit: 20 })
            .then((list: any) => {
              if (!cancelled && Array.isArray(list?.users)) setRequests(list.users);
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // user?.id: relationship state is viewer-specific — refetch after login/switch
  }, [username, isSelf, user?.id, getRelationships, getConnections]);

  const counts = summary?.counts;
  const viewer = summary?.viewer ?? null;

  const requireLogin = () => {
    lopuRef.current({ title: 'Log in to connect ✨', status: 'info', duration: 6000 });
  };

  const handleFollowToggle = async () => {
    if (!user) return requireLogin();
    if (!summary) return;
    const wasFollowing = !!viewer?.following;
    const desired = !wasFollowing;
    const previous = summary;
    persist({
      counts: { ...summary.counts, followers: Math.max(0, summary.counts.followers + (desired ? 1 : -1)) },
      viewer: { ...(viewer || { followedBy: false, friendState: 'none' as FriendState }), following: desired }
    });
    try {
      const resp: any = await api.v1.social.follow({ username, follow: desired });
      setSummary((prev) => {
        if (!prev) return prev;
        const next: Summary = {
          counts: { ...prev.counts, followers: resp?.followerCount ?? prev.counts.followers },
          viewer: prev.viewer ? { ...prev.viewer, following: !!resp?.following } : prev.viewer
        };
        writeLocalCache(cacheKey(username), next);
        return next;
      });
    } catch (err: any) {
      persist(previous);
      lopuRef.current({
        title: 'Follow didn’t stick 😿',
        description: err?.error || 'Please try again in a moment.',
        status: 'error',
        duration: 6000
      });
    }
  };

  const applyFriendState = (state: FriendState, friendDelta: number) => {
    setSummary((prev) => {
      if (!prev) return prev;
      const next: Summary = {
        counts: { ...prev.counts, friends: Math.max(0, prev.counts.friends + friendDelta) },
        viewer: prev.viewer
          ? { ...prev.viewer, friendState: state }
          : { following: false, followedBy: false, friendState: state }
      };
      writeLocalCache(cacheKey(username), next);
      return next;
    });
  };

  const sendFriendIntent = async (
    intent: 'request' | 'cancel' | 'accept' | 'decline' | 'unfriend',
    optimistic: { state: FriendState; friendDelta: number }
  ) => {
    if (!user) return requireLogin();
    if (!summary || busy) return;
    const previous = summary;
    setBusy(true);
    setConfirmUnfriend(false);
    applyFriendState(optimistic.state, optimistic.friendDelta);
    try {
      const resp: any = await api.v1.social.friend({ username, intent });
      const serverState = (resp?.friendState as FriendState) || optimistic.state;
      if (serverState !== optimistic.state) {
        // e.g. request crossed with theirs → instantly friends
        applyFriendState(serverState, serverState === 'friends' && optimistic.state !== 'friends' ? 1 : 0);
      }
      if (intent === 'request' && serverState === 'pending-outgoing') {
        lopuRef.current({ title: 'Friend request sent 🤝', status: 'success', duration: 4000 });
      }
      if (serverState === 'friends' && intent !== 'unfriend') {
        lopuRef.current({ title: `You and @${username} are friends now 💚`, status: 'success', duration: 5000 });
      }
    } catch (err: any) {
      persist(previous);
      lopuRef.current({
        title: 'That didn’t go through 😿',
        description: err?.error || 'Please try again in a moment.',
        status: 'error',
        duration: 6000
      });
    } finally {
      setBusy(false);
    }
  };

  const respondToRequest = async (from: PublicProfile, accept: boolean) => {
    if (!user || busy) return;
    setBusy(true);
    const previousRequests = requests;
    const previousSummary = summary;
    setRequests((prev) => prev.filter((entry) => entry.id !== from.id));
    if (accept && summary) {
      persist({
        ...summary,
        counts: { ...summary.counts, friends: summary.counts.friends + 1 },
        viewer: summary.viewer
          ? { ...summary.viewer, incomingRequests: Math.max(0, (summary.viewer.incomingRequests || 1) - 1) }
          : summary.viewer
      });
    }
    try {
      await api.v1.social.friend({ userId: from.id, intent: accept ? 'accept' : 'decline' });
      lopuRef.current(
        accept
          ? { title: `You and @${from.username} are friends now 💚`, status: 'success', duration: 5000 }
          : { title: 'Request declined 🙅', status: 'info', duration: 4000 }
      );
    } catch (err: any) {
      setRequests(previousRequests);
      if (previousSummary) persist(previousSummary);
      lopuRef.current({
        title: 'That didn’t go through 😿',
        description: err?.error || 'Please try again in a moment.',
        status: 'error',
        duration: 6000
      });
    } finally {
      setBusy(false);
    }
  };

  const friendState: FriendState = viewer?.friendState || 'none';

  return (
    <Box whiteSpace="normal">
      {/* counts — always public, seeded from cache so they never flash */}
      <Flex mt={2} columnGap={3} rowGap={1} flexWrap="wrap" fontSize="sm" color={TEXT}>
        <Text as="span">
          <Text as="span" fontWeight={700} color={INK}>
            {counts?.followers ?? 0}
          </Text>{' '}
          {(counts?.followers ?? 0) === 1 ? 'follower' : 'followers'}
        </Text>
        <Text as="span">
          <Text as="span" fontWeight={700} color={INK}>
            {counts?.following ?? 0}
          </Text>{' '}
          following
        </Text>
        <Text as="span">
          <Text as="span" fontWeight={700} color={INK}>
            {counts?.friends ?? 0}
          </Text>{' '}
          {(counts?.friends ?? 0) === 1 ? 'friend' : 'friends'}
        </Text>
        {!isSelf && viewer?.followedBy && (
          <Text as="span" fontSize="xs" color={MUTED} alignSelf="center">
            Follows you 👀
          </Text>
        )}
      </Flex>

      {/* other-user actions */}
      {!isSelf && (
        <Flex mt={4} columnGap={2} rowGap={2} flexWrap="wrap">
          <Button
            size="sm"
            onClick={handleFollowToggle}
            leftIcon={viewer?.following ? <Check size={14} /> : <UserPlus size={14} />}
            color={viewer?.following ? TEXT : 'white'}
            fontFamily="heading"
            fontWeight="600"
            variant={viewer?.following ? 'outline' : 'solid'}
            borderColor={BORDER}
            background={viewer?.following ? 'var(--tt-card, #ffffff)' : RAINBOW}
            backgroundSize="calc(100px + 200%)"
            sx={viewer?.following ? undefined : { animation: RAINBOW_ANIM }}
            _hover={viewer?.following ? { background: 'var(--tt-surface-alt, #f5f5f7)' } : { opacity: 0.9 }}
            borderRadius={RADIUS}
          >
            {viewer?.following ? 'Following ✓' : 'Follow'}
          </Button>

          {friendState === 'none' && (
            <Button
              size="sm"
              variant="outline"
              isDisabled={busy}
              onClick={() => sendFriendIntent('request', { state: 'pending-outgoing', friendDelta: 0 })}
              borderColor={BORDER}
              color={TEXT}
              _hover={{ background: 'var(--tt-surface-alt, #f5f5f7)' }}
              borderRadius={RADIUS}
            >
              Add friend 🤝
            </Button>
          )}
          {friendState === 'pending-outgoing' && (
            <Button
              size="sm"
              variant="outline"
              isDisabled={busy}
              onClick={() => sendFriendIntent('cancel', { state: 'none', friendDelta: 0 })}
              borderColor={BORDER}
              color={MUTED}
              _hover={{ background: 'var(--tt-surface-alt, #f5f5f7)' }}
              borderRadius={RADIUS}
              title="Cancel your friend request"
            >
              Requested ⏳
            </Button>
          )}
          {friendState === 'pending-incoming' && (
            <>
              <Button
                size="sm"
                isDisabled={busy}
                onClick={() => sendFriendIntent('accept', { state: 'friends', friendDelta: 1 })}
                leftIcon={<Check size={14} />}
                color="white"
                fontFamily="heading"
                fontWeight="600"
                background={RAINBOW}
                backgroundSize="calc(100px + 200%)"
                sx={{ animation: RAINBOW_ANIM }}
                _hover={{ opacity: 0.9 }}
                borderRadius={RADIUS}
              >
                Accept friend request
              </Button>
              <Button
                size="sm"
                variant="outline"
                isDisabled={busy}
                onClick={() => sendFriendIntent('decline', { state: 'none', friendDelta: 0 })}
                leftIcon={<X size={14} />}
                borderColor={BORDER}
                color={MUTED}
                _hover={{ background: 'var(--tt-surface-alt, #f5f5f7)' }}
                borderRadius={RADIUS}
              >
                Decline
              </Button>
            </>
          )}
          {friendState === 'friends' && (
            <Button
              size="sm"
              variant="outline"
              isDisabled={busy}
              onClick={() => {
                if (!confirmUnfriend) {
                  setConfirmUnfriend(true);
                  window.setTimeout(() => setConfirmUnfriend(false), 3000);
                  return;
                }
                sendFriendIntent('unfriend', { state: 'none', friendDelta: -1 });
              }}
              leftIcon={confirmUnfriend ? <UserMinus size={14} /> : undefined}
              borderColor={BORDER}
              color={confirmUnfriend ? 'var(--tt-rainbow-1, #e85555)' : TEXT}
              _hover={{ background: 'var(--tt-surface-alt, #f5f5f7)' }}
              borderRadius={RADIUS}
            >
              {confirmUnfriend ? 'Unfriend? 💔' : 'Friends 💚'}
            </Button>
          )}
        </Flex>
      )}

      {/* your pending friend requests (approve/decline inbox) */}
      {isSelf && requests.length > 0 && (
        <Box mt={4} border={`1px solid ${BORDER}`} borderRadius="var(--tt-radius-lg, 16px)" padding={3}>
          <Text
            fontFamily="mono"
            fontSize="10px"
            fontWeight={600}
            letterSpacing="0.08em"
            textTransform="uppercase"
            color={MUTED}
            marginBottom={2}
          >
            Friend requests 🤝
          </Text>
          <Flex flexDirection="column" rowGap={2}>
            {requests.map((from) => (
              <Flex key={from.id} alignItems="center" columnGap={2} flexWrap="wrap">
                <Text fontSize="sm" color={INK} fontWeight={600} flex="1" minWidth="120px">
                  {getUserDisplayName(from)}{' '}
                  <Text as="span" fontWeight={400} color={MUTED}>
                    {getUserIdentityDetail(from)}
                  </Text>
                </Text>
                <Button
                  size="xs"
                  isDisabled={busy}
                  onClick={() => respondToRequest(from, true)}
                  color="white"
                  fontWeight="600"
                  background={RAINBOW}
                  backgroundSize="calc(100px + 200%)"
                  sx={{ animation: RAINBOW_ANIM }}
                  _hover={{ opacity: 0.9 }}
                  borderRadius={RADIUS}
                >
                  Accept ✅
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  isDisabled={busy}
                  onClick={() => respondToRequest(from, false)}
                  borderColor={BORDER}
                  color={MUTED}
                  _hover={{ background: 'var(--tt-surface-alt, #f5f5f7)' }}
                  borderRadius={RADIUS}
                >
                  Decline
                </Button>
              </Flex>
            ))}
          </Flex>
        </Box>
      )}
    </Box>
  );
};
