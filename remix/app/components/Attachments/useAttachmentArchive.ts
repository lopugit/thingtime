import React from 'react';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { useLopu } from '~/components/Lopu/useLopu';
import { useSharedAccess } from '~/components/Sharing/SharedMedia';
import { useApi } from '~/hooks/useApi';
import { archiveErrorMessage, archiveShareDescription, triggerBrowserDownload, type ArchiveNoun } from './attachmentArchiveActions';
import { ATTACHMENT_ARCHIVE_REQUIREMENTS, attachmentArchiveShareUrl, attachmentArchiveUrl, formatAttachmentBytes } from './attachmentUiCore';

// One hook behind every "Download all" / "Share download link" control. The
// download asks the server for the manifest first (a small JSON read through
// the same authorization) so an empty, unauthorized or oversized archive
// becomes a Lopu toast instead of a navigated-into JSON error; only then does
// the browser save the ZIP. The share link is the canonical endpoint URL.

export type ArchiveAccess = { key?: string; sharedRoot?: string };

export const useAttachmentArchive = (access: ArchiveAccess = {}) => {
	const api = useApi();
	const lopu = useLopu();
	const context = useSharedAccess();
	const key = access.key || context.key;
	const sharedRoot = access.sharedRoot || context.sharedRoot;
	const busy = React.useRef(new Set<string>());

	const download = React.useCallback(
		async (id: string, noun: ArchiveNoun = 'post') => {
			if (!id || busy.current.has(id)) return;
			busy.current.add(id);
			try {
				const manifest = await api.v1.attachments.archive.manifest({ id, key, sharedRoot });
				if (!manifest?.ok) throw manifest;
				triggerBrowserDownload(attachmentArchiveUrl(id, { key, sharedRoot }));
				const parts = [
					manifest.fileCount ? `${manifest.fileCount} file${manifest.fileCount === 1 ? '' : 's'}` : 'no stored files',
					manifest.totalBytes ? formatAttachmentBytes(manifest.totalBytes) : '',
					manifest.linkCount ? `${manifest.linkCount} linked item${manifest.linkCount === 1 ? '' : 's'} listed in links.txt` : '',
					manifest.skipped ? `${manifest.skipped} unavailable to you skipped` : ''
				].filter(Boolean);
				lopu({ title: `Downloading ${manifest.fileName} 🗜️`, description: parts.join(' · '), status: 'success', duration: 6000 });
			} catch (error) {
				lopu({ title: `Couldn’t download this ${noun}’s files`, description: archiveErrorMessage(error), status: 'error', duration: 8000 });
			} finally {
				busy.current.delete(id);
			}
		},
		[api, key, sharedRoot, lopu]
	);

	const shareLink = React.useCallback(
		async (id: string, noun: ArchiveNoun = 'post') => {
			if (!id) return;
			const url = attachmentArchiveShareUrl(id, window.location.origin, sharedRoot);
			try {
				await requireThingtimeCapability('api.attachment-archive', ATTACHMENT_ARCHIVE_REQUIREMENTS['api.attachment-archive']);
			} catch {
				lopu({ title: 'This server can’t build download links yet', description: 'Refresh after the update and try again.', status: 'error' });
				return;
			}
			try {
				if (typeof navigator !== 'undefined' && (navigator as Navigator & { share?: (data: { url: string; title?: string }) => Promise<void> }).share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
					await (navigator as Navigator & { share: (data: { url: string; title?: string }) => Promise<void> }).share({ url, title: 'Download files' });
					return;
				}
				await navigator.clipboard.writeText(url);
				lopu({ title: 'Download link copied 🔗', description: archiveShareDescription(noun), status: 'success', duration: 8000 });
			} catch (error) {
				if ((error as { name?: string } | null)?.name === 'AbortError') return;
				lopu({ title: `Copy this download link: ${url}`, description: archiveShareDescription(noun), status: 'info', duration: 12000 });
			}
		},
		[sharedRoot, lopu]
	);

	return { download, shareLink };
};
