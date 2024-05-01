// import chakra button type
import type { ButtonProps } from '@chakra-ui/react';

interface ChakraButtonProps {
  defaultProps: ButtonProps;
}

export const ChakraButton: ChakraButtonProps = {
  defaultProps: {
    colorScheme: 'chakra.throat',
    size: 'sm',
    variant: 'solid'
  }
};
