import React from 'react';

import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';
import { useAttachmentUploads } from '../Attachments/useAttachmentUploads';
import { BlockInsertMenu, type InsertPick } from './BlockInsertMenu';
import { collectBlockIds, insertBlock, moveBlock, newBlockId, updateBlock, type WebpageBlock } from './webpageBlocks';
import type { BuilderChrome } from './WebpageBlocksRenderer';
import type { UseWebpageDraft } from './useWebpage';

// One hook owns every builder interaction (hover boundary, selection, the
// inline insert menu, drag/drop moves) so /builder and the site edit mode
// behave identically — the canvas differs, the editing grammar doesn't.

export type UseBuilderChrome = {
	chrome: BuilderChrome;
	selectedId: string | null;
	deselect: () => void;
	// render this after the canvas — the floating insert menu when open
	insertMenu: React.ReactNode;
};

export const useBuilderChrome = (draft: UseWebpageDraft): UseBuilderChrome => {
	const [hoverId, setHoverId] = React.useState<string | null>(null);
	const [selectedId, setSelectedId] = React.useState<string | null>(null);
	const [insertAt, setInsertAt] = React.useState<{ containerId: string | null; index: number; anchor: HTMLElement } | null>(null);

	const draftRef = React.useRef(draft);
	draftRef.current = draft;

	const user = useCurrentUser();
	const lopu = useLopu();

	// OS file drops → attachment uploads → media blocks at the drop target.
	// Targets are matched back by (name, size) when each upload turns ready.
	const pendingDropsRef = React.useRef<Array<{ name: string; size: number; containerId: string | null; index: number }>>([]);
	const consumedUploadsRef = React.useRef(new Set<string>());
	const uploader = useAttachmentUploads(
		user?.id,
		undefined,
		(message) => lopu({ title: message, status: 'error' }),
		true
	);
	const { uploads, addFiles, markCommitted } = uploader;

	React.useEffect(() => {
		for (const upload of uploads) {
			if (upload.status !== 'ready' || !upload.attachment || consumedUploadsRef.current.has(upload.localId)) continue;
			consumedUploadsRef.current.add(upload.localId);
			const pendingIndex = pendingDropsRef.current.findIndex(
				(entry) => entry.name === upload.file.name && entry.size === upload.file.size
			);
			const target = pendingIndex >= 0 ? pendingDropsRef.current.splice(pendingIndex, 1)[0] : null;
			const attachment = upload.attachment;
			markCommitted([attachment.id]);
			const current = draftRef.current;
			const media: WebpageBlock['media'] =
				attachment.contentType.startsWith('video/') ? 'video' : attachment.contentType.startsWith('audio/') ? 'audio' : 'image';
			const block: WebpageBlock = {
				id: newBlockId('media', collectBlockIds(current.blocks)),
				type: 'media',
				media,
				src: `/api/v1/attachments/content?id=${encodeURIComponent(attachment.id)}`,
				...(attachment.name ? { alt: attachment.name } : {})
			};
			current.setBlocks(
				insertBlock(current.blocks, target?.containerId ?? null, target?.index ?? current.blocks.length, block)
			);
			setSelectedId(block.id);
			lopu({ title: `${media === 'image' ? '🖼' : media === 'video' ? '🎬' : '🎵'} ${attachment.name} added to the page`, status: 'success' });
		}
	}, [uploads, lopu, markCommitted]);

	const chrome = React.useMemo<BuilderChrome>(
		() => ({
			hoverId,
			selectedId,
			onHover: setHoverId,
			// selecting an already-selected block keeps it selected (clicking into
			// text to edit must never toggle the selection away) — deselect lives
			// on Escape and the drawer
			onSelect: (id) => setSelectedId(id),
			onInsert: (containerId, index, anchor) => setInsertAt({ containerId, index, anchor }),
			onMove: (id, containerId, index) => {
				draftRef.current.setBlocks(moveBlock(draftRef.current.blocks, id, containerId, index));
			},
			onUpdate: (id, patch) => {
				draftRef.current.setBlocks(updateBlock(draftRef.current.blocks, id, patch));
			},
			onDropFiles: (files, containerId, index) => {
				files.forEach((file, offset) => {
					pendingDropsRef.current.push({ name: file.name, size: file.size, containerId, index: index + offset });
				});
				addFiles(files);
				lopu({ title: `Uploading ${files.length === 1 ? files[0].name : `${files.length} files`}… ⬆️`, status: 'info' });
			}
		}),
		[hoverId, selectedId, addFiles, lopu]
	);

	// Escape deselects from anywhere in the canvas (the inline editor commits
	// first via its own Escape handler, then the event bubbles here)
	React.useEffect(() => {
		if (!selectedId) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.code === 'Escape') setSelectedId(null);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [selectedId]);

	const handlePick = React.useCallback((pick: InsertPick) => {
		const target = insertAt;
		setInsertAt(null);
		if (!target) return;
		const current = draftRef.current;
		current.setBlocks(insertBlock(current.blocks, target.containerId, target.index, pick.block));
		if (pick.block.type === 'component' && pick.block.component) {
			if (pick.component) current.addComponent(pick.block.component, pick.component);
			else current.ensureComponent(pick.block.component);
		}
		setSelectedId(pick.block.id);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- insertAt is read via closure at call time
	}, [insertAt]);

	const insertMenu = insertAt ? (
		<BlockInsertMenu
			anchor={insertAt.anchor}
			existingIds={collectBlockIds(draft.blocks)}
			onPick={handlePick}
			onClose={() => setInsertAt(null)}
		/>
	) : null;

	const deselect = React.useCallback(() => setSelectedId(null), []);

	return {
		chrome,
		selectedId,
		deselect,
		insertMenu
	};
};
