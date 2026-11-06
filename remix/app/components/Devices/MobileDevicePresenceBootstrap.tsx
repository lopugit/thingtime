import { useEffect } from 'react';
import { activityManager } from '../../activity/activityManager';
import { getNativeBridge } from '../../utils/nativeBridge';
import { rootIdentity } from '../../utils/rootIdentity';
import { requestMobileDevicePresence, stopMobileBackgroundPresence } from './mobileDeviceBridge';
import { requestMobileLocation, supportsMobileLocation } from './mobileDeviceLocationBridge';
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
						'Refreshes this paired mobile device while visible and allows supported iOS background check-ins when the system schedules them. Does not enable file access or create pairings.'
				},
				() => {
					const origin = window.location.origin;
					const presence = startMobileDevicePresence({
						window,
						document,
						bridge: getNativeBridge,
						current: () => window.location.origin === origin && !rootIdentity.read().pending && rootIdentity.read().generation === generation,
						stopBackground: () => stopMobileBackgroundPresence(ownerId, origin),
						request: async (signal) => {
							const status = await requestMobileDevicePresence(ownerId, signal);
							if (
								!signal.aborted &&
								window.location.origin === origin &&
								!rootIdentity.read().pending &&
								rootIdentity.read().generation === generation
							) {
								publishMobileDeviceObservation(mobileDeviceScope(origin, ownerId), status);
								// Read-only verification resumes only an already enabled native binding.
								// Native status never prompts or enables location collection.
								if (status.state === 'paired' && supportsMobileLocation()) {
									try { await requestMobileLocation(ownerId, 'status', signal); } catch { /* Location availability does not fail the device heartbeat. */ }
								}
							}
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
