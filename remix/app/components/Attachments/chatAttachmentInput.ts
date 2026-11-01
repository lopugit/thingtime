import type React from 'react';
import { attachmentFilesFromClipboard } from './attachmentUiCore';

/** Keep text transfers native; file transfers use the existing secure uploader. */
export const chatAttachmentInput = (addFiles: (files: File[]) => void, disabled: boolean) => ({
	onPaste: (event: React.ClipboardEvent<HTMLElement>) => {
		if (event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return;
		const files = attachmentFilesFromClipboard(event.clipboardData);
		if (!files.length) return;
		event.preventDefault();
		event.stopPropagation();
		if (!disabled) addFiles(files);
	},
	onDragOver: (event: React.DragEvent<HTMLElement>) => {
		if (!event.currentTarget.contains(event.target as Node) || !Array.from(event.dataTransfer.types).includes('Files')) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
	},
	onDrop: (event: React.DragEvent<HTMLElement>) => {
		if (event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return;
		const files = attachmentFilesFromClipboard(event.dataTransfer);
		if (!files.length) return;
		event.preventDefault();
		event.stopPropagation();
		if (!disabled) addFiles(files);
	}
});
