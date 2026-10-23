import React from 'react';
import { Box, Button, type ButtonProps, Flex, Text } from '@chakra-ui/react';
import { useLocation } from 'react-router';
import { FiChevronDown } from 'react-icons/fi';
import { RAINBOW } from '~/theme/rainbow';

// Native disclosures keep form state mounted while collapsed and provide
// keyboard/screen-reader support without putting controls inside the trigger.
export const SettingsSection = (props: {
  eyebrow: string;
  description?: string;
  summary?: React.ReactNode;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: React.ReactNode;
}) => {
  const ref = React.useRef<HTMLDetailsElement>(null);
  const { hash } = useLocation();
  const toggleRef = React.useRef(props.onToggle);
  toggleRef.current = props.onToggle;
  React.useEffect(() => {
    const section = ref.current;
    if (!section || !hash) return;
    let id: string;
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch {
      return;
    }
    const selector = `[id="${CSS.escape(id)}"]`;
    const target = section.querySelector<HTMLElement>(selector) || section.closest<HTMLElement>(selector);
    if (target) {
      section.open = true;
      toggleRef.current?.(true);
      target.scrollIntoView({ block: 'start' });
    }
  }, [hash]);
  return (
    <Box
      as="details"
      ref={ref}
      open={props.open}
      onToggle={(event) => {
        if (event.target === event.currentTarget) props.onToggle?.((event.currentTarget as HTMLDetailsElement).open);
      }}
      data-settings-section
      width="100%"
      minW={0}
      background="var(--tt-card, #ffffff)"
      border="1px solid var(--tt-border, #ececef)"
      borderRadius="var(--tt-radius-lg, 16px)"
      whiteSpace="normal"
      sx={{ '& > summary::-webkit-details-marker': { display: 'none' }, '&[open] > summary .settings-chevron': { transform: 'rotate(180deg)' } }}
    >
      <Box
        as="summary"
        display="flex"
        alignItems="flex-start"
        gap={3}
        cursor="pointer"
        listStyleType="none"
        padding={[4, 5]}
        borderRadius="inherit"
        _hover={{ background: 'var(--tt-surface-hover, #f5f5f7)' }}
        _focusVisible={{ outline: '2px solid var(--tt-accent, #805ad5)', outlineOffset: '2px' }}
      >
        <Box flex="1" minW={0}>
          <Text as="span" display="block" fontSize="sm" fontWeight={600} color="var(--tt-ink, #16161a)" overflowWrap="anywhere">
            {props.eyebrow}
          </Text>
          {props.description && (
            <Text as="span" display="block" fontSize="xs" color="var(--tt-text, #5a5a66)" mt={1} lineHeight="1.6" overflowWrap="anywhere">
              {props.description}
            </Text>
          )}
          {props.summary != null && (
            <Text as="span" display="block" fontSize="xs" fontWeight={500} color="var(--tt-muted, #777783)" mt={2} overflowWrap="anywhere">
              {props.summary}
            </Text>
          )}
        </Box>
        <Box as={FiChevronDown} className="settings-chevron" aria-hidden="true" flexShrink={0} mt={0.5} />
      </Box>
      <Flex direction="column" gap={3} minW={0} px={[4, 5]} pb={[4, 5]} borderTop="1px solid var(--tt-border, #ececef)" pt={4}>
        {props.children}
      </Flex>
    </Box>
  );
};

export const SettingRow = (props: { label: React.ReactNode; hint?: string; children: React.ReactNode }) => (
  <Flex alignItems="center" gap={3} flexWrap="wrap" paddingY={2} whiteSpace="normal" minW={0}>
    <Box minWidth={0} flex="1 1 220px" overflowWrap="anywhere">
      <Text fontSize="sm" color="var(--tt-ink, #16161a)">
        {props.label}
      </Text>
      {props.hint && (
        <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
          {props.hint}
        </Text>
      )}
    </Box>
    <Box marginLeft="auto" minWidth={0} maxWidth="100%" flex="0 1 auto">
      {props.children}
    </Box>
  </Flex>
);

export const RainbowButton = (props: ButtonProps) => (
  <Button
    color="white"
    fontFamily="heading"
    fontWeight="600"
    background={RAINBOW}
    backgroundSize="calc(100px + 200%)"
    sx={{ animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)' }}
    _hover={{ opacity: 0.9 }}
    borderRadius="var(--tt-radius-md, 12px)"
    {...props}
  />
);
