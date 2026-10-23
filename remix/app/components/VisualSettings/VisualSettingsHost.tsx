import React from 'react';

import { useThingtime } from '../Thingtime/useThingtime';

const DEFAULT_BOTTOM_PADDING = 72;
const MIN_BOTTOM_PADDING = 0;
const MAX_BOTTOM_PADDING = 360;
const MIN_NATIVE_DEVKIT_OFFSET = 36;

const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const normalizeBottomPadding = (value: unknown) => {
	const numericValue = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : DEFAULT_BOTTOM_PADDING;

	if (!Number.isFinite(numericValue)) return DEFAULT_BOTTOM_PADDING;

	return Math.round(clampNumber(numericValue, MIN_BOTTOM_PADDING, MAX_BOTTOM_PADDING));
};

export const VisualSettingsHost = () => {
	const { thingtime } = useThingtime();
	const bottomPadding = normalizeBottomPadding(thingtime?.settings?.visual?.bottomPadding);
	const devKitBottomOffset = Math.max(MIN_NATIVE_DEVKIT_OFFSET, Math.round(bottomPadding / 2));

	React.useEffect(() => {
		const root = document.documentElement;
		root.style.setProperty('--thingtime-visual-bottom-padding', `${bottomPadding}px`);
		root.style.setProperty('--thingtime-visual-devkit-bottom-offset', `${devKitBottomOffset}px`);
		window.dispatchEvent(
			new CustomEvent('thingtime:visual-settings-change', {
				detail: {
					bottomPadding,
					devKitBottomOffset
				}
			})
		);
	}, [bottomPadding, devKitBottomOffset]);

	return null;
};
