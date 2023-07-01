import { extendTheme } from '@chakra-ui/react'
import { colors } from './colors'

export const theme = extendTheme({
  colors,
  // edit Input defaultProps
  styles: {
    global: {
      // make all elements padding and margin animate
      '*': {
        transition: 'padding 0.2s ease, margin 0.2s ease'
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
    Input: {
      defaultProps: {
        focusBorderColor: 'transparent'
      }
    }
  }
})
