import { useEffect } from 'react';
import { activityManager } from '../../activity/activityManager';
import { getNativeBridge } from '../../utils/nativeBridge';
import { rootIdentity } from '../../utils/rootIdentity';
import { requestMobileDevice } from './mobileDeviceBridge';
import { mobileDeviceScope, publishMobileDeviceObservation } from './mobileDeviceObservations';
import { startMobileDevicePresence } from './mobileDevicePresence';

export function MobileDevicePresenceBootstrap({ ownerId, generation }: { ownerId: string; generation: number }) {
	useEffect(
		() =>
			activityManager.register(
				{
					id: 'timer:components/Devices/MobileDeviceSetupCard:1',
					title: 'Mobile device connection',
					kind: 'polling',
					background: true,
					detail:
						'Refreshes this paired mobile device while the app is visible, including after reconnecting. Does not enable file access or create pairings.'
				},
				() => {
					const origin = window.location.origin;
					const presence = startMobileDevicePresence({
						window,
						document,
						bridge: getNativeBridge,
						current: () => window.location.origin === origin && !rootIdentity.read().pending && rootIdentity.read().generation === generation,
						request: async (signal) => {
							const status = await requestMobileDevice(ownerId, 'status', signal);
							if (
								!signal.aborted &&
								window.location.origin === origin &&
								!rootIdentity.read().pending &&
								rootIdentity.read().generation === generation
							)
								publishMobileDeviceObservation(mobileDeviceScope(origin, ownerId), status);
							return status;
						},
						schedule: (callback, delay) => {
							const timer = setTimeout(callback, delay);
							return () => clearTimeout(timer);
						}
					});
					const unsubscribe = rootIdentity.subscribe(presence.refresh);
					return () => {
						unsubscribe();
						presence.stop();
					};
				}
			),
		[ownerId, generation]
	);
	return null;
}
