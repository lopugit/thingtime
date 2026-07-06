// import chakra button type
import type { ButtonProps } from '@chakra-ui/react';

export const ChakraButton = {
  defaultProps: {
    // Solid ink buttons per the v1 product-UI mockup; resolves through the
    // runtime theme (--tt-ink / --tt-text) via colors.tsx ttInk tokens.
    colorScheme: 'ttInk',
    size: 'sm',
    variant: 'solid'
  } as ButtonProps,
  variants: {
    // Chakra's solid variant hardcodes white text; in dark themes --tt-ink is
    // near-white, so pair the ink background with the card color instead.
    solid: {
      color: 'var(--tt-card, #ffffff)'
    }
  }
};
