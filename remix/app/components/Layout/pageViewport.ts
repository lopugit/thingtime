// Shared containing viewport for page chrome and Lopu split panes.
export const PAGE_VIEWPORT_CSS = `
        #lopuPageViewport { width: 100%; }
        #lopuPageViewport[data-lopu-split] {
          position: fixed;
          top: var(--lopu-inset-top); right: var(--lopu-inset-right);
          bottom: var(--lopu-inset-bottom); left: var(--lopu-inset-left);
          width: auto; overflow: hidden; transform: translateZ(0); isolation: isolate;
          container-type: inline-size; container-name: lopu-page;
        }
        #lopuPageViewport[data-lopu-split] > #lopuPageScroll { height: 100%; overflow: auto; }
        @container lopu-page (max-width: 680px) {
          .thingtimeTopNavInner { padding-left: 48px !important; padding-right: 12px !important; }
          .nav-left-section { padding-left: 0 !important; column-gap: 4px !important; }
          .nav-right-section { column-gap: 12px !important; }
          .nav-search-section { display: none !important; }
          .electron-titlebar-account-button { max-width: 100px; overflow: hidden; }
          .electron-titlebar-account-button a { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
        }
        @container lopu-page (max-width: 440px) {
          .electron-titlebar-account-button, .electron-titlebar-home-button { display: none !important; }
        }
`;
