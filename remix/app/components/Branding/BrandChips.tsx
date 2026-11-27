import { Box, Flex, Text } from '@chakra-ui/react';
import React from 'react';

// Wrapping pill group for the /branding gallery filters and studio pickers.
// Unlike the segmented control it is happy with a dozen options on a phone:
// the pills wrap instead of running off the edge. `swatch` puts a colour chip
// in front of the label (the studio's background picker).

const MONO = 'var(--tt-font-mono, "JetBrains Mono", monospace)';

export type ChipOption<T extends string> = { value: T; label: string; swatch?: string };

export const ChipLabel = ({ children }: { children: React.ReactNode }) => (
  <Text fontFamily={MONO} fontSize="10px" fontWeight={600} letterSpacing="0.12em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)">
    {children}
  </Text>
);

// Pass `onChange` as an arrow rather than a bare state setter: a setter's
// updater-function overload widens T to string.
export const ChipGroup = <T extends string>({
  label,
  options,
  value,
  onChange,
  testId
}: {
  label: string;
  options: Array<ChipOption<T>>;
  value: T;
  onChange: (next: T) => void;
  testId?: string;
}) => (
  <Flex flexDir="column" gap="8px" minW={0}>
    <ChipLabel>{label}</ChipLabel>
    <Flex role="group" aria-label={label} gap="6px" flexWrap="wrap" data-testid={testId}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Flex
            as="button"
            type="button"
            key={option.value}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            alignItems="center"
            gap="7px"
            pl={option.swatch ? '6px' : '12px'}
            pr="12px"
            height="32px"
            borderRadius="full"
            fontSize="13px"
            fontWeight={600}
            fontFamily="inherit"
            whiteSpace="nowrap"
            color={active ? 'var(--tt-card, #fff)' : 'var(--tt-text, #5a5a66)'}
            bg={active ? 'var(--tt-ink, #16161a)' : 'var(--tt-surface-alt, #f5f5f7)'}
            _hover={active ? undefined : { color: 'var(--tt-ink, #16161a)' }}
            transition="background 140ms ease, color 140ms ease"
          >
            {option.swatch ? (
              <Box
                aria-hidden
                width="20px"
                height="20px"
                borderRadius="full"
                flex="none"
                bg={option.swatch}
                boxShadow={active ? 'inset 0 0 0 1px rgba(255,255,255,.35)' : 'inset 0 0 0 1px rgba(0,0,0,.1)'}
              />
            ) : null}
            {option.label}
          </Flex>
        );
      })}
    </Flex>
  </Flex>
);
