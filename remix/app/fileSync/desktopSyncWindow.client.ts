import { getElectronBridge } from '../utils/electronBridge';
import { createSyncWindowRetention } from './syncWindowRetention';

const leases = new WeakMap<object, ReturnType<typeof createSyncWindowRetention>>();
const schedules = new WeakMap<object, { queue: Promise<void>; release?: () => Promise<void> }>();
export function holdDesktopSyncWindow(bridge = getElectronBridge()) {
	if (!bridge?.setFolderSyncActive) throw Error('Update Thingtime Desktop to keep automatic sync running.');
	let acquire = leases.get(bridge);
	if (!acquire) {
		acquire = createSyncWindowRetention(active => bridge.setFolderSyncActive!({ active }));
		leases.set(bridge, acquire);
	}
	return acquire();
}

export function setDesktopSyncScheduled(enabled: boolean, bridge = getElectronBridge()) {
	if (!bridge?.setFolderSyncActive) return Promise.resolve();
	let state = schedules.get(bridge);
	if (!state) { state = { queue: Promise.resolve() }; schedules.set(bridge, state); }
	const slot = state;
	slot.queue = slot.queue.catch(() => {}).then(async () => {
		if (enabled && !slot.release) slot.release = await holdDesktopSyncWindow(bridge);
		if (!enabled && slot.release) { const release = slot.release; slot.release = undefined; await release(); }
	});
	return slot.queue;
}
