/** Shared pointer semantics for Things, stored files and paired devices. */
export const browseClickIntent = (event: {
  button: number; detail: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean;
}): 'open' | 'select' | 'native' | 'ignore' => {
  if (event.button !== 0 || event.altKey) return 'native';
  // The first click already opened/toggled. A double click must not repeat it.
  if (event.detail > 1) return 'ignore';
  return event.metaKey || event.ctrlKey || event.shiftKey ? 'select' : 'open';
};

export const BROWSE_CONTROLS_SX = {
  '& .thing-item-controls': { opacity: 0, pointerEvents: 'none', transition: 'opacity 120ms ease' },
  '&:hover .thing-item-controls, &:focus-within .thing-item-controls, & .thing-item-controls[data-visible="true"]': { opacity: 1, pointerEvents: 'auto' },
  '& .thing-item-controls button, & .thing-item-controls label': { minWidth: '32px', minHeight: '32px' },
  '& .thing-item-controls label': { justifyContent: 'center', margin: 0 },
  '@media (hover: none), (pointer: coarse)': {
    '& .thing-item-controls': { opacity: 1, pointerEvents: 'auto' },
    '& .thing-item-controls button, & .thing-item-controls label': { minWidth: '44px', minHeight: '44px' }
  }
};

/** Context clicks use the pointer; action buttons anchor to their live bounds. */
export const browseMenuPosition = (event: {
  type: string; clientX: number; clientY: number;
  currentTarget: { getBoundingClientRect: () => { left: number; bottom: number } };
}): { clientX: number; clientY: number } => {
  if (event.type === 'contextmenu') return { clientX: event.clientX, clientY: event.clientY };
  const bounds = event.currentTarget.getBoundingClientRect();
  return { clientX: bounds.left, clientY: bounds.bottom };
};
