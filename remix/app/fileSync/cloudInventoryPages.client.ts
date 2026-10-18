import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';
import { readCloudInventoryStream } from './cloudInventoryStream';
import type { SyncScope } from './reconcile';

/** Browser defaults around the shared, bounded stream decoder. Native/server
 * backup workers inject their own scoped transport without importing the UI. */
export function readCloudFolderInventoryPages(scope: SyncScope, folderId: string, input: {
	currentScope(): SyncScope;
	signal?: AbortSignal;
	origin?: () => string;
	fetch?: typeof fetch;
	requireCapability?: typeof requireThingtimeCapability;
}) {
	return readCloudInventoryStream(scope, folderId, {
		...input,
		origin: input.origin ?? (() => window.location.origin),
		fetch: input.fetch ?? fetch,
		requireCapability: input.requireCapability ?? requireThingtimeCapability
	});
}
