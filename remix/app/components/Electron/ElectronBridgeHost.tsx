import React from 'react';

import { useThingtime } from '../Thingtime/useThingtime';
import {
	electronUrlSettingPath,
	getElectronBridge,
	getElectronSettingUrl,
	loadElectronUrl,
	normalizeElectronUrl,
	type ThingtimeDesktopInfo
} from '~/utils/electronBridge';

const CLEAR_ELECTRON_URL_PARAM = 'thingtimeDesktopClearUrl';

function hasClearElectronUrlRequest() {
	try {
		return new URL(window.location.href).searchParams.get(CLEAR_ELECTRON_URL_PARAM) === '1';
	} catch {
		return false;
	}
}

function clearElectronUrlRequestFromLocation() {
	try {
		const url = new URL(window.location.href);
		url.searchParams.delete(CLEAR_ELECTRON_URL_PARAM);
		window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
	} catch {
		// Best-effort cleanup only.
	}
}

export function ElectronBridgeHost() {
	const { thingtime, setThingtime, loading } = useThingtime();
	const [desktopInfo, setDesktopInfo] = React.useState<ThingtimeDesktopInfo | null>(null);
	const appliedUrlRef = React.useRef<string | null>(null);
	const clearingSavedUrlRef = React.useRef(false);

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

	React.useEffect(() => {
		const sessionHash = desktopInfo?.sessionHash;

		if (loading || !sessionHash || !hasClearElectronUrlRequest()) {
			return;
		}

		appliedUrlRef.current = null;
		clearingSavedUrlRef.current = true;
		setThingtime(electronUrlSettingPath(sessionHash), '', {
			ignoreUndoRedo: true,
			namespace: 'electron'
		});
		clearElectronUrlRequestFromLocation();
	}, [desktopInfo?.sessionHash, loading, setThingtime]);

	React.useEffect(() => {
		const bridge = getElectronBridge();
		const sessionHash = desktopInfo?.sessionHash;

		if (!bridge || loading || !sessionHash || hasClearElectronUrlRequest()) {
			return;
		}

		const targetUrl = normalizeElectronUrl(getElectronSettingUrl(thingtime, sessionHash));

		if (clearingSavedUrlRef.current) {
			if (!targetUrl) {
				clearingSavedUrlRef.current = false;
			}

			return;
		}

		if (!targetUrl || appliedUrlRef.current === targetUrl) {
			return;
		}

		const currentUrl = normalizeElectronUrl(desktopInfo?.currentUrl || window.location.href);

		if (currentUrl === targetUrl) {
			appliedUrlRef.current = targetUrl;
			return;
		}

		appliedUrlRef.current = targetUrl;

		loadElectronUrl(bridge, targetUrl)
			.then((info) => {
				setDesktopInfo(info);
			})
			.catch((error) => {
				appliedUrlRef.current = null;
				console.warn('Unable to load saved Thingtime desktop URL', error);
			});
	}, [desktopInfo?.currentUrl, desktopInfo?.sessionHash, loading, thingtime]);

	return null;
}
