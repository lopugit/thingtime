import React from 'react';

/** Nested Builder surfaces retain their owning dialog's stacking and focus
 * scope. Ordinary canvases keep Chakra's default document-body portal. */
export const BuilderOverlayHost = React.createContext<React.RefObject<HTMLElement | null> | undefined>(undefined);

/** Keep inspector inputs clear without changing floating-window order or
 * closing the assistant/developer panels. Launchers return when it closes. */
export const BUILDER_OVERLAY_CHROME_CSS = `
  html:has(.ttBuilderDrawer) .lopuLauncher,
  html:has(.ttBuilderDrawer) [class~="tt.devKit"],
  html:has([data-tt-device-details="drawer"]) .lopuLauncher,
  html:has([data-tt-device-details="drawer"]) [class~="tt.devKit"] { display: none !important; }
  /* Visible opt-in mobile workspaces retain the navigation Lopu opener.
   * Hidden tabs and collapsed settings must not suppress another page's bubble. */
  @media (max-width: 48em) {
    html:has([data-tt-mobile-control-workspace]:not([hidden] *):not(details:not([open]) *)) .lopuLauncher,
    html:has([data-tt-device-details="page"]) .lopuLauncher,
    html:has([data-tt-device-details="page"]) [class~="tt.devKit"] { display: none !important; }
  }
`;
