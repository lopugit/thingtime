export const DEVICE_DRAWER_DEFAULT_WIDTH = 560;
export const DEVICE_DRAWER_MIN_WIDTH = 420;
export const DEVICE_DRAWER_MAX_WIDTH = 900;
export const DEVICE_DRAWER_VIEWPORT_GUTTER = 24;
export const DEVICE_DRAWER_KEYBOARD_STEP = 32;

export const deviceDrawerMaximumWidth = (viewportWidth: number): number => {
	if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return DEVICE_DRAWER_DEFAULT_WIDTH;

	return Math.max(DEVICE_DRAWER_MIN_WIDTH, Math.min(DEVICE_DRAWER_MAX_WIDTH, Math.floor(viewportWidth - DEVICE_DRAWER_VIEWPORT_GUTTER)));
};

export const clampDeviceDrawerWidth = (width: number, viewportWidth: number): number => {
	const maximum = deviceDrawerMaximumWidth(viewportWidth);
	const normalized = Number.isFinite(width) ? Math.round(width) : DEVICE_DRAWER_DEFAULT_WIDTH;

	return Math.min(maximum, Math.max(DEVICE_DRAWER_MIN_WIDTH, normalized));
};
