import React from 'react';
import { Box, Button, Flex, Input, Spinner, Text } from '@chakra-ui/react';

import { growthStageFor } from '~/components/Feed/algorithmGrowth';
import { POST_TYPE_META, PostType, PublicAlgorithm, timeAgo } from '~/components/Feed/feedTypes';
import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';
import { RAINBOW } from '~/theme/rainbow';

// Manager for doomscroll feed algorithms on /settings: list, rename inline,
// set active (or "Latest" chronological), branch, two-step delete, create.
// Mount this only for logged-in users, keyed on user id so account switches
// refetch cleanly.

const trainedLabel = (iso: string): string => {
  const label = timeAgo(iso);
  return label === 'just now' ? `trained ${label}` : `trained ${label} ago`;
};

const interestLabel = (interest: PublicAlgorithm['topInterests'][number]): string => {
  if (interest.kind === 'tag') return `#${interest.key}`;
  if (interest.kind === 'author') return `@${interest.label || interest.key}`;
  const meta = POST_TYPE_META[interest.key as PostType];
  return meta ? `${meta.label} ${meta.emoji}` : interest.key;
};

const InterestChip = (props: { label: string; weight: number }) => (
  <Flex
    alignItems="center"
    columnGap={1}
    paddingX={2}
    paddingY="2px"
    borderRadius="999px"
    background="var(--tt-surface-alt, #f5f5f7)"
    border="1px solid var(--tt-border, #ececef)"
    fontSize="11px"
    color="var(--tt-text, #5a5a66)"
    whiteSpace="normal"
  >
    <Text as="span" fontWeight={600} noOfLines={1}>
      {props.label}
    </Text>
    <Text as="span" color="var(--tt-muted, #9a9aa6)">
      {Math.round(props.weight * 10) / 10}
    </Text>
  </Flex>
);

