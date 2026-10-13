import { useEffect, useState } from 'react';

import { getElectronBridge } from '~/utils/electronBridge';

import type { DeviceBattery } from './deviceTypes';

const object = (value: unknown): Record<string, unknown> | null =>
	value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const boolean = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;

export const mayReadLocalBattery = (
	selectedDeviceId: string | null,
	currentAccountDeviceIds: readonly string[],
	pairedDeviceIds: readonly string[],
	accountEnabled: boolean,
	accountDevicesLoading: boolean
): boolean => Boolean(accountEnabled && !accountDevicesLoading && selectedDeviceId &&
	currentAccountDeviceIds.includes(selectedDeviceId) && pairedDeviceIds.includes(selectedDeviceId));

// The native snapshot contains other private telemetry. Select only battery
// readings, and never cache or propagate the full IPC response into React.
export const batteryFromLocalSnapshot = (snapshot: unknown): DeviceBattery | null => {
	const source = object(object(snapshot)?.battery);
	if (!source) return null;
	const battery: DeviceBattery = {
		level: number(source.level),
		charging: boolean(source.isCharging),
		isExternalPower: boolean(source.isExternalPower),
		fullyCharged: boolean(source.fullyCharged),
		cycleCount: number(source.cycleCount),
		designCycleCount: number(source.designCycleCount),
		designCapacityMAh: number(source.designCapacityMAh),
		fullChargeCapacityMAh: number(source.fullChargeCapacityMAh),
		remainingCapacityMAh: number(source.remainingCapacityMAh),
		currentMA: number(source.currentMA),
		voltageMV: number(source.voltageMV),
		temperatureC: number(source.temperatureC),
		timeToEmptyMinutes: number(source.timeToEmptyMinutes),
		timeToFullMinutes: number(source.timeToFullMinutes),
		adapterWatts: number(source.adapterWatts),
		adapterVoltageMV: number(source.adapterVoltageMV),
		adapterCurrentMA: number(source.adapterCurrentMA),
		isLowPowerModeEnabled: boolean(source.isLowPowerModeEnabled) ?? false,
		isPreventingIdleSleep: boolean(source.isPreventingIdleSleep) ?? false
	};
	return battery.level !== null || battery.cycleCount !== null ? battery : null;
};

export const useLocalDeviceBattery = (accountId: string | null | undefined, deviceId: string | null, eligible: boolean): DeviceBattery | null => {
	const key = `${accountId || ''}:${deviceId || ''}`;
	const [latest, setLatest] = useState<{ key: string; battery: DeviceBattery } | null>(null);
	useEffect(() => {
		if (!eligible || !deviceId || !accountId) return;
		let active = true;
		const refresh = async () => {
			if (document.visibilityState !== 'visible') return;
			try {
				const snapshot = await getElectronBridge()?.nodeDevice?.({ action: 'battery' });
				const battery = batteryFromLocalSnapshot(snapshot);
				if (active && battery) setLatest({ key, battery });
			} catch {
				// Keep the last known local reading through a brief service interruption.
			}
		};
		void refresh();
		const timer = window.setInterval(() => void refresh(), 15_000);
		document.addEventListener('visibilitychange', refresh);
		return () => {
			active = false;
			window.clearInterval(timer);
			document.removeEventListener('visibilitychange', refresh);
		};
	}, [accountId, deviceId, eligible, key]);
	return eligible && latest?.key === key ? latest.battery : null;
};
