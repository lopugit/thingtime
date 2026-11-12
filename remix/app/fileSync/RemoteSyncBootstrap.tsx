import { useEffect } from 'react';
import { activityManager } from '../activity/activityManager';
import { startRemoteSyncWorker } from './remoteSyncWorker.client';

export function RemoteSyncBootstrap({ ownerId, generation }: { ownerId: string; generation: number }) {
	useEffect(() => activityManager.register({ id: 'sync.remote-control', title: 'Remote folder sync controls', kind: 'polling', background: true,
		detail: 'Lets your signed-in browsers manage folder sync on this device while Thingtime is running. Disable to stop remote requests.' },
		signal => startRemoteSyncWorker(ownerId, generation, signal)), [ownerId, generation]);
	return null;
}
