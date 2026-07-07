import React from 'react';
import { Box, Button, ButtonProps, Flex, Text } from '@chakra-ui/react';

import { RAINBOW } from '~/theme/rainbow';

// Shared building blocks for the /settings page: section cards with eyebrow
// headers, the settingRow idiom (mirrors UserSettingsModal), and the rainbow
// primary CTA button idiom (mirrors profile.tsx).

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

export const SettingsSection = (props: {
  eyebrow: string;
  description?: string;
  children: React.ReactNode;
}) => (
  <Flex
    flexDirection="column"
    rowGap={3}
    width="100%"
    background="var(--tt-card, #ffffff)"
    border="1px solid var(--tt-border, #ececef)"
    borderRadius="var(--tt-radius-lg, 16px)"
    padding={[5, 6]}
  >
    <Box>
      <Text
        fontFamily={MONO}
        fontSize="10px"
        fontWeight={600}
        letterSpacing="0.08em"
        textTransform="uppercase"
        color="var(--tt-muted, #9a9aa6)"
      >
        {props.eyebrow}
      </Text>
      {props.description && (
        <Text fontSize="xs" color="var(--tt-text, #5a5a66)" whiteSpace="normal" marginTop={1}>
          {props.description}
        </Text>
      )}
    </Box>
    {props.children}
  </Flex>
);

export const SettingRow = (props: { label: string; hint?: string; children: React.ReactNode }) => (
  <Flex alignItems="center" columnGap={4} paddingY={2} whiteSpace="normal">
    <Box minWidth={0}>
      <Text fontSize="sm" color="var(--tt-ink, #16161a)">
        {props.label}
      </Text>
      {props.hint && (
        <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
          {props.hint}
        </Text>
      )}
    </Box>
    <Box marginLeft="auto" flexShrink={0}>
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
