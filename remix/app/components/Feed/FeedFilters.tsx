import React from 'react';
import {
  Button,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuItemOption,
  MenuList,
  MenuOptionGroup,
  Text
} from '@chakra-ui/react';
import { SlidersHorizontal } from 'lucide-react';

import { useCurrentUser } from '~/hooks/useCurrentUser';
import { DRAWER_POPUP_Z } from '~/components/Nav/Drawer/useDrawer';
import { CIRCLE_META, POST_TYPE_META } from './feedTypes';
import type { FeedFiltersState, PostType, PostVisibility } from './feedTypes';

// Minimalist feed filters dropdown: post type + circle checkboxes and a
// date-range radio, all inside one Menu that stays open while toggling.
// Empty arrays mean "no filter" — the button label counts active groups.
// An optional Advanced entry toggles the page's advanced search panel.

const INK = 'var(--tt-ink, #16161a)';
const MUTED = 'var(--tt-muted, #9a9aa6)';
const BORDER_COLOR = 'var(--tt-border, #ececef)';
const RADIUS_MD = 'var(--tt-radius-md, 12px)';

export type FeedFiltersProps = {
  value: FeedFiltersState;
  onChange: (next: FeedFiltersState) => void;
  // when provided, the menu grows an Advanced entry that toggles the page's
  // advanced search panel (rendered by the page, below these controls)
  advancedOpen?: boolean;
  onAdvancedToggle?: (open: boolean) => void;
};

type DatePreset = 'all' | 'today' | 'week' | 'month';

const presetRange = (preset: DatePreset): { from: string | null; to: string | null } => {
  const now = new Date();
  if (preset === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { from: start.toISOString(), to: null };
  }
  if (preset === 'week') {
    return { from: new Date(now.getTime() - 7 * 86400000).toISOString(), to: null };
  }
  if (preset === 'month') {
    return { from: new Date(now.getTime() - 30 * 86400000).toISOString(), to: null };
  }
  return { from: null, to: null };
};

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <Text
    paddingX={3}
    paddingTop={2}
    paddingBottom={1}
    fontFamily="mono"
    fontSize="10px"
    fontWeight={600}
    letterSpacing="0.08em"
    textTransform="uppercase"
    color={MUTED}
  >
    {children}
  </Text>
);

export const FeedFilters = (props: FeedFiltersProps) => {
  const { value, onChange, advancedOpen, onAdvancedToggle } = props;

  const user = useCurrentUser();

  // FeedFiltersState only carries from/to, so the chosen preset lives here;
  // an external reset (from === to === null) snaps it back to "all time"
  const [datePreset, setDatePreset] = React.useState<DatePreset>('all');

  React.useEffect(() => {
    if (!value.from && !value.to) setDatePreset('all');
  }, [value.from, value.to]);

  const activeCount =
    (value.types.length > 0 ? 1 : 0) + (value.circles.length > 0 ? 1 : 0) + (value.from || value.to ? 1 : 0);

  const handleDatePreset = (next: string | string[]) => {
    const preset = (Array.isArray(next) ? next[0] : next) as DatePreset;
    setDatePreset(preset);
    onChange({ ...value, ...presetRange(preset) });
  };

  const handleReset = () => {
    setDatePreset('all');
    onChange({ types: [], circles: [], from: null, to: null });
  };

  return (
    <Menu closeOnSelect={false} placement="bottom-end" autoSelect={false}>
      <MenuButton
        as={Button}
        size="sm"
        variant="outline"
        fontWeight={600}
        color={activeCount > 0 ? INK : 'var(--tt-text, #5a5a66)'}
        borderColor={BORDER_COLOR}
        borderRadius={RADIUS_MD}
        background="var(--tt-card, #ffffff)"
        _hover={{ background: 'var(--tt-surface-alt, #f5f5f7)' }}
        _active={{ background: 'var(--tt-surface-hover, #ececee)' }}
        leftIcon={<SlidersHorizontal size={13} />}
      >
        {activeCount > 0 ? `Filters · ${activeCount}` : 'Filters'}
      </MenuButton>
      <MenuList zIndex={DRAWER_POPUP_Z} minWidth="230px" borderRadius={RADIUS_MD} borderColor={BORDER_COLOR}>
        <Eyebrow>Post type</Eyebrow>
        <MenuOptionGroup
          type="checkbox"
          value={value.types}
          onChange={(next) => onChange({ ...value, types: (Array.isArray(next) ? next : [next]) as PostType[] })}
        >
          {(Object.keys(POST_TYPE_META) as PostType[]).map((key) => (
            <MenuItemOption key={key} value={key} fontSize="sm">
              {POST_TYPE_META[key].emoji} {POST_TYPE_META[key].label}
            </MenuItemOption>
          ))}
        </MenuOptionGroup>

        <MenuDivider />
        <Eyebrow>Circles</Eyebrow>
        <MenuOptionGroup
          type="checkbox"
          value={value.circles}
          onChange={(next) =>
            onChange({ ...value, circles: (Array.isArray(next) ? next : [next]) as PostVisibility[] })
          }
        >
          {(Object.keys(CIRCLE_META) as PostVisibility[]).map((key) => (
            <MenuItemOption key={key} value={key} fontSize="sm" isDisabled={!user && key !== 'public'}>
              {CIRCLE_META[key].emoji} {CIRCLE_META[key].label}
            </MenuItemOption>
          ))}
        </MenuOptionGroup>
        {!user && (
          <Text paddingX={3} paddingBottom={1} fontSize="10px" color={MUTED} whiteSpace="normal">
            Log in to filter your circles 🗝️
          </Text>
        )}

        <MenuDivider />
        <Eyebrow>Date</Eyebrow>
        <MenuOptionGroup type="radio" value={datePreset} onChange={handleDatePreset}>
          <MenuItemOption value="all" fontSize="sm">
            All time ♾️
          </MenuItemOption>
          <MenuItemOption value="today" fontSize="sm">
            Today ☀️
          </MenuItemOption>
          <MenuItemOption value="week" fontSize="sm">
            This week 🗓️
          </MenuItemOption>
          <MenuItemOption value="month" fontSize="sm">
            This month 🌙
          </MenuItemOption>
        </MenuOptionGroup>

        {onAdvancedToggle && (
          <>
            <MenuDivider />
            <MenuItem fontSize="sm" fontWeight={advancedOpen ? 700 : 400} onClick={() => onAdvancedToggle(!advancedOpen)}>
              {advancedOpen ? 'Advanced ✓ 🔬' : 'Advanced 🔬'}
            </MenuItem>
          </>
        )}

        {activeCount > 0 && (
          <>
            <MenuDivider />
            <MenuItem fontSize="sm" onClick={handleReset}>
              Reset filters ♻️
            </MenuItem>
          </>
        )}
      </MenuList>
    </Menu>
  );
};
