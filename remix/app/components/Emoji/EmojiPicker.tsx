import React from 'react';
import { Box, Flex, Input, Spinner, Text } from '@chakra-ui/react';

import { sanitizeReactionToken } from '~/utils/reactionTokens';
import { GROUP_TAB_EMOJI, loadEmojiData, searchEmojis, type EmojiData } from './emojiData';

// The custom-emoji picker: a type/paste-or-search input (accepts ANY emoji or a
// multi-emoji group as one token), a paginated "Recently Used" section, and the
// full native-emoji keyboard by category. onPick TOGGLES a token, so the picker
// stays open for multi-select; activeTokens highlights what's already on.

const RECENTS_PAGE = 20;

type EmojiPickerProps = {
  onPick: (token: string) => void;
  recent: string[];
  activeTokens?: string[];
  autoFocus?: boolean;
};

const cellSx = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: '34px',
  height: '34px',
  padding: '0 6px',
  borderRadius: 'var(--tt-radius-sm, 9px)',
  fontSize: '20px',
  lineHeight: '1',
  cursor: 'pointer',
  transition: 'background 120ms ease',
  fontFamily:
    '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",EmojiOne Color,Android Emoji,sans-serif'
} as const;

const EmojiCell = (props: { token: string; active?: boolean; onPick: (token: string) => void; title?: string }) => (
  <Box
    as="button"
    type="button"
    sx={cellSx}
    background={props.active ? 'var(--tt-surface-hover, #ececee)' : 'transparent'}
    boxShadow={props.active ? 'inset 0 0 0 1.5px var(--tt-accent, #7c5cff)' : 'none'}
    _hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
    aria-label={props.title || `React ${props.token}`}
    title={props.title || props.token}
    onClick={() => props.onPick(props.token)}
  >
    {props.token}
  </Box>
);

const SectionLabel = (props: { children: React.ReactNode }) => (
  <Text
    fontSize="10px"
    fontWeight={600}
    letterSpacing="0.08em"
    textTransform="uppercase"
    opacity={0.45}
    paddingX={1}
    paddingTop={2}
    paddingBottom={1}
  >
    {props.children}
  </Text>
);

