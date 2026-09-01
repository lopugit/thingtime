export const DEVICE_DRAWER_DEFAULT_WIDTH = 560;
export const DEVICE_DRAWER_MIN_WIDTH = 420;
export const DEVICE_DRAWER_MOBILE_MIN_WIDTH = 280;
export const DEVICE_DRAWER_MAX_WIDTH = 900;
export const DEVICE_DRAWER_VIEWPORT_GUTTER = 24;
export const DEVICE_DRAWER_KEYBOARD_STEP = 32;
export const DEVICE_DRAWER_DESKTOP_BREAKPOINT = 768;

export const deviceDrawerMinimumWidth = (viewportWidth: number): number => {
	if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return DEVICE_DRAWER_MIN_WIDTH;
	if (viewportWidth >= DEVICE_DRAWER_DESKTOP_BREAKPOINT) return DEVICE_DRAWER_MIN_WIDTH;

	return Math.min(DEVICE_DRAWER_MOBILE_MIN_WIDTH, Math.floor(viewportWidth));
};

export const deviceDrawerMaximumWidth = (viewportWidth: number): number => {
	if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return DEVICE_DRAWER_DEFAULT_WIDTH;
	if (viewportWidth < DEVICE_DRAWER_DESKTOP_BREAKPOINT) return Math.floor(viewportWidth);

	return Math.max(DEVICE_DRAWER_MIN_WIDTH, Math.min(DEVICE_DRAWER_MAX_WIDTH, Math.floor(viewportWidth - DEVICE_DRAWER_VIEWPORT_GUTTER)));
};

export const clampDeviceDrawerWidth = (width: number, viewportWidth: number): number => {
	const maximum = deviceDrawerMaximumWidth(viewportWidth);
	const minimum = deviceDrawerMinimumWidth(viewportWidth);
	const normalized = Number.isFinite(width) ? Math.round(width) : DEVICE_DRAWER_DEFAULT_WIDTH;

	return Math.min(maximum, Math.max(minimum, normalized));
};
