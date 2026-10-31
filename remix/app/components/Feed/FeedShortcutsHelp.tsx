import React from 'react';
import { Box, Flex, Modal, ModalBody, ModalContent, ModalOverlay, Text } from '@chakra-ui/react';

// The '?' cheatsheet — a small house-styled modal listing the feed keyboard
// shortcuts (useFeedShortcuts). Escape and a backdrop tap both close it
// (Chakra defaults); the shortcuts themselves park while it is open.

const BORDER = '1px solid var(--tt-border, #ececef)';
const MUTED = 'var(--tt-muted, #9a9aa6)';
const TEXT = 'var(--tt-text, #5a5a66)';

const Key = ({ children }: { children: React.ReactNode }) => (
  <Box
    as="kbd"
    fontFamily="mono"
    fontSize="11px"
    fontWeight={600}
    lineHeight={1}
    color={TEXT}
    background="var(--tt-surface-alt, #f5f5f7)"
    border={BORDER}
    borderBottomWidth="2px"
    borderRadius="6px"
    paddingX="7px"
    paddingY="5px"
    minWidth="24px"
    textAlign="center"
  >
    {children}
  </Box>
);

type ShortcutRow = { keys: string[]; label: string };

const SHORTCUTS: ShortcutRow[] = [
  { keys: ['j', 'k'], label: 'Hop between posts (down / up) 🐇' },
  { keys: ['l'], label: 'Love the focused post — toggles a ❤️' },
  { keys: ['c'], label: 'Crack open its comments 💬' },
  { keys: ['n'], label: 'New post — jump to the composer ✍️' },
  { keys: ['?'], label: 'This cheatsheet 📜' },
  { keys: ['esc'], label: 'Drop the focus ring' }
];

export type FeedShortcutsHelpProps = {
  isOpen: boolean;
  onClose: () => void;
};

export const FeedShortcutsHelp = (props: FeedShortcutsHelpProps) => {
  const { isOpen, onClose } = props;

  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered size="sm" autoFocus={false} returnFocusOnClose={false}>
      <ModalOverlay background="rgba(16, 16, 20, 0.45)" backdropFilter="blur(2px)" />
      <ModalContent
        background="var(--tt-card, #ffffff)"
        border={BORDER}
        borderRadius="var(--tt-radius-lg, 16px)"
        boxShadow="var(--tt-shadow-panel, 0px 18px 60px rgba(0, 0, 0, 0.22))"
        marginX={4}
      >
        <ModalBody padding={5}>
          <Flex flexDirection="column" rowGap={3}>
            <Flex flexDirection="column" rowGap={1}>
              <Box
                fontFamily="mono"
                fontSize="10px"
                fontWeight={600}
                letterSpacing="0.08em"
                textTransform="uppercase"
                color={MUTED}
              >
                Feed · keyboard shortcuts ⌨️
              </Box>
              <Text fontSize="sm" fontWeight={600} color={TEXT}>
                Fly the feed without a mouse ✨
              </Text>
            </Flex>

            <Flex flexDirection="column" rowGap={2}>
              {SHORTCUTS.map((row) => (
                <Flex key={row.label} alignItems="center" columnGap={3}>
                  <Flex columnGap={1} minWidth="64px">
                    {row.keys.map((key) => (
                      <Key key={key}>{key}</Key>
                    ))}
                  </Flex>
                  <Text fontSize="sm" color={TEXT}>
                    {row.label}
                  </Text>
                </Flex>
              ))}
            </Flex>

            <Text fontSize="11px" color={MUTED}>
              Shortcuts nap while you type — press <Box as="span" fontFamily="mono">esc</Box> or tap outside to close.
            </Text>
          </Flex>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};
