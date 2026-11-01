import { DRAWER_MODAL_Z } from '../Nav/Drawer/useDrawer';

// Transfer confirmation must remain usable above the inspector and stacked
// success notifications from previous copies/imports, including on mobile.
// GlobalStyles places Lopu toasts ten levels above DRAWER_MODAL_Z.
export const TRANSFER_DIALOG_Z = DRAWER_MODAL_Z + 21;
export const TRANSFER_MENU_Z = TRANSFER_DIALOG_Z + 1;
