import React from 'react';
import { useAttachmentUploads } from '../Attachments/useAttachmentUploads';
import type { TransientBlockActions } from '../Builder/TransientBlockHost';
import type { DeviceLocationScope } from './deviceLocation.client';
import { LocateRequestRefused, locateReceiptLabel, requestDeviceLocate, type LocateAttempt, type LocateKind, type LocateReceipt } from './deviceLocate.client';

/** Typed effects and upload handles live here; the controls remain saved blocks. */
export function useDeviceLocateActions(scope: DeviceLocationScope, signal: () => AbortSignal, operation: (run: () => Promise<void>) => Promise<void>, onError: (message: string) => void) {
	const uploads = useAttachmentUploads(scope.ownerId, onError, onError, true, undefined, { purpose: 'file' });
	const [receipt, setReceipt] = React.useState<LocateReceipt | null>(null);
	const [attempt, setAttempt] = React.useState<LocateAttempt | null>(null);
	const [uncertain, setUncertain] = React.useState(false);
	const pending = React.useRef<LocateAttempt | null>(null);
	const [prepared, setPrepared] = React.useState<LocateReceipt['preparedSound']>();
	const selected = uploads.uploads[0];
	const run = async (current: LocateAttempt, readOnly = false) => {
		setAttempt(current);
		try {
			const next = await requestDeviceLocate(scope, current, signal(), readOnly);
			signal().throwIfAborted();
			setReceipt(next);
			if (next.preparedSound) setPrepared(next.preparedSound);
			pending.current = null;
			setUncertain(false);
		} catch (error) {
			if (!signal().aborted) {
				// A status read can race an in-flight POST; its 404 never releases it.
				const refused = !readOnly && error instanceof LocateRequestRefused;
				pending.current = refused ? null : current;
				setUncertain(!refused);
				if (refused) { setAttempt(null); setReceipt(null); }
			}
			throw error;
		}
	};
	const send = async (kind: LocateKind, input: Record<string, unknown>) => {
		if (pending.current) throw new Error('Check the previous action’s status or retry that same request first.');
		const next = { requestId: crypto.randomUUID(), kind, input: structuredClone(input) };
		pending.current = next;
		await run(next);
	};
	const mediaInput = () => {
		if (selected?.status !== 'ready' || !selected.attachment) throw new Error('Upload an audio file first and wait for it to finish.');
		return { attachmentId: selected.attachment.id };
	};
	const actions: TransientBlockActions = {
		'upload-sound': ({ readFile }) => {
			const file = readFile('soundFile');
			if (!file) return;
			setPrepared(undefined);
			uploads.replaceFiles([file], signal());
		},
		'retry-upload': () => { if (selected) uploads.retry(selected.localId); },
		'prepare-sound': () => operation(() => send('media.prepare', { ...mediaInput(), format: 'notification-sound' })),
		'play-sound': () => operation(() => send('media.play', mediaInput())),
		'play-tone': () => operation(() => send('notification.show', { title: 'Find this device', message: 'Playing a sound from Thingtime.', sound: { kind: 'default' } })),
		'send-alert': ({ readField }) => operation(async () => {
			const sound = readField('sound') || 'default';
			if (sound === 'prepared' && (prepared?.status !== 'ready' || prepared.attachmentId !== selected?.attachment?.id)) throw new Error('Prepare the uploaded tone on this device before using it in a notification.');
			await send('notification.show', {
				title: String(readField('title') || 'Thingtime'), message: String(readField('message') || ''),
				sound: sound === 'prepared' ? { kind: 'prepared', id: prepared!.id } : { kind: sound === 'none' ? 'none' : 'default' },
			});
		}),
		'retry-alert': () => operation(async () => { if (pending.current) await run(pending.current); }),
		'check-alert': () => operation(async () => { if (attempt) await run(attempt, true); }),
	};
	return { actions, display: {
		status: uncertain ? 'The result is unconfirmed. Check status or retry the same request.' : locateReceiptLabel(receipt),
		uncertain, hasAttempt: !!attempt, commandStatus: receipt?.command?.status ?? '',
		uploadName: selected?.file.name ?? '', uploadProgress: selected?.progress ?? 0,
		uploadBusy: !!selected && !['ready', 'error'].includes(selected.status), uploadError: selected?.error ?? '',
		uploadReady: selected?.status === 'ready', prepared: prepared?.status === 'ready',
	} };
}
