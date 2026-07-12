import React from 'react';
import { Box, Button, Center, Flex, Input, Select, Text } from '@chakra-ui/react';
import { Plus, Search as SearchIcon } from 'lucide-react';

import { Rainbow } from '~/components/Rainbow/Rainbow';
import { useLopu } from '~/components/Lopu/useLopu';
import {
  ConditionRowsEditor,
  ROOT_FIELD_SUGGESTIONS,
  compileRows,
  invalidNumberField,
  newRow
} from '~/components/Search/searchBuilder';
import type { ConditionRow } from '~/components/Search/searchTypes';
import type { PublicPost } from './feedTypes';

// The Advanced panel behind the feed/profile Filters ▸ Advanced option — the
// /search experience embedded above the composer: a rainbow text-search input,
// one-tap shortcut filters for the common asks (tags, who posted it, how loved
// it is, comment count, post length), and the full condition-row builder for
// everything else. The parent owns the state and runs the search; this panel
// is purely controlled.

const MUTED = 'var(--tt-muted, #9a9aa6)';
const BORDER = '1px solid var(--tt-border, #ececef)';
const RADIUS_SM = 'var(--tt-radius-sm, 9px)';

export type AdvancedFiltersState = {
  q: string;
  mode: 'all' | 'any';
  rows: ConditionRow[];
  tags: string; // comma-separated
  author: string; // username (ignored when the panel is locked to a profile)
  minReactions: string;
  minComments: string;
  minTextChars: string;
  maxTextChars: string;
  sort: 'auto' | 'relevance' | 'newest' | 'oldest';
};

export const EMPTY_ADVANCED_FILTERS: AdvancedFiltersState = {
  q: '',
  mode: 'all',
  rows: [],
  tags: '',
  author: '',
  minReactions: '',
  minComments: '',
  minTextChars: '',
  maxTextChars: '',
  sort: 'auto'
};

// does this state actually change anything? (an open-but-empty panel keeps the
// normal feed behaviour). A non-auto sort counts — "oldest, nothing else" is a
// real search the normal feed can't express.
export const advancedFiltersActive = (state: AdvancedFiltersState): boolean =>
  !!(
    state.q.trim() ||
    compileRows(state.rows) ||
    state.tags.trim() ||
    state.author.trim() ||
    state.minReactions.trim() ||
    state.minComments.trim() ||
    state.minTextChars.trim() ||
    state.maxTextChars.trim() ||
    state.sort !== 'auto'
  );

// state → POST /api/v1/things/search body (posts only — feeds are posts). The
// caller merges page params (cursor/limit) and any locked author.
export const advancedSearchBody = (state: AdvancedFiltersState): Record<string, unknown> => ({
  q: state.q.trim() || undefined,
  mode: state.mode,
  conditions: compileRows(state.rows) || undefined,
  thingtime: 'post',
  tags: state.tags.trim() || undefined,
  author: state.author.trim().replace(/^@/, '') || undefined,
  minReactions: state.minReactions.trim() || undefined,
  minComments: state.minComments.trim() || undefined,
  minTextChars: state.minTextChars.trim() || undefined,
  maxTextChars: state.maxTextChars.trim() || undefined,
  // relevance without text is a server-side 400 — fall back to auto (newest)
  sort: state.sort === 'auto' || (state.sort === 'relevance' && !state.q.trim()) ? undefined : state.sort
});

// search response → ordered full post projections (things carries the order,
// posts the projections keyed by id)
export const searchResponsePosts = (resp: any): PublicPost[] =>
  ((resp?.things || []) as { id: string }[])
    .map((thing) => (resp?.posts || {})[thing.id])
    .filter(Boolean) as PublicPost[];

