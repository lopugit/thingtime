import type { ThingContextSection } from '~/components/Thingtime/ContextMenu/contextMenuModel';

// Menu model + browser plumbing for "Download all" ZIP archives, shared by the
// post/media menu (PostThingMenu), the /things item menu (thingsMenuModel) and
// the inline gallery buttons. One helper so every surface offers the same two
// verbs with the same words; the server remains the authority on what a
// download actually contains.

export type ArchiveNoun = 'post' | 'comment' | 'gallery' | 'folder' | 'page' | 'media';

export const ARCHIVE_DOWNLOAD_COMMAND = 'download-archive';
export const ARCHIVE_SHARE_COMMAND = 'share-download-link';

export const archiveNounForKinds = (thingtime: readonly string[] | undefined): ArchiveNoun | null => {
	const kinds = thingtime || [];
	if (kinds.includes('folder')) return 'folder';
	if (kinds.includes('attachment')) return 'media';
	if (kinds.includes('comment')) return 'comment';
	if (kinds.includes('post')) return 'post';
	if (kinds.includes('webpage')) return 'page';
	return null;
};

// fileCount null = unknown ahead of time (folders are enumerated server-side);
// 0 = known empty, so the section is withheld. Bulk selections never archive.
export const buildArchiveMenuSection = ({ fileCount, noun, bulk = false }: { fileCount: number | null; noun: ArchiveNoun; bulk?: boolean }): ThingContextSection | null => {
	if (bulk || fileCount === 0) return null;
	const counted = fileCount && fileCount > 0 ? ` (${fileCount} file${fileCount === 1 ? '' : 's'})` : '';
	const scope = noun === 'media' ? 'this file' : `this ${noun}`;
	return {
		id: 'files',
		label: 'Files',
		actions: [
			{
				id: ARCHIVE_DOWNLOAD_COMMAND,
				command: ARCHIVE_DOWNLOAD_COMMAND,
				label: noun === 'media' ? 'Download as ZIP' : `Download all files${counted}`,
				icon: '🗜️',
				lucide: 'folder-down',
				hint: noun === 'media' ? 'The stored file inside one ZIP' : `Every stored file in ${scope} as one ZIP`
			},
			{
				id: ARCHIVE_SHARE_COMMAND,
				command: ARCHIVE_SHARE_COMMAND,
				label: 'Share download link',
				icon: '🔗',
				lucide: 'link-2',
				hint: 'Opening the link downloads the ZIP — browsers, wget and curl alike'
			}
		]
	};
};

export const archiveShareDescription = (noun: ArchiveNoun): string =>
	`Anyone who can view this ${noun} can open it to download the files as one ZIP — in a browser, with wget or curl. Changing the ${noun}’s audience changes who can use it.`;

export const archiveErrorMessage = (error: unknown): string => {
	if (error && typeof error === 'object') {
		const value = error as { error?: unknown; message?: unknown };
		if (typeof value.error === 'string' && value.error) return value.error;
		if (typeof value.message === 'string' && value.message) return value.message;
	}
	return 'Try again in a moment.';
};

// A same-origin anchor click saves the response without leaving the page: the
// endpoint answers with Content-Disposition: attachment and the empty download
// attribute keeps even an odd browser from navigating into the bytes.
export const triggerBrowserDownload = (href: string, doc: Document = document): void => {
	const link = doc.createElement('a');
	link.href = href;
	link.download = '';
	link.rel = 'noopener';
	link.style.display = 'none';
	doc.body.appendChild(link);
	try {
		link.click();
	} finally {
		link.remove();
	}
};
