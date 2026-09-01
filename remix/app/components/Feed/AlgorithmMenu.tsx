import React from 'react';
import {
  Box,
  Button,
  Center,
  Flex,
  Input,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuList,
  Text
} from '@chakra-ui/react';
import { useNavigate } from 'react-router';
import { Check, ChevronDown, X } from 'lucide-react';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';
import {
  DRAWER_MODAL_OVERLAY_Z,
  DRAWER_MODAL_Z,
  DRAWER_POPUP_Z,
  useIsMobileViewport
} from '~/components/Nav/Drawer/useDrawer';
import { RAINBOW } from '~/theme/rainbow';
import { growthStageFor } from './algorithmGrowth';
import type { EngagementEvent, PublicAlgorithm } from './feedTypes';

// The feed's algorithm picker: "Latest" (pure chronological) plus every
// algorithm the viewer owns, with inline create / branch / save-session
// actions. A pulsing dot on the trigger reminds you that the active
// algorithm learns as you scroll.

const INK = 'var(--tt-ink, #16161a)';
const MUTED = 'var(--tt-muted, #9a9aa6)';
const BORDER_COLOR = 'var(--tt-border, #ececef)';
const RADIUS_MD = 'var(--tt-radius-md, 12px)';

export type AlgorithmMenuProps = {
  value: string | null;
  onChange: (id: string | null) => void;
  // count renders the badge; the full list is only pulled when saving a session
  sessionEventCount: number;
  getSessionEvents: () => EngagementEvent[];
};

type ModalMode = 'new' | 'branch' | 'session';

// Hand-rolled overlay (UserSettingsModal pattern): rAF two-frame mount,
// Escape close, body scroll lock, mobile bottom sheet.
const InlineModal = (props: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) => {
  const { open, title, onClose, children } = props;

  const isMobile = useIsMobileViewport();
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setVisible(false);
      return;
    }
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  React.useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  const panel = (
    <Flex
      flexDirection="column"
      rowGap={4}
      padding={5}
      paddingBottom={isMobile ? 'calc(24px + var(--thingtime-safe-area-bottom))' : 5}
    >
      <Flex alignItems="center">
        <Text fontSize="md" fontWeight={700}>
          {title}
        </Text>
        <Center
          as="button"
          type="button"
          marginLeft="auto"
          width="28px"
          height="28px"
          borderRadius="8px"
          opacity={0.6}
          _hover={{ opacity: 1, background: 'var(--tt-surface-hover, #ececee)' }}
          cursor="pointer"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={15} strokeWidth={2} />
        </Center>
      </Flex>
      {children}
    </Flex>
  );

  return (
    <>
      <Box
        position="fixed"
        zIndex={DRAWER_MODAL_OVERLAY_Z}
        top={0}
        right={0}
        bottom={0}
        left={0}
        background="rgba(0,0,0,0.4)"
        opacity={visible ? 1 : 0}
        transition="opacity 0.24s ease-out"
        onClick={onClose}
      ></Box>

      {isMobile ? (
        <Box
          position="fixed"
          zIndex={DRAWER_MODAL_Z}
          right={0}
          bottom={0}
          left={0}
          maxHeight="88vh"
          sx={{
            '@supports (height: 100dvh)': {
              maxHeight: '88dvh'
            }
          }}
          background="var(--tt-card, white)"
          borderTopRadius="var(--tt-radius-xl, 20px)"
          boxShadow="0px -8px 30px rgba(0,0,0,0.18)"
          transform={visible ? 'translateY(0)' : 'translateY(100%)'}
          transition="transform 0.28s ease-out"
          overflowY="auto"
        >
          {panel}
        </Box>
      ) : (
        <Center
          position="fixed"
          zIndex={DRAWER_MODAL_Z}
          top={0}
          right={0}
          bottom={0}
          left={0}
          pointerEvents="none"
          padding={6}
        >
          <Box
            width="380px"
            maxWidth="100%"
            maxHeight="86vh"
            background="var(--tt-card, white)"
            borderRadius="var(--tt-radius-lg, 16px)"
            boxShadow="var(--tt-shadow-panel, 0px 18px 60px rgba(0,0,0,0.22))"
            transform={visible ? 'scale(1)' : 'scale(0.96)'}
            opacity={visible ? 1 : 0}
            transition="transform 0.22s ease-out, opacity 0.22s ease-out"
            overflowY="auto"
            pointerEvents="all"
          >
            {panel}
          </Box>
        </Center>
      )}
    </>
  );
};

