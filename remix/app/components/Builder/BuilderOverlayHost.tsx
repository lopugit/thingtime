import React from 'react';

/** Nested Builder surfaces retain their owning dialog's stacking and focus
 * scope. Ordinary canvases keep Chakra's default document-body portal. */
export const BuilderOverlayHost = React.createContext<React.RefObject<HTMLElement | null> | undefined>(undefined);
