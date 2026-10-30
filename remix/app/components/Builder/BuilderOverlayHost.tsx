import React from 'react';

/** Nested Builder surfaces retain their owning dialog's stacking and focus
 * scope. Ordinary canvases keep Chakra's default document-body portal. */
export const BuilderOverlayHost = React.createContext<React.RefObject<HTMLElement | null> | undefined>(undefined);

/** Keep inspector inputs clear without changing floating-window order or
 * closing the assistant/developer panels. Launchers return when it closes. */
export const BUILDER_OVERLAY_CHROME_CSS = `
  html:has(.ttBuilderDrawer) .lopuLauncher,
  html:has(.ttBuilderDrawer) [class~="tt.devKit"] { display: none !important; }
`;
