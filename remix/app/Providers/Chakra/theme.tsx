import {
  extendTheme,
  NumberDecrementStepper,
  NumberIncrementStepper,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  Select,
  Switch
} from '@chakra-ui/react';

import { colors } from './colors';
import { space } from './space';
import { ChakraButton } from './Components/Button';

export const theme = extendTheme({
  colors,
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
      'select:focus': {
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
    Select: {
      baseStyle: {
        field: {
          // "padding-inline-start": "0px",
        },
        icon: {
          // height: "8px",
          width: '14px'
        }
      }
    },
    Switch: {
      baseStyle: {
        track: {
          background: 'grays.medium',
          _checked: {
            background: 'chakras.throat'
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

Select.defaultProps = {
  ...Select.defaultProps,
  focusBorderColor: 'transparent',
  outline: '0px solid',
  border: 'none',
  ps: '0px',
  px: '0px',
  sx: {
    paddingInlineStart: '0px',
    paddingInlineEnd: '24px'
  }
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
