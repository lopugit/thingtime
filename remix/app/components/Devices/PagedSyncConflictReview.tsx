import React from 'react';
import type { createConflictReviewController } from '~/fileSync/conflictReviewController';
import type { SyncMode } from '~/fileSync/reconcile';
import { TransientBlockHost, type TransientBlockActions } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { SettingsDocumentHost, type SettingsDocumentHostProps } from '../Settings/SettingsDocumentHost';
import { openThingHistory } from '../Timeline/TimelineHost';
import { syncConflictReviewBlocks, syncConflictReviewDisplay } from './syncConflictReviewBlocks';

export function PagedSyncConflictReview({ controller, mode, scopeKey, accountTransport }: {
	controller: ReturnType<typeof createConflictReviewController>; mode: SyncMode; scopeKey: string;
	accountTransport?: SettingsDocumentHostProps['accountTransport'];
}) {
	const view = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	const actions: TransientBlockActions = {
		reload: () => controller.reload(), previous: () => controller.previous(), next: () => controller.next(),
		choose: ({ inputs, value }) => {
			if (typeof inputs.path !== 'string' || typeof inputs.revision !== 'number' || !['', 'local', 'remote'].includes(String(value)))
				throw Error('Choose a current conflict version.');
			return controller.choose(inputs.path, value === '' ? null : value as 'local' | 'remote', inputs.revision);
		},
		resolve: () => controller.finish('resolve'), retain: () => controller.finish('retain'), cancel: () => controller.cancel(),
		history: ({ inputs }) => {
			const current = controller.getSnapshot();
			const row = current.page?.rows.find(row => row.conflict.path === inputs.path && row.revision === inputs.revision);
			if (!current.closed && !current.busy && row?.conflict.remote?.kind === 'file') openThingHistory(row.conflict.remote.id, ['file']);
		}
	};
	return <SettingsDocumentHost documentKey="sync-conflict-review" defaultDocument={syncConflictReviewBlocks}
		scopeKey={scopeKey} accountTransport={accountTransport} title="Sync conflict review">
		{({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} scope={syncConflictReviewDisplay(view, mode)} actions={actions} enabled={!editing}>
			<WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} />
		</TransientBlockHost>}
	</SettingsDocumentHost>;
}
