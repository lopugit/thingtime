import assert from 'node:assert/strict';
import test from 'node:test';
import { exportFileVersion, supportsFileExport } from './fileExport.client';
import type { CloudFile } from './cloudFile';
import type { ThingtimeBridgeMessage } from '../utils/nativeBridge';
import { apiErrorMessage } from '../hooks/apiFailure';

const scope = { ownerId: 'owner', dataPlane: 'home', apiOrigin: 'https://thingtime.test' };
const file: CloudFile = {
	id: '55555555-5555-4555-8555-555555555555',
	revision: 'earlier',
	name: 'Earlier.bin',
	folderId: null,
	trashed: false,
	content: {
		attachmentId: 'attachment-one',
		version: 'a'.repeat(64),
		size: 123,
		fingerprint: { algorithm: 'sha256-parts-v1', partSizeBytes: 8388608, partCount: 1, sha256: 'b'.repeat(64) }
	}
};
function fixture() {
	const target = new EventTarget(),
		messages: ThingtimeBridgeMessage[] = [];
	const bridge = {
		version: '1.4.0',
		platform: 'android' as const,
		isNativeWebView: true as const,
		fileExportVersion: '1.0.0',
		postMessage: (m: ThingtimeBridgeMessage) => messages.push(m)
	};
	const before = Object.getOwnPropertyDescriptor(globalThis, 'window');
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: Object.assign(target, { location: { origin: scope.apiOrigin }, thingtimeNativeBridge: bridge })
	});
	return {
		messages,
		bridge,
		reply(extra: Record<string, unknown> = {}) {
			target.dispatchEvent(
				new CustomEvent('thingtime:native-message', {
					detail: {
						type: 'file-export-result',
						payload: {
							...(messages[0].payload as object),
							attachmentId: file.content.attachmentId,
							version: file.content.version,
							size: file.content.size,
							saved: true,
							...extra
						}
					}
				})
			);
		},
		close() {
			if (before) Object.defineProperty(globalThis, 'window', before);
			else Reflect.deleteProperty(globalThis, 'window');
		}
	};
}
test('export negotiates native support and rejects a foreign origin or custom storage', async () => {
	const f = fixture();
	try {
		assert.equal(supportsFileExport(f.bridge), true);
		assert.equal(supportsFileExport({ ...f.bridge, fileExportVersion: undefined }), false);
		assert.equal(supportsFileExport({ ...f.bridge, fileExportVersion: '2.0.0' }), false);
		for (const changed of [
			{ ...scope, dataPlane: 'custom-' + 'a'.repeat(64) },
			{ ...scope, apiOrigin: 'https://foreign.test' }
		])
			await assert.rejects(exportFileVersion(changed, file, new AbortController().signal));
		assert.equal(f.messages.length, 0);
	} finally {
		f.close();
	}
});
test('export pins exact request and version; ignores foreign callbacks', async () => {
	const f = fixture();
	try {
		const promise = exportFileVersion(scope, file, new AbortController().signal);
		f.reply({ ownerId: 'other' });
		f.reply({ origin: 'https://other.test' });
		f.reply({ requestId: 'other' });
		f.reply();
		assert.equal(await promise, true);
		assert.deepEqual((f.messages[0].payload as any).content, file.content);
		assert.equal(f.messages.length, 1);
	} finally {
		f.close();
	}
});
test('export reports cancellation, rejects mismatched bytes and aborts the native request', async () => {
	const f = fixture();
	try {
		let promise = exportFileVersion(scope, file, new AbortController().signal);
		f.reply({ saved: false });
		assert.equal(await promise, false);
		f.messages.length = 0;
		promise = exportFileVersion(scope, file, new AbortController().signal);
		f.reply({ version: 'b'.repeat(64) });
		await assert.rejects(promise, /verified/);
		assert.equal((f.messages[1].payload as any).action, 'cancel');
		f.messages.length = 0;
		const controller = new AbortController();
		promise = exportFileVersion(scope, file, controller.signal);
		controller.abort();
		await assert.rejects(promise);
		assert.equal((f.messages[1].payload as any).action, 'cancel');
		f.reply(); // Late completion cannot turn the aborted promise into success.
	} finally {
		f.close();
	}
});
test('History displays bounded native save failure guidance', async () => {
	const f = fixture();
	try {
		const promise = exportFileVersion(scope, file, new AbortController().signal);
		const message = 'Could not verify the saved file. Check Files before trying again.';
		f.reply({ saved: false, error: message });
		await assert.rejects(promise, (error: unknown) => apiErrorMessage(error, 'Generic fallback') === message);
	} finally {
		f.close();
	}
});