// The advanced-search state machine shared by /feed and profiles: the panel
// edits a draft; Apply validates and snapshots it into `applied` (null = the
// page's normal pager); closing the panel always restores the normal pager.
export const useAdvancedFilters = () => {
  const lopu = useLopu();
  const lopuRef = React.useRef(lopu);
  lopuRef.current = lopu;

  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<AdvancedFiltersState>(EMPTY_ADVANCED_FILTERS);
  const [applied, setApplied] = React.useState<AdvancedFiltersState | null>(null);

  const draftRef = React.useRef(draft);
  draftRef.current = draft;

  const apply = React.useCallback(() => {
    const current = draftRef.current;
    const invalid = invalidNumberField(current.rows);
    if (invalid) {
      lopuRef.current({
        title: `"${invalid}" wants a number`,
        description: 'That value isn’t numeric — fix it or switch the row’s datatype to text.',
        status: 'error'
      });
      return;
    }
    setApplied(advancedFiltersActive(current) ? current : null);
  }, []);

  const clear = React.useCallback(() => {
    setDraft(EMPTY_ADVANCED_FILTERS);
    setApplied(null);
  }, []);

  const openRef = React.useRef(open);
  openRef.current = open;
  const toggle = React.useCallback((next?: boolean) => {
    const value = next === undefined ? !openRef.current : next;
    setOpen(value);
    if (!value) setApplied(null);
  }, []);

  return { open, draft, setDraft, applied, apply, clear, toggle };
};

const ShortcutField = (props: { label: string; children: React.ReactNode }) => (
  <Flex flexDirection="column" rowGap={1} minWidth="130px" flex="1 1 130px">
    <Text
      fontFamily="mono"
      fontSize="10px"
      fontWeight={600}
      letterSpacing="0.08em"
      textTransform="uppercase"
      color={MUTED}
    >
      {props.label}
    </Text>
    {props.children}
  </Flex>
);

export type AdvancedFiltersProps = {
  value: AdvancedFiltersState;
  onChange: (next: AdvancedFiltersState) => void;
  // run the search with the current value (also fired by Enter in the q input)
  onApply: () => void;
  // reset to EMPTY_ADVANCED_FILTERS and return to the normal feed
  onClear: () => void;
  loading?: boolean;
  // profile pages lock results to the profile's user — hide the user shortcut
  lockedAuthor?: string | null;
};

