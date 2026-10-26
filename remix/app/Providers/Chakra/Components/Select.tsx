// All Chakra Select consumers share the runtime Thingtime design tokens.
// Keep the native select for keyboard, touch and assistive-technology behavior.
export const ChakraSelect = {
  defaultProps: {
    variant: 'outline'
  },
  baseStyle: {
    field: {
      minWidth: 0,
      _disabled: { opacity: 0.4, cursor: 'not-allowed' }
    },
    icon: { width: '14px', color: 'tt.muted' }
  },
  sizes: {
    xs: { field: { borderRadius: 'var(--tt-radius-xs, 7px)' } },
    sm: { field: { borderRadius: 'var(--tt-radius-sm, 9px)' } },
    md: { field: { borderRadius: 'var(--tt-radius-sm, 9px)' } },
    lg: { field: { borderRadius: 'var(--tt-radius-md, 12px)' } }
  },
  variants: {
    outline: {
      field: {
        bg: 'tt.card',
        color: 'tt.ink',
        '> option, > optgroup': { bg: 'tt.card', color: 'tt.ink' },
        border: 'var(--tt-border-w, 1px) solid',
        borderColor: 'tt.border',
        paddingInlineStart: '12px',
        paddingInlineEnd: '32px',
        _hover: { borderColor: 'tt.faint' },
        _focus: { borderColor: 'tt.ink', boxShadow: 'none' },
        _focusVisible: {
          borderColor: 'tt.ink',
          boxShadow: 'none',
          outline: '2px solid var(--tt-ink, #16161a)',
          outlineOffset: '2px'
        },
        _invalid: { borderColor: 'tt.danger', boxShadow: 'none' }
      }
    }
  }
};