export const EmojiPicker = (props: EmojiPickerProps) => {
  const { onPick, recent, activeTokens, autoFocus } = props;

  const [query, setQuery] = React.useState('');
  const [data, setData] = React.useState<EmojiData | null>(null);
  const [dataError, setDataError] = React.useState(false);
  const [activeGroup, setActiveGroup] = React.useState<string | null>(null);
  const [recentVisible, setRecentVisible] = React.useState(RECENTS_PAGE);

  // Lazy-load the dataset when the picker mounts; the input + recents work
  // immediately without waiting for it.
  React.useEffect(() => {
    let cancelled = false;
    loadEmojiData()
      .then((loaded) => {
        if (cancelled) return;
        setData(loaded);
        setActiveGroup((prev) => prev ?? loaded.groups[0]?.slug ?? null);
      })
      .catch(() => {
        if (!cancelled) setDataError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeSet = React.useMemo(() => new Set(activeTokens || []), [activeTokens]);

  // A pasted/typed emoji (or multi-emoji group) becomes one addable token.
  const typedToken = React.useMemo(() => sanitizeReactionToken(query), [query]);
  const hasNameQuery = /[a-z0-9]/i.test(query);
  const searchResults = React.useMemo(
    () => (hasNameQuery && data ? searchEmojis(data.all, query) : []),
    [hasNameQuery, data, query]
  );

  const pick = (token: string) => {
    const clean = sanitizeReactionToken(token);
    if (clean) onPick(clean);
  };

  const commitTyped = () => {
    if (typedToken) {
      onPick(typedToken);
      setQuery('');
    } else if (searchResults.length) {
      pick(searchResults[0].emoji);
      setQuery('');
    }
  };

  const activeGroupEmojis = React.useMemo(
    () => data?.groups.find((group) => group.slug === activeGroup)?.emojis ?? [],
    [data, activeGroup]
  );

  const searching = hasNameQuery || !!typedToken;
  const visibleRecent = recent.slice(0, recentVisible);
  const remainingRecent = recent.length - visibleRecent.length;

  return (
    <Flex flexDirection="column" width="316px" maxWidth="100%" rowGap={1}>
      {/* type / paste / search */}
      <Flex columnGap={2} alignItems="center" padding={1}>
        <Input
          size="sm"
          autoFocus={autoFocus}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitTyped();
            }
          }}
          placeholder="🔍 Search, or type / paste emoji…"
          sx={{
            background: 'var(--tt-surface-alt, #f5f5f7)',
            border: '1px solid transparent',
            borderRadius: 'var(--tt-radius-sm, 9px)'
          }}
        />
        {typedToken && (
          <Box
            as="button"
            type="button"
            flexShrink={0}
            paddingX={3}
            paddingY={1}
            borderRadius="var(--tt-radius-sm, 9px)"
            fontSize="sm"
            fontWeight={600}
            color="white"
            background="var(--tt-accent, #7c5cff)"
            _hover={{ opacity: 0.9 }}
            cursor="pointer"
            onClick={commitTyped}
            title={`Add ${typedToken} as one reaction`}
          >
            Add
          </Box>
        )}
      </Flex>

      {/* a typed multi-emoji group previews as a single reaction token */}
      {typedToken && (
        <Box paddingX={1}>
          <Box
            as="button"
            type="button"
            width="100%"
            textAlign="left"
            padding={2}
            borderRadius="var(--tt-radius-sm, 9px)"
            background="var(--tt-surface-alt, #f5f5f7)"
            _hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
            cursor="pointer"
            onClick={commitTyped}
          >
            <Text fontSize="lg" lineHeight="1.4">
              {typedToken}
            </Text>
            <Text fontSize="xs" opacity={0.55}>
              Add as one reaction
            </Text>
          </Box>
        </Box>
      )}

      <Box maxHeight="260px" overflowY="auto" paddingX={1} paddingBottom={1}>
        {searching ? (
          searchResults.length ? (
            <>
              <SectionLabel>Results</SectionLabel>
              <Box display="grid" gridTemplateColumns="repeat(8, 1fr)" gap={1}>
                {searchResults.map((entry) => (
                  <EmojiCell
                    key={entry.emoji}
                    token={entry.emoji}
                    title={entry.name}
                    active={activeSet.has(entry.emoji)}
                    onPick={pick}
                  />
                ))}
              </Box>
            </>
          ) : !typedToken ? (
            <Text fontSize="sm" opacity={0.55} padding={3} textAlign="center">
              {data ? 'No emoji match that search.' : 'Loading emoji…'}
            </Text>
          ) : null
        ) : (
          <>
            {recent.length > 0 && (
              <>
                <SectionLabel>Recently used</SectionLabel>
                <Flex flexWrap="wrap" gap={1}>
                  {visibleRecent.map((token) => (
                    <EmojiCell key={token} token={token} active={activeSet.has(token)} onPick={pick} />
                  ))}
                </Flex>
                {remainingRecent > 0 && (
                  <Box
                    as="button"
                    type="button"
                    marginTop={1}
                    marginLeft={1}
                    fontSize="xs"
                    fontWeight={600}
                    color="var(--tt-accent, #7c5cff)"
                    cursor="pointer"
                    onClick={() => setRecentVisible((count) => count + RECENTS_PAGE)}
                    title="Show more recently used"
                  >
                    Show {Math.min(RECENTS_PAGE, remainingRecent)} more ⌄ ({remainingRecent})
                  </Box>
                )}
              </>
            )}

            {/* category tab strip */}
            {data && (
              <>
                <Flex position="sticky" top={0} zIndex={1} background="var(--tt-card, #fff)" paddingY={1} columnGap={1} flexWrap="wrap">
                  {data.groups.map((group) => (
                    <Box
                      as="button"
                      type="button"
                      key={group.slug}
                      fontSize="17px"
                      lineHeight="1"
                      padding="5px"
                      borderRadius="var(--tt-radius-sm, 9px)"
                      opacity={activeGroup === group.slug ? 1 : 0.55}
                      background={activeGroup === group.slug ? 'var(--tt-surface-hover, #ececee)' : 'transparent'}
                      _hover={{ opacity: 1 }}
                      cursor="pointer"
                      aria-label={group.name}
                      title={group.name}
                      onClick={() => setActiveGroup(group.slug)}
                    >
                      {GROUP_TAB_EMOJI[group.slug] || '⭐'}
                    </Box>
                  ))}
                </Flex>
                <SectionLabel>{data.groups.find((group) => group.slug === activeGroup)?.name}</SectionLabel>
                <Box display="grid" gridTemplateColumns="repeat(8, 1fr)" gap={1}>
                  {activeGroupEmojis.map((entry) => (
                    <EmojiCell
                      key={entry.emoji}
                      token={entry.emoji}
                      title={entry.name}
                      active={activeSet.has(entry.emoji)}
                      onPick={pick}
                    />
                  ))}
                </Box>
              </>
            )}

            {!data && !dataError && (
              <Flex justifyContent="center" padding={4}>
                <Spinner size="sm" />
              </Flex>
            )}
            {dataError && (
              <Text fontSize="sm" opacity={0.55} padding={3} textAlign="center">
                Couldn’t load the emoji keyboard — you can still type or paste any emoji above.
              </Text>
            )}
          </>
        )}
      </Box>
    </Flex>
  );
};