export const AdvancedFilters = (props: AdvancedFiltersProps) => {
  const { value, onChange, onApply, onClear, loading, lockedAuthor } = props;

  const patch = (partial: Partial<AdvancedFiltersState>) => onChange({ ...value, ...partial });

  const updateRow = (id: string, rowPatch: Partial<ConditionRow>) =>
    patch({ rows: value.rows.map((row) => (row.id === id ? { ...row, ...rowPatch } : row)) });

  const removeRow = (id: string) => patch({ rows: value.rows.filter((row) => row.id !== id) });

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    onApply();
  };

  return (
    <Flex
      flexDirection="column"
      rowGap={3}
      background="var(--tt-card, #ffffff)"
      border={BORDER}
      borderRadius="var(--tt-radius-lg, 16px)"
      boxShadow="var(--tt-shadow-card, 0px 1px 2px rgba(22, 22, 26, 0.05))"
      padding={4}
    >
      {/* the Commander-style rainbow search input, feed-sized */}
      <form onSubmit={submit}>
        <Center borderRadius={RADIUS_SM} height="44px" overflow="hidden" padding="2px" position="relative" width="100%">
          <Rainbow opacity={0.6} position="absolute" repeats={2} thickness={10} />
          <Flex
            align="center"
            background="var(--tt-card, #ffffff)"
            borderRadius="var(--tt-radius-xs, 7px)"
            columnGap={2}
            height="100%"
            position="relative"
            paddingX={3}
            width="100%"
            zIndex={1}
          >
            <SearchIcon color={MUTED} size={16} />
            <Input
              _placeholder={{ color: MUTED }}
              border="none"
              fontSize="sm"
              height="100%"
              onChange={(event) => patch({ q: event.target.value })}
              outline="none"
              padding={0}
              placeholder={lockedAuthor ? `Search @${lockedAuthor}'s posts…` : 'Search posts…'}
              value={value.q}
              variant="unstyled"
            />
          </Flex>
        </Center>
      </form>

      {/* shortcut filters — the common asks, one input each */}
      <Flex columnGap={3} rowGap={2} flexWrap="wrap">
        <ShortcutField label="Tags 🏷️">
          <Input
            size="sm"
            borderRadius={RADIUS_SM}
            placeholder="tag, tag, …"
            value={value.tags}
            onChange={(event) => patch({ tags: event.target.value })}
          />
        </ShortcutField>
        {!lockedAuthor && (
          <ShortcutField label="By user 👤">
            <Input
              size="sm"
              borderRadius={RADIUS_SM}
              placeholder="@username"
              value={value.author}
              onChange={(event) => patch({ author: event.target.value })}
            />
          </ShortcutField>
        )}
        <ShortcutField label="Min reactions 🧡">
          <Input
            size="sm"
            type="number"
            min={0}
            borderRadius={RADIUS_SM}
            placeholder="e.g. 5"
            value={value.minReactions}
            onChange={(event) => patch({ minReactions: event.target.value })}
          />
        </ShortcutField>
        <ShortcutField label="Min comments 💬">
          <Input
            size="sm"
            type="number"
            min={0}
            borderRadius={RADIUS_SM}
            placeholder="e.g. 2"
            value={value.minComments}
            onChange={(event) => patch({ minComments: event.target.value })}
          />
        </ShortcutField>
        <ShortcutField label="Text length ✍️">
          <Flex columnGap={1} alignItems="center">
            <Input
              size="sm"
              type="number"
              min={0}
              borderRadius={RADIUS_SM}
              placeholder="min"
              value={value.minTextChars}
              onChange={(event) => patch({ minTextChars: event.target.value })}
            />
            <Text fontSize="xs" color={MUTED}>
              –
            </Text>
            <Input
              size="sm"
              type="number"
              min={0}
              borderRadius={RADIUS_SM}
              placeholder="max"
              value={value.maxTextChars}
              onChange={(event) => patch({ maxTextChars: event.target.value })}
            />
          </Flex>
        </ShortcutField>
      </Flex>

      {/* the full condition builder for everything else */}
      <ConditionRowsEditor
        rows={value.rows}
        onUpdateRow={updateRow}
        onRemoveRow={removeRow}
        fieldSuggestions={ROOT_FIELD_SUGGESTIONS}
        datalistId="tt-advanced-fields"
      />

      <Flex alignItems="center" columnGap={2} rowGap={2} flexWrap="wrap">
        <Button
          leftIcon={<Plus size={14} />}
          onClick={() => patch({ rows: [...value.rows, newRow()] })}
          size="xs"
          variant="outline"
        >
          Add filter
        </Button>
        {value.rows.length > 1 && (
          <Select
            maxWidth="150px"
            size="xs"
            value={value.mode}
            onChange={(event) => patch({ mode: event.target.value === 'any' ? 'any' : 'all' })}
          >
            <option value="all">match all filters</option>
            <option value="any">match any filter</option>
          </Select>
        )}
        <Select
          maxWidth="120px"
          size="xs"
          value={value.sort}
          onChange={(event) => patch({ sort: event.target.value as AdvancedFiltersState['sort'] })}
        >
          <option value="auto">auto sort</option>
          <option value="relevance">relevance</option>
          <option value="newest">newest</option>
          <option value="oldest">oldest</option>
        </Select>
        <Button size="xs" variant="ghost" onClick={onClear}>
          Clear
        </Button>
        <Box marginLeft="auto">
          <Button size="sm" colorScheme="pink" isLoading={loading} onClick={() => onApply()}>
            Search ✨
          </Button>
        </Box>
      </Flex>
    </Flex>
  );
};
