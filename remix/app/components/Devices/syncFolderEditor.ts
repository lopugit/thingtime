import { useEffect, useRef } from 'react';
import { newFileSyncConfiguration } from '~/fileSync/configuration';
import type { ConfigurationDraft } from '~/fileSync/configurationEditor';
import type { MobileFolder } from '~/fileSync/mobileFolders.client';

export const newSyncConfigDraft = (root: MobileFolder, deviceId: string, paused = false): ConfigurationDraft => ({
	version: 1, id: crypto.randomUUID(), baseUpdatedAt: null, pending: false, exclusions: '',
	configuration: {
		...newFileSyncConfiguration({ name: root.name.trim() && root.name.trim().length <= 120 ? root.name.trim() : 'Folder backup', deviceId, localRootId: root.id, remoteFolderId: 'unselected', sourceKind: root.sourceKind }),
		mode: 'backup', paused, remoteFolderId: ''
	}
});

/** The picker returns a full roster. A cancelled/repeated selection must not
 * pick the first folder or create a second configuration for it. */
export function newlyGrantedFolder(before: readonly MobileFolder[], after: readonly MobileFolder[]): MobileFolder | undefined {
	const existing = new Set(before.map(root => root.id));
	const added = after.filter(root => !existing.has(root.id));
	return added.length === 1 ? added[0] : undefined;
}

/** The picker and Add sync config are explicit actions. Reveal their new form
 * even if earlier folders push it below the fold, without moving input focus. */
export function useRevealNewSyncDraft(editorPrefix: string, selectedId: string | null, restorePending = false) {
	const requested = useRef<string | null>(restorePending ? selectedId : null);
	useEffect(() => {
		if (!selectedId || requested.current !== selectedId) return;
		requested.current = null;
		const slot = document.getElementById(`${editorPrefix}-${selectedId}`);
		(slot?.closest('article') ?? slot)?.scrollIntoView({ block: 'nearest' });
	}, [editorPrefix, selectedId]);
	return (id: string) => { requested.current = id; };
}
