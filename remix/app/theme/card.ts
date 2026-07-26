// The tt-card look shared by content-page cards (Schemas, Search, admin
// panels). One definition so a token change (radius/shadow/border) can't
// leave sibling pages visually drifted.
export const CARD_STYLES = {
  bg: 'var(--tt-card, #ffffff)',
  border: '1px solid',
  borderColor: 'var(--tt-border, #ececef)',
  borderRadius: 'var(--tt-radius-lg, 16px)',
  boxShadow: 'var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))'
} as const;
