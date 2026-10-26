export const drawerRowStyles = `
/* Shared navigation contract for native rows and ordinary authored blocks. */
.tt-drawer-row {
 display: flex; align-items: center; gap: 8px; box-sizing: border-box;
 width: calc(100% - 16px); min-width: 0; margin: 0 8px; padding: 7px 12px;
 border: 0; border-radius: var(--tt-radius-sm, 9px); background: transparent;
 color: inherit; font-family: inherit; font-size: var(--chakra-fontSizes-sm, 14px); line-height: 1.5;
 text-align: left; text-decoration: none; cursor: pointer; transition: background .15s ease;
}
.tt-drawer-row:hover { background: var(--tt-surface-hover, #ececee); }
.tt-drawer-row[data-selected="true"], .tt-drawer-row[data-selected="true"]:hover { background: var(--tt-surface-alt, #f5f5f7); }
.tt-drawer-row:focus-visible { outline: 2px solid var(--tt-ink, #222); outline-offset: -2px; }
.tt-drawer-row-icon { flex-shrink: 0; font-size: 13px; line-height: 1; display: flex; align-items: center; justify-content: center; width: 13px; }
.tt-drawer-row-label { min-width: 0; max-width: 100%; overflow-wrap: anywhere; word-break: break-word; }
.tt-drawer-sublevel .tt-drawer-row { padding-top: 6px; padding-bottom: 6px; font-size: var(--chakra-fontSizes-xs, 12px); }
.tt-drawer-sublevel .tt-drawer-row-icon { font-size: 11px; width: 11px; }
.tt-drawer-children { width: auto; flex-shrink: 0; font-size: 11px; margin-left: auto; }
[data-block-id="custom-drawer-row"] > .tt-drawer-row:first-child { flex: 1; width: auto; }
`;