const ActiveBadge = () => (
  <Flex
    alignItems="center"
    paddingX={2}
    height="24px"
    borderRadius="999px"
    background={RAINBOW}
    backgroundSize="calc(100px + 200%)"
    sx={{ animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)' }}
    color="white"
    fontSize="11px"
    fontWeight={700}
  >
    Active ✅
  </Flex>
);

export const AlgorithmManager = () => {
  const api = useApi();
  const lopu = useLopu();

  const [algorithms, setAlgorithms] = React.useState<PublicAlgorithm[]>([]);
  const [activeAlgorithmId, setActiveAlgorithmId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const [creatorOpen, setCreatorOpen] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newEmoji, setNewEmoji] = React.useState('🧠');

  const refresh = async () => {
    try {
      const resp = await api.v1.algorithms.list();
      setAlgorithms(resp?.algorithms || []);
      setActiveAlgorithmId(resp?.activeAlgorithmId ?? null);
    } catch (err: any) {
      lopu({
        title: 'Could not load algorithms 😔',
        description: err?.error || 'Please try again in a moment.',
        status: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    refresh();
    // mount-only: api/lopu identities change per render but the callbacks are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // arm the inline delete confirm briefly, then relax back
  React.useEffect(() => {
    if (!confirmDeleteId) return;
    const timer = window.setTimeout(() => setConfirmDeleteId(null), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmDeleteId]);

  const handleSetActive = async (algorithmId: string | null) => {
    setBusyId(algorithmId ? `${algorithmId}:active` : 'latest');
    try {
      const resp = await api.v1.algorithms.setActive({ algorithmId });
      setActiveAlgorithmId(resp?.activeAlgorithmId ?? null);
      lopu({
        title: algorithmId ? 'Algorithm activated ✅' : 'Back to Latest ⏱️',
        status: 'success',
        duration: 4000
      });
    } catch (err: any) {
      lopu({
        title: 'Could not switch algorithm 😔',
        description: err?.error || 'Please try again in a moment.',
        status: 'error'
      });
    } finally {
      setBusyId(null);
    }
  };

  const startRename = (algorithm: PublicAlgorithm) => {
    setRenamingId(algorithm.id);
    setRenameValue(algorithm.name);
  };

  const commitRename = async () => {
    const id = renamingId;
    setRenamingId(null);
    if (!id) return;
    const name = renameValue.trim();
    const current = algorithms.find((algorithm) => algorithm.id === id);
    if (!name || !current || name === current.name) return;
    try {
      const resp = await api.v1.algorithms.update({ id, name });
      setAlgorithms((prev) =>
        prev.map((algorithm) => (algorithm.id === id ? resp?.algorithm || { ...algorithm, name } : algorithm))
      );
      lopu({ title: 'Algorithm renamed ✨', status: 'success', duration: 4000 });
    } catch (err: any) {
      lopu({
        title: 'Rename failed 😔',
        description: err?.error || 'Please try again in a moment.',
        status: 'error'
      });
    }
  };

  const handleBranch = async (algorithm: PublicAlgorithm) => {
    setBusyId(`${algorithm.id}:branch`);
    try {
      const resp = await api.v1.algorithms.create({
        name: `${algorithm.name} (branch)`,
        emoji: algorithm.emoji,
        branchFrom: algorithm.id
      });
      if (resp?.algorithm) {
        setAlgorithms((prev) => [...prev, resp.algorithm]);
      }
      lopu({
        title: 'Algorithm branched 🌿',
        description: 'The branch starts with the same taste and trains on its own from here.',
        status: 'success',
        duration: 6000
      });
    } catch (err: any) {
      lopu({
        title: 'Branch failed 😔',
        description: err?.error || 'Please try again in a moment.',
        status: 'error'
      });
    } finally {
      setBusyId(null);
    }
  };

  // "try my feed brain 🧠" (claude-todo/10): first click flips the algorithm to
  // shared and copies the /feed?algorithm=<id> link; while shared, one click
  // re-copies and a separate action stops sharing. The algorithm doc itself
  // stays private and is never readable directly — but branching COPIES its
  // learned weights into the brancher's own algorithm, where they surface as
  // that copy's topInterests. Sharing therefore discloses the trained profile
  // to anyone holding the link, and the copy stands on its own after an
  // unshare. Say so plainly below: this is the owner's consent moment.
  const shareLinkFor = (algorithm: PublicAlgorithm) => `${window.location.origin}/feed?algorithm=${algorithm.id}`;

  const handleShare = async (algorithm: PublicAlgorithm) => {
    setBusyId(`${algorithm.id}:share`);
    try {
      if (!algorithm.shared) {
        const resp = await api.v1.algorithms.update({ id: algorithm.id, shared: true });
        if (!resp?.algorithm) throw resp;
        setAlgorithms((prev) => prev.map((item) => (item.id === algorithm.id ? resp.algorithm : item)));
      }
      const url = shareLinkFor(algorithm);
      try {
        await navigator.clipboard.writeText(url);
        lopu({
          title: 'Feed brain share link copied 🧠🔗',
          description:
            'Anyone with the link can branch their own copy, which carries your learned interests over. Your algorithm stays private and keeps training on its own — stop sharing any time, though copies already branched stay theirs.',
          status: 'success',
          duration: 8000
        });
      } catch {
        lopu({ title: 'Sharing is on — copy the link', description: url, status: 'info' });
      }
    } catch (err: any) {
      lopu({ title: 'Share failed 😔', description: err?.error || 'Please try again in a moment.', status: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const handleUnshare = async (algorithm: PublicAlgorithm) => {
    setBusyId(`${algorithm.id}:share`);
    try {
      const resp = await api.v1.algorithms.update({ id: algorithm.id, shared: false });
      if (!resp?.algorithm) throw resp;
      setAlgorithms((prev) => prev.map((item) => (item.id === algorithm.id ? resp.algorithm : item)));
      lopu({ title: 'Sharing stopped 🚪', description: 'Existing links no longer resolve.', status: 'success', duration: 5000 });
    } catch (err: any) {
      lopu({ title: 'Could not stop sharing 😔', description: err?.error || 'Please try again in a moment.', status: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (algorithm: PublicAlgorithm) => {
    if (confirmDeleteId !== algorithm.id) {
      setConfirmDeleteId(algorithm.id);
      return;
    }
    setConfirmDeleteId(null);
    setBusyId(`${algorithm.id}:delete`);
    try {
      await api.v1.algorithms.remove({ id: algorithm.id });
      if (activeAlgorithmId === algorithm.id) {
        // the server cleared the active pointer — refetch so state matches
        await refresh();
      } else {
        setAlgorithms((prev) => prev.filter((item) => item.id !== algorithm.id));
      }
      lopu({ title: 'Algorithm deleted 🗑️', status: 'success', duration: 4000 });
    } catch (err: any) {
      lopu({
        title: 'Delete failed 😔',
        description: err?.error || 'Please try again in a moment.',
        status: 'error'
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      lopu({ title: 'Name your algorithm ✏️', status: 'info', duration: 4000 });
      return;
    }
    setBusyId('create');
    try {
      const resp = await api.v1.algorithms.create({ name, emoji: newEmoji.trim() || undefined });
      if (resp?.algorithm) {
        setAlgorithms((prev) => [...prev, resp.algorithm]);
      }
      setNewName('');
      setCreatorOpen(false);
      lopu({
        title: 'Algorithm created ➕',
        description: 'Set it active and start scrolling to train it.',
        status: 'success',
        duration: 6000
      });
    } catch (err: any) {
      lopu({
        title: 'Could not create algorithm 😔',
        description: err?.error || 'Please try again in a moment.',
        status: 'error'
      });
    } finally {
      setBusyId(null);
    }
  };

  const metaFor = (algorithm: PublicAlgorithm): string => {
    const parts: string[] = [];
    // growth stage (🥚→🐣→🐥→🧠) leads the line — the label is the design
    const stage = growthStageFor(algorithm.eventCount);
    parts.push(`${stage.name} ${stage.emoji}`);
    parts.push(`${algorithm.eventCount} moment${algorithm.eventCount === 1 ? '' : 's'}`);
    parts.push(algorithm.lastTrainedAt ? trainedLabel(algorithm.lastTrainedAt) : 'untrained');
    const parent = algorithm.parentId
      ? algorithms.find((item) => item.id === algorithm.parentId)
      : null;
    if (parent) {
      parts.push(`branched from ${parent.name}`);
    }
    return parts.join(' · ');
  };

  const rowShell = (active: boolean) => ({
    flexDirection: 'column' as const,
    rowGap: 2,
    padding: 3,
    borderRadius: 'var(--tt-radius-md, 12px)',
    border: '1px solid var(--tt-border, #ececef)',
    background: active ? 'var(--tt-surface-alt, #f5f5f7)' : 'transparent'
  });

  if (loading) {
    return (
      <Flex alignItems="center" columnGap={2} paddingY={2} color="var(--tt-muted, #9a9aa6)">
        <Spinner size="sm" />
        <Text fontSize="sm">Loading your algorithms…</Text>
      </Flex>
    );
  }

  return (
    <Flex flexDirection="column" rowGap={2}>
      {/* "Latest" pseudo-entry — chronological feed, no training */}
      <Flex {...rowShell(activeAlgorithmId === null)}>
        <Flex alignItems="center" columnGap={3} rowGap={2} flexWrap="wrap">
          <Text fontSize="lg" flexShrink={0}>
            ⏱️
          </Text>
          <Box minWidth={0}>
            <Text fontSize="sm" fontWeight={600} color="var(--tt-ink, #16161a)">
              Latest
            </Text>
            <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" whiteSpace="normal">
              Newest first · no training, just time
            </Text>
          </Box>
          <Flex marginLeft="auto" alignItems="center" columnGap={1}>
            {activeAlgorithmId === null ? (
              <ActiveBadge />
            ) : (
              <Button
                size="xs"
                variant="outline"
                isLoading={busyId === 'latest'}
                onClick={() => handleSetActive(null)}
              >
                Set active ✅
              </Button>
            )}
          </Flex>
        </Flex>
      </Flex>

      {algorithms.map((algorithm) => {
        const active = activeAlgorithmId === algorithm.id;
        return (
          <Flex key={algorithm.id} {...rowShell(active)}>
            <Flex alignItems="center" columnGap={3} rowGap={2} flexWrap="wrap">
              <Text fontSize="lg" flexShrink={0}>
                {algorithm.emoji}
              </Text>
              <Box minWidth={0} flex="1 1 120px">
                {renamingId === algorithm.id ? (
                  <Input
                    size="sm"
                    autoFocus
                    value={renameValue}
                    maxWidth="240px"
                    background="var(--tt-card, #ffffff)"
                    border="1px solid var(--tt-border, #ececef)"
                    borderRadius="var(--tt-radius-sm, 9px)"
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                  />
                ) : (
                  <Text
                    as="button"
                    fontSize="sm"
                    fontWeight={600}
                    color="var(--tt-ink, #16161a)"
                    textAlign="left"
                    cursor="text"
                    _hover={{ textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                    title="Click to rename"
                    onClick={() => startRename(algorithm)}
                  >
                    {algorithm.name}
                  </Text>
                )}
                <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" whiteSpace="normal">
                  {metaFor(algorithm)}
                </Text>
              </Box>
              <Flex marginLeft="auto" alignItems="center" columnGap={1} flexWrap="wrap" rowGap={1}>
                {active ? (
                  <ActiveBadge />
                ) : (
                  <Button
                    size="xs"
                    variant="outline"
                    isLoading={busyId === `${algorithm.id}:active`}
                    onClick={() => handleSetActive(algorithm.id)}
                  >
                    Set active ✅
                  </Button>
                )}
                <Button
                  size="xs"
                  variant="ghost"
                  isLoading={busyId === `${algorithm.id}:branch`}
                  onClick={() => handleBranch(algorithm)}
                >
                  Branch 🌿
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  isLoading={busyId === `${algorithm.id}:share`}
                  onClick={() => handleShare(algorithm)}
                  title={algorithm.shared ? 'Copy the share link again' : 'Turn on sharing and copy the link'}
                >
                  {algorithm.shared ? 'Copy link 🧠🔗' : 'Share 🧠'}
                </Button>
                {algorithm.shared && (
                  <Button
                    size="xs"
                    variant="ghost"
                    color="var(--tt-muted, #9a9aa6)"
                    isLoading={busyId === `${algorithm.id}:share`}
                    onClick={() => handleUnshare(algorithm)}
                    title="Stop sharing — existing links stop resolving"
                  >
                    Unshare 🚪
                  </Button>
                )}
                <Button
                  size="xs"
                  variant={confirmDeleteId === algorithm.id ? 'solid' : 'ghost'}
                  color={confirmDeleteId === algorithm.id ? 'white' : 'var(--tt-danger, #e5484d)'}
                  background={confirmDeleteId === algorithm.id ? 'var(--tt-danger, #e5484d)' : undefined}
                  _hover={confirmDeleteId === algorithm.id ? { opacity: 0.9 } : undefined}
                  isLoading={busyId === `${algorithm.id}:delete`}
                  onClick={() => handleDelete(algorithm)}
                >
                  {confirmDeleteId === algorithm.id ? 'Really delete? 🗑️' : 'Delete 🗑️'}
                </Button>
              </Flex>
            </Flex>
            {algorithm.topInterests.length > 0 && (
              <Flex columnGap={1} rowGap={1} flexWrap="wrap">
                {algorithm.topInterests.map((interest) => (
                  <InterestChip
                    key={`${interest.kind}:${interest.key}`}
                    label={interestLabel(interest)}
                    weight={interest.weight}
                  />
                ))}
              </Flex>
            )}
          </Flex>
        );
      })}

      {algorithms.length === 0 && (
        <Text fontSize="sm" color="var(--tt-muted, #9a9aa6)" whiteSpace="normal" paddingY={1}>
          No algorithms yet — create one and it starts learning the moment you scroll. 🌱
        </Text>
      )}

      {/* new algorithm inline form */}
      {creatorOpen ? (
        <Flex
          alignItems="center"
          columnGap={2}
          rowGap={2}
          flexWrap="wrap"
          padding={3}
          borderRadius="var(--tt-radius-md, 12px)"
          border="1px dashed var(--tt-border, #ececef)"
        >
          <Input
            size="sm"
            width="64px"
            textAlign="center"
            value={newEmoji}
            aria-label="Algorithm emoji"
            background="var(--tt-surface-alt, #f5f5f7)"
            border="1px solid var(--tt-border, #ececef)"
            borderRadius="var(--tt-radius-sm, 9px)"
            onChange={(e) => setNewEmoji(e.target.value)}
          />
          <Input
            size="sm"
            autoFocus
            flex="1 1 160px"
            placeholder="Name this algorithm…"
            value={newName}
            background="var(--tt-surface-alt, #f5f5f7)"
            border="1px solid var(--tt-border, #ececef)"
            borderRadius="var(--tt-radius-sm, 9px)"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') setCreatorOpen(false);
            }}
          />
          <Button size="sm" variant="solid" isLoading={busyId === 'create'} onClick={handleCreate}>
            Create ➕
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCreatorOpen(false)}>
            Cancel
          </Button>
        </Flex>
      ) : (
        <Box>
          <Button size="sm" variant="outline" onClick={() => setCreatorOpen(true)}>
            New algorithm ➕
          </Button>
        </Box>
      )}
    </Flex>
  );
};
