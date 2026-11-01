import type { ConfigurationDraft } from './configurationEditor';
import { syncPathKey } from './reconcile';

export const HOME_BACKUP_EXCLUSIONS = ['Library', 'Applications', '.Trash'] as const;

/** A preset edits a draft only. It never selects a native grant or starts work. */
export function homeBackupDraft(draft: ConfigurationDraft): ConfigurationDraft {
	if (draft.pending) throw Error('Resolve the pending save before applying a preset.');
	if (draft.configuration.sourceKind === 'photos') throw Error('Choose your home folder before using this preset.');
	const exclusions = draft.exclusions.split(/\r?\n/).filter(Boolean);
	const keys = new Set(exclusions.map(syncPathKey));
	for (const path of HOME_BACKUP_EXCLUSIONS) if (!keys.has(syncPathKey(path))) exclusions.push(path);
	return { ...draft, exclusions: exclusions.join('\n'), configuration: { ...draft.configuration,
		mode: 'backup', propagateDeletes: false, paused: true } };
}