export const AlgorithmMenu = (props: AlgorithmMenuProps) => {
  const { value, onChange, sessionEventCount, getSessionEvents } = props;

  const api = useApi();
  const user = useCurrentUser();
  const lopu = useLopu();
  const navigate = useNavigate();

  const [algorithms, setAlgorithms] = React.useState<PublicAlgorithm[]>([]);
  // `sessionEventCount` is the whole scroll session's log — it never resets,
  // because "Save session as algorithm" trains on all of it. The growth stage
  // therefore overlays only the events recorded SINCE the list was last
  // loaded: anything older is already inside the refetched `eventCount`, and
  // on an algorithm switch this session's training belongs to the previous
  // algorithm, not the newly selected one.
  const [sessionBaseline, setSessionBaseline] = React.useState(0);
  const [modalMode, setModalMode] = React.useState<ModalMode | null>(null);
  const [draftName, setDraftName] = React.useState('');
  const [draftEmoji, setDraftEmoji] = React.useState('🧠');
  const [saving, setSaving] = React.useState(false);

  const apiRef = React.useRef(api);
  apiRef.current = api;
  const sessionEventCountRef = React.useRef(sessionEventCount);
  sessionEventCountRef.current = sessionEventCount;

  const active = value ? algorithms.find((algorithm) => algorithm.id === value) || null : null;

  const reload = React.useCallback(async () => {
    // Snapshot the session count BEFORE the request. Events recorded while it
    // is in flight cannot be inside the total it returns, so rebasing on the
    // post-await count would subtract them twice and the dot could regress
    // (🐣 → 🥚 mid-scroll). Over-counting the overlap is the safe direction —
    // that is what keeps the stage monotonic.
    const baseline = sessionEventCountRef.current;
    if (!user) {
      setAlgorithms([]);
      setSessionBaseline(baseline);
      return;
    }
    try {
      const resp = await apiRef.current.v1.algorithms.list();
      setAlgorithms(resp.algorithms || []);
      // rebase the overlay only when fresh counts actually landed
      setSessionBaseline(baseline);
    } catch {
      // background load — stay quiet, the menu just shows Latest
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  React.useEffect(() => {
    reload();
  }, [reload]);

  const handleSelect = async (id: string | null) => {
    if (!user) {
      if (id !== null) {
        lopu({ title: 'Log in to train algorithms 🗝️', status: 'info', duration: 6000 });
        return;
      }
      onChange(null);
      return;
    }

    try {
      await apiRef.current.v1.algorithms.setActive({ algorithmId: id });
      onChange(id);
      reload();
    } catch (err: any) {
      lopu({ title: err?.error || 'Could not switch algorithms 😞', status: 'error' });
    }
  };

  const openModal = (mode: ModalMode) => {
    if (!user) {
      lopu({ title: 'Log in to train algorithms 🗝️', status: 'info', duration: 6000 });
      return;
    }

    if (mode === 'branch' && active) {
      setDraftName(`${active.name} (branch)`);
      setDraftEmoji(active.emoji || '🌿');
    } else if (mode === 'session') {
      setDraftName(
        `Session ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
      );
      setDraftEmoji('💾');
    } else {
      setDraftName('');
      setDraftEmoji('🧠');
    }

    setModalMode(mode);
  };

  const handleSave = async () => {
    const name = draftName.trim();
    if (!name || saving || !modalMode) return;

    setSaving(true);
    try {
      const payload: any = { name, emoji: draftEmoji.trim() || undefined };
      if (modalMode === 'branch' && value) payload.branchFrom = value;
      if (modalMode === 'session') payload.events = getSessionEvents();

      const resp = await apiRef.current.v1.algorithms.create(payload);
      const created: PublicAlgorithm = resp.algorithm;

      if (modalMode === 'session') {
        // report what the server actually trained on, not the raw session size
        lopu({
          title: `Trained on ${created.eventCount} moment${created.eventCount === 1 ? '' : 's'} from this session 🧠`,
          status: 'success'
        });
      } else {
        await apiRef.current.v1.algorithms.setActive({ algorithmId: created.id });
        onChange(created.id);
        lopu({
          title: `${created.emoji} ${created.name} is curating your feed ✨`,
          status: 'success',
          duration: 6000
        });
      }

      setModalMode(null);
      reload();
    } catch (err: any) {
      lopu({ title: err?.error || 'Could not save that algorithm 😞', status: 'error' });
    }
    setSaving(false);
  };

  const buttonLabel = value === null ? '⏱️ Latest' : active ? `${active.emoji} ${active.name}` : '🧠 Algorithm';

  // growth stage (🥚→🐣→🐥→🧠): server-counted signals + this session's
  // events that the server total cannot include yet (see `sessionBaseline`).
  // The slight overlap after a flush lands before a list refetch can only ever
  // nudge the total forward — stages are monotonic, so the dot never regresses
  // mid-session.
  const sessionSinceLoad = Math.max(0, sessionEventCount - sessionBaseline);
  const activeStage = active ? growthStageFor((active.eventCount || 0) + sessionSinceLoad) : null;

  const modalTitle =
    modalMode === 'branch'
      ? 'Branch algorithm 🌿'
      : modalMode === 'session'
        ? 'Save session as algorithm 💾'
        : 'New algorithm ➕';

  return (
    <>
      <Menu placement="bottom-start" autoSelect={false}>
        <MenuButton
          as={Button}
          size="sm"
          variant="outline"
          fontWeight={600}
          color={INK}
          borderColor={BORDER_COLOR}
          borderRadius={RADIUS_MD}
          background="var(--tt-card, #ffffff)"
          _hover={{ background: 'var(--tt-surface-alt, #f5f5f7)' }}
          _active={{ background: 'var(--tt-surface-hover, #ececee)' }}
          rightIcon={<ChevronDown size={13} />}
          maxWidth="220px"
        >
          <Flex as="span" alignItems="center" columnGap={2} whiteSpace="normal">
            <Box as="span" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
              {buttonLabel}
            </Box>
            {value !== null && (
              <Box
                as="span"
                flexShrink={0}
                display="inline-block"
                width="6px"
                height="6px"
                borderRadius="999px"
                background={activeStage?.color || 'var(--tt-rainbow-3, #58ca70)'}
                title={activeStage ? `${activeStage.name} ${activeStage.emoji} — ${activeStage.tip}` : 'Learning as you scroll 🧠'}
                sx={{
                  animation: 'tt-training-pulse 1.6s ease-in-out infinite',
                  '@keyframes tt-training-pulse': {
                    '0%, 100%': { opacity: 0.35, transform: 'scale(0.8)' },
                    '50%': { opacity: 1, transform: 'scale(1.15)' }
                  }
                }}
              ></Box>
            )}
          </Flex>
        </MenuButton>
        <MenuList zIndex={DRAWER_POPUP_Z} minWidth="250px" borderRadius={RADIUS_MD} borderColor={BORDER_COLOR}>
          <MenuItem fontSize="sm" onClick={() => handleSelect(null)}>
            <Flex alignItems="center" columnGap={2} width="100%">
              <Box as="span">⏱️ Latest</Box>
              <Text as="span" fontSize="10px" color={MUTED}>
                chronological
              </Text>
              {value === null && <Check size={13} style={{ marginLeft: 'auto', flexShrink: 0 }} />}
            </Flex>
          </MenuItem>

          {algorithms.length > 0 && <MenuDivider />}
          {algorithms.map((algorithm) => (
            <MenuItem key={algorithm.id} fontSize="sm" onClick={() => handleSelect(algorithm.id)}>
              <Flex alignItems="center" columnGap={2} width="100%" minWidth={0}>
                <Box as="span" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                  {algorithm.emoji} {algorithm.name}
                </Box>
                <Text
                  as="span"
                  fontSize="10px"
                  color={MUTED}
                  flexShrink={0}
                  title={growthStageFor(algorithm.eventCount).tip}
                >
                  · {algorithm.eventCount} events {growthStageFor(algorithm.eventCount).emoji}
                </Text>
                {value === algorithm.id && <Check size={13} style={{ marginLeft: 'auto', flexShrink: 0 }} />}
              </Flex>
            </MenuItem>
          ))}

          <MenuDivider />
          <MenuItem fontSize="sm" onClick={() => openModal('new')}>
            New algorithm ➕
          </MenuItem>
          {active && (
            <MenuItem fontSize="sm" onClick={() => openModal('branch')}>
              Branch current 🌿
            </MenuItem>
          )}
          <MenuItem fontSize="sm" isDisabled={sessionEventCount === 0} onClick={() => openModal('session')}>
            <Flex alignItems="center" columnGap={2} width="100%">
              <Box as="span">Save session as algorithm 💾</Box>
              {sessionEventCount > 0 && (
                <Text as="span" fontSize="10px" color={MUTED}>
                  · {sessionEventCount}
                </Text>
              )}
            </Flex>
          </MenuItem>
          <MenuItem fontSize="sm" onClick={() => navigate('/settings')}>
            Manage in settings ⚙️
          </MenuItem>
        </MenuList>
      </Menu>

      <InlineModal open={modalMode !== null} title={modalTitle} onClose={() => setModalMode(null)}>
        <Flex flexDirection="column" rowGap={3}>
          {modalMode === 'session' && (
            <Text fontSize="xs" color={MUTED} whiteSpace="normal">
              Trains a fresh algorithm on the {sessionEventCount} moments from this scroll session.
            </Text>
          )}
          {modalMode === 'branch' && active && (
            <Text fontSize="xs" color={MUTED} whiteSpace="normal">
              Copies everything {active.emoji} {active.name} has learned into a new algorithm you can steer separately.
            </Text>
          )}
          <Flex columnGap={2}>
            <Input
              width="64px"
              flexShrink={0}
              textAlign="center"
              maxLength={4}
              aria-label="Algorithm emoji"
              value={draftEmoji}
              onChange={(event) => setDraftEmoji(event.target.value)}
            />
            <Input
              flex="1"
              placeholder="Algorithm name"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleSave();
              }}
            />
          </Flex>
          <Button
            color="white"
            fontFamily="heading"
            fontWeight={600}
            background={RAINBOW}
            backgroundSize="calc(100px + 200%)"
            sx={{ animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)' }}
            _hover={{ opacity: 0.9 }}
            borderRadius={RADIUS_MD}
            isDisabled={!draftName.trim()}
            isLoading={saving}
            onClick={handleSave}
          >
            {modalMode === 'session' ? 'Save + train 🧠' : modalMode === 'branch' ? 'Branch it 🌿' : 'Create ➕'}
          </Button>
        </Flex>
      </InlineModal>
    </>
  );
};
