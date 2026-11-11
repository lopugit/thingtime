export const QUICK_SWITCHER_TOGGLE_EVENT = 'thingtime:quick-switcher-toggle';
export const toggleQuickSwitcher = (): void => {
	if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(QUICK_SWITCHER_TOGGLE_EVENT));
};
