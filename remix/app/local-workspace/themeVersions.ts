import { protectedRecoveryDocument } from './protectedRecovery';
import { themeContentSnapshot, themeContentValue, THEME_CONTENT_ADAPTER } from '../timeline/themeContent';
import { isTransferTheme } from '../utils/thingTransfer/theme';
import type { LocalProtectedVersionWriter } from './timelineVersions';
import type { LocalThemes } from './themes';
import type { AccountThemeSync } from './accountThemes';

/** Theme History changes the design only. Sharing, library title and folder
 * remain the current writer's intent, even when an old snapshot recorded them. */
export function themeVersionWriter(themes: LocalThemes, account?: AccountThemeSync): LocalProtectedVersionWriter {
	return {
		scope: themes.scope,
		recovery: { adapter: THEME_CONTENT_ADAPTER, read: (tx, id, snapshot) => protectedRecoveryDocument(tx, themes.scope, id, snapshot, 'theme') },
		matches: isTransferTheme,
		read: account ? async (tx, id) => (await account.viewIn(tx, id)) ?? undefined : undefined,
		transaction: (run, signal) => themes.versionTransaction(run, signal),
		content(doc) {
			const current = themeContentSnapshot({
				crystal: doc.crystal,
				tags: doc.tags ?? [],
				visibility: doc.visibility ?? 'private',
				folderId: doc.folderId ?? null
			});
			const retained = themeContentValue(current);
			return {
				adapters: [THEME_CONTENT_ADAPTER],
				current,
				read(snapshot) {
					if (!snapshot) throw Error('This theme version has no design content.');
					const value = themeContentValue(snapshot);
					return { crystal: { name: value.crystal.name, theme: value.crystal.theme } };
				},
				snapshot(value) {
					return themeContentSnapshot({ ...retained, crystal: { ...retained.crystal, name: value.crystal.name, theme: value.crystal.theme } });
				}
			};
		}
	};
}
