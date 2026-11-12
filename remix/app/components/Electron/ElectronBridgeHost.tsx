import React from 'react';

import { useThingtime } from '../Thingtime/useThingtime';
import { getElectronAutoUpdateEnabled, getElectronBridge, type ThingtimeDesktopInfo } from '~/utils/electronBridge';

export function ElectronBridgeHost() {
	const { thingtime, loading } = useThingtime();
	const [desktopInfo, setDesktopInfo] = React.useState<ThingtimeDesktopInfo | null>(null);
	const updateCheckSessionRef = React.useRef<string | null>(null);
	const bridgeIsMacDesktop = typeof window !== 'undefined' && getElectronBridge()?.platform === 'darwin';

	React.useEffect(() => {
		const bridge = getElectronBridge();

		if (!bridge?.getInfo) {
			return;
		}

		let cancelled = false;

		bridge
			.getInfo()
			.then((info) => {
				if (!cancelled) {
					setDesktopInfo(info);
				}
			})
			.catch((error) => {
				console.warn('Unable to read Thingtime desktop info', error);
			});

		return () => {
			cancelled = true;
		};
	}, []);

	React.useLayoutEffect(() => {
		const root = document.documentElement;
		const titlebar = desktopInfo?.titlebar;
		const enabled = bridgeIsMacDesktop || !!titlebar?.enabled;

		root.classList.toggle('thingtime-electron-desktop', enabled);

		if (!enabled) {
			root.style.removeProperty('--thingtime-electron-titlebar-height');
			root.style.removeProperty('--thingtime-electron-titlebar-left-inset');
			root.style.removeProperty('--thingtime-electron-titlebar-nav-start');
			return;
		}

		root.style.setProperty('--thingtime-electron-titlebar-height', `${titlebar?.height || 52}px`);
		root.style.setProperty('--thingtime-electron-titlebar-left-inset', `${titlebar?.leftInset || 88}px`);
		root.style.setProperty('--thingtime-electron-titlebar-nav-start', `${titlebar?.navStart || 132}px`);

		return () => {
			root.classList.remove('thingtime-electron-desktop');
			root.style.removeProperty('--thingtime-electron-titlebar-height');
			root.style.removeProperty('--thingtime-electron-titlebar-left-inset');
			root.style.removeProperty('--thingtime-electron-titlebar-nav-start');
		};
	}, [bridgeIsMacDesktop, desktopInfo?.titlebar]);

	React.useEffect(() => {
		const bridge = getElectronBridge();
		const sessionHash = desktopInfo?.sessionHash;

		if (!bridge?.checkForUpdates || loading || !sessionHash || updateCheckSessionRef.current === sessionHash) {
			return;
		}

		if (!getElectronAutoUpdateEnabled(thingtime, sessionHash)) {
			return;
		}

		updateCheckSessionRef.current = sessionHash;

		bridge
			.checkForUpdates()
			.then((info) => {
				window.dispatchEvent(new CustomEvent('thingtime:electron-update-info', { detail: info }));
			})
			.catch((error) => {
				updateCheckSessionRef.current = null;
				console.warn('Unable to check Thingtime desktop updates', error);
			});
	}, [desktopInfo?.sessionHash, loading, thingtime]);

	return null;
}
