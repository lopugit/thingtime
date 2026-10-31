import {
  extendTheme,
  NumberDecrementStepper,
  NumberIncrementStepper,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  Switch
} from '@chakra-ui/react';

import { colors } from './colors';
import { space } from './space';
import { ChakraButton } from './Components/Button';
import { ChakraSelect } from './Components/Select';

export const theme = extendTheme({
  colors,
  // Design-language fonts resolve through the runtime theme CSS variables
  // (Space Grotesk / Hanken Grotesk / JetBrains Mono by default).
  fonts: {
    heading: "var(--tt-font-heading, 'Space Grotesk', system-ui, sans-serif)",
    body: "var(--tt-font-body, 'Hanken Grotesk', system-ui, sans-serif)",
    mono: "var(--tt-font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)"
  },
  // edit Input defaultProps
  space,
  sizes: space,
  styles: {
    global: {
      // make all elements padding and margin animate
      '*': {
        transition: 'padding 0.2s ease, margin 0.2s ease-out'
      },
      // make all elements have a transparent focus border
      'input:focus': {
        boxShadow: 'none !important',
        borderColor: 'transparent !important'
      },
      // make all elements have a transparent focus border
      'textarea:focus': {
        boxShadow: 'none !important',
        borderColor: 'transparent !important'
      },
      // make all elements have a transparent focus border
      'button:focus': {
        boxShadow: 'none !important',
        borderColor: 'transparent !important'
      },
      // make all elements have a transparent focus border
      'div:focus': {
        boxShadow: 'none !important',
        borderColor: 'transparent !important'
      },
      // make all elements have a transparent focus border
      'a:focus': {
        boxShadow: 'none !important',
        borderColor: 'transparent !important'
      },
      // make all elements have a transparent focus border
      'span:focus': {
        boxShadow: 'none !important',
        borderColor: 'transparent !important'
      }
    }
  },
  components: {
    Button: ChakraButton,
    Input: {
      defaultProps: {
        // focusBorderColor: "transparent",
        // outline: "0px solid",
        // border: "0px solid",
      },
      baseStyle: {
        // "padding-inline-start": "0px",
        field: {
          // "padding-inline-start": "0px",
        }
      }
    },
    Select: ChakraSelect,
    Switch: {
      baseStyle: {
        track: {
          background: 'grays.medium',
          _checked: {
            background: 'var(--tt-rainbow-3, #58ca70)'
          }
        }
      }
    },
    NumberInput: {
      baseStyle: {
        field: {
          width: 'auto'
          // border: "none",
        }
      }
    }
  }
});

Switch.defaultProps = {
  ...Switch.defaultProps,
  as: 'div'
};

NumberInput.defaultProps = {
  ...NumberInput.defaultProps,
  variant: 'unstyled'
};

NumberInputField.defaultProps = {
  ...NumberInputField.defaultProps,
  height: '100%',
  pr: 3,
  fontSize: 'inherit'
  // variant: "unstyled",
};

NumberInputStepper.defaultProps = {
  ...NumberInputStepper.defaultProps,
  border: 'none',
  color: 'grays.medium'
};

NumberIncrementStepper.defaultProps = {
  ...NumberIncrementStepper.defaultProps,
  border: 'none'
};
NumberDecrementStepper.defaultProps = {
  ...NumberDecrementStepper.defaultProps,
  border: 'none'
};
