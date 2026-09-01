import React from 'react';

import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';
import { useAttachmentUploads } from '../Attachments/useAttachmentUploads';
import { BlockInsertMenu, type InsertPick } from './BlockInsertMenu';
import { BlockContextMenu } from './BlockContextMenu';
import { RichTextModal } from './RichTextModal';
import {
	collectBlockIds,
	duplicateBlock,
	findBlock,
	findParentId,
	insertBlock,
	moveBlock,
	moveBlockRelative,
	newBlockId,
	removeBlock,
	updateBlock,
	wrapBlock,
	type WebpageBlock
} from './webpageBlocks';
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
	// upload files AT a block: media blocks swap their src in place, containers
	// take the media inside, anything else gets it inserted right after —
	// shared by on-block drops, Cmd/Ctrl+V paste, and the inspector's Upload
	uploadToBlock: (blockId: string, files: File[]) => void;
	// upload files to a position (canvas-wide drops outside any zone/block)
	uploadToPosition: (files: File[], containerId: string | null, index: number) => void;
};

// Where an in-flight upload should land when it turns ready.
type UploadTarget =
	| { kind: 'insert'; containerId: string | null; index: number }
	| { kind: 'replace'; blockId: string };

export const useBuilderChrome = (draft: UseWebpageDraft): UseBuilderChrome => {
	const [hoverId, setHoverId] = React.useState<string | null>(null);
	const [selectedId, setSelectedId] = React.useState<string | null>(null);
	const [insertAt, setInsertAt] = React.useState<{ containerId: string | null; index: number; anchor: HTMLElement } | null>(null);
	const [contextMenu, setContextMenu] = React.useState<{ blockId: string; x: number; y: number; wrapOnly?: boolean } | null>(null);
	const [richEditorBlockId, setRichEditorBlockId] = React.useState<string | null>(null);

	const draftRef = React.useRef(draft);
	draftRef.current = draft;

	const user = useCurrentUser();
	const lopu = useLopu();

	// OS file drops / pastes / inspector uploads → attachment uploads → media
	// landing at their recorded target. Targets are matched back by
	// (name, size) when each upload turns ready.
	const pendingDropsRef = React.useRef<Array<{ name: string; size: number; queuedAt: number; target: UploadTarget }>>([]);
	const consumedUploadsRef = React.useRef(new Set<string>());
	const uploader = useAttachmentUploads(
		user?.id,
		undefined,
		(message) => lopu({ title: message, status: 'error' }),
		true
	);
	const { uploads, addFiles, markCommitted, remove: removeUpload } = uploader;

	const queueFiles = React.useCallback(
		(files: File[], targetOf: (offset: number) => UploadTarget) => {
			if (!files.length) return;
			// clone with a fresh lastModified: the uploader dedupes selections by
			// (name, size, lastModified) against the whole session, which would
			// silently swallow a re-drop of the same OS file
			const unique = files.map(
				(file, offset) => new File([file], file.name || 'pasted-media', { type: file.type, lastModified: Date.now() + offset })
			);
			unique.forEach((file, offset) => {
				pendingDropsRef.current.push({ name: file.name, size: file.size, queuedAt: Date.now(), target: targetOf(offset) });
			});
			addFiles(unique);
			lopu({ title: `Uploading ${unique.length === 1 ? unique[0].name : `${unique.length} files`}… ⬆️`, status: 'info' });
		},
		[addFiles, lopu]
	);

	const uploadToPosition = React.useCallback(
		(files: File[], containerId: string | null, index: number) => {
			queueFiles(files, (offset) => ({ kind: 'insert', containerId, index: index + offset }));
		},
		[queueFiles]
	);

	const uploadToBlock = React.useCallback(
		(blockId: string, files: File[]) => {
			const blocks = draftRef.current.blocks;
			const block = findBlock(blocks, blockId);
			if (!block) {
				uploadToPosition(files, null, blocks.length);
				return;
			}
			if (block.type === 'media') {
				// first file replaces the media block's source, extras land after it
				const parentId = findParentId(blocks, blockId);
				const siblings = parentId === null ? blocks : findBlock(blocks, parentId as string)?.children || [];
				const index = siblings.findIndex((sibling) => sibling.id === blockId);
				queueFiles(files, (offset) =>
					offset === 0
						? { kind: 'replace', blockId }
						: { kind: 'insert', containerId: (parentId as string | null) ?? null, index: index + offset }
				);
				return;
			}
			if (block.type === 'container') {
				const start = block.children?.length || 0;
				queueFiles(files, (offset) => ({ kind: 'insert', containerId: blockId, index: start + offset }));
				return;
			}
			const parentId = findParentId(blocks, blockId);
			const siblings = parentId === null ? blocks : findBlock(blocks, parentId as string)?.children || [];
			const index = siblings.findIndex((sibling) => sibling.id === blockId);
			queueFiles(files, (offset) => ({
				kind: 'insert',
				containerId: (parentId as string | null) ?? null,
				index: (index === -1 ? siblings.length : index + 1) + offset
			}));
		},
		[queueFiles, uploadToPosition]
	);

	React.useEffect(() => {
		for (const upload of uploads) {
			if (upload.status !== 'ready' || !upload.attachment || consumedUploadsRef.current.has(upload.localId)) continue;
			consumedUploadsRef.current.add(upload.localId);
			// entries whose upload errored out never get consumed — drop them
			// before matching so they can't capture a later same-name upload
			pendingDropsRef.current = pendingDropsRef.current.filter((entry) => Date.now() - entry.queuedAt < 15 * 60_000);
			const pendingIndex = pendingDropsRef.current.findIndex(
				(entry) => entry.name === upload.file.name && entry.size === upload.file.size
			);
			const target = pendingIndex >= 0 ? pendingDropsRef.current.splice(pendingIndex, 1)[0].target : null;
			const attachment = upload.attachment;
			markCommitted([attachment.id]);
			const current = draftRef.current;
			const media: WebpageBlock['media'] =
				attachment.contentType.startsWith('video/') ? 'video' : attachment.contentType.startsWith('audio/') ? 'audio' : 'image';
			const src = `/api/v1/attachments/content?id=${encodeURIComponent(attachment.id)}`;
			if (target?.kind === 'replace' && findBlock(current.blocks, target.blockId)?.type === 'media') {
				current.setBlocks(
					updateBlock(current.blocks, target.blockId, {
						media,
						src,
						...(attachment.name ? { alt: attachment.name } : {})
					})
				);
				setSelectedId(target.blockId);
			} else {
				const block: WebpageBlock = {
					id: newBlockId('media', collectBlockIds(current.blocks)),
					type: 'media',
					media,
					src,
					...(attachment.name ? { alt: attachment.name } : {})
				};
				const insertAtTarget = target && target.kind === 'insert' ? target : null;
				// the recorded container may have been deleted while the upload was
				// in flight — insertBlock would then silently drop the block, so a
				// vanished target falls back to appending at the page root
				const containerAlive =
					!insertAtTarget?.containerId || !!findBlock(current.blocks, insertAtTarget.containerId);
				current.setBlocks(
					containerAlive
						? insertBlock(current.blocks, insertAtTarget?.containerId ?? null, insertAtTarget?.index ?? current.blocks.length, block)
						: insertBlock(current.blocks, null, current.blocks.length, block)
				);
				setSelectedId(block.id);
			}
			lopu({
				title: `${media === 'image' ? '🖼' : media === 'video' ? '🎬' : '🎵'} ${attachment.name || 'media'} added to the page`,
				status: 'success'
			});
			// retire the consumed upload from the session list — otherwise the
			// uploader's 25-file session cap fills up and its selection dedupe
			// starts refusing repeat drops (committed first, so no cleanup runs)
			removeUpload(upload.localId);
		}
	}, [uploads, lopu, markCommitted, removeUpload]);

	// Cmd/Ctrl+V while a block is selected: clipboard FILES (screenshots,
	// copied images/media) upload straight at the selection. Never steal a
	// paste that belongs to a focused control: form fields and the Editor.js
	// modal keep their native paste; the canvas inline text editor keeps
	// pastes that carry text (rich copy) and only hands PURE file pastes to
	// the uploader (a blob <img> pasted into contentEditable would die at the
	// allowlist render anyway — uploading is strictly better).
	React.useEffect(() => {
		if (!selectedId) return;
		const onPaste = (event: ClipboardEvent) => {
			if (event.defaultPrevented) return;
			const files = Array.from(event.clipboardData?.files || []);
			if (!files.length) return;
			const target = event.target as HTMLElement | null;
			if (target?.closest?.('input, textarea, select, [data-testid="rich-text-editor-modal"]')) return;
			const types = Array.from(event.clipboardData?.types || []);
			const carriesText = types.includes('text/html') || types.includes('text/plain');
			// the inline canvas editor keeps text-carrying pastes (rich copy);
			// PURE file pastes upload — an Editor.js-pasted image would land as a
			// data-uri that the render allowlist rejects
			if (carriesText && target?.closest?.('.ttInlineRichTextEditor, .codex-editor')) return;
			event.preventDefault();
			uploadToBlock(selectedId, files);
		};
		window.addEventListener('paste', onPaste);
		return () => window.removeEventListener('paste', onPaste);
	}, [selectedId, uploadToBlock]);

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
			onDropFiles: uploadToPosition ? (files, containerId, index) => uploadToPosition(files, containerId, index) : undefined,
			onMediaToBlock: (blockId, files) => uploadToBlock(blockId, files),
			onContextMenu: (blockId, x, y, wrapOnly) => setContextMenu({ blockId, x, y, wrapOnly })
		}),
		[hoverId, selectedId, uploadToPosition, uploadToBlock]
	);

	// Escape deselects from anywhere in the canvas (the inline editor commits
	// first via its own Escape handler, then the event bubbles here)
	React.useEffect(() => {
		if (!selectedId) return;
		const onKey = (event: KeyboardEvent) => {
			// an overlay (context menu, Editor.js popover) that consumed this
			// Escape marked it defaultPrevented — the selection stays
			if (event.code === 'Escape' && !event.defaultPrevented) setSelectedId(null);
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

	const contextBlock = contextMenu ? findBlock(draft.blocks, contextMenu.blockId) : null;
	const richEditorBlock = richEditorBlockId ? findBlock(draft.blocks, richEditorBlockId) : null;

	// one overlay node bundles every floating chrome surface (insert menu,
	// context menu, advanced rich editor) — hosts render it once after the
	// canvas
	const insertMenu = (
		<>
			{insertAt ? (
				<BlockInsertMenu
					anchor={insertAt.anchor}
					existingIds={collectBlockIds(draft.blocks)}
					onPick={handlePick}
					onClose={() => setInsertAt(null)}
				/>
			) : null}
			{contextMenu && contextBlock ? (
				<BlockContextMenu
					block={contextBlock}
					x={contextMenu.x}
					y={contextMenu.y}
					wrapOnly={contextMenu.wrapOnly}
					onClose={() => setContextMenu(null)}
					onWrap={(direction) => {
						const next = wrapBlock(draftRef.current.blocks, contextBlock.id, direction);
						if (next === draftRef.current.blocks) lopu({ title: 'Too deep to wrap here — pages nest 8 levels max 🪆', status: 'error' });
						else draftRef.current.setBlocks(next);
						setContextMenu(null);
					}}
					onDuplicate={() => {
						const next = duplicateBlock(draftRef.current.blocks, contextBlock.id);
						if (next === draftRef.current.blocks) lopu({ title: 'Duplicating would pass the 120-block page cap 📦', status: 'error' });
						else draftRef.current.setBlocks(next);
						setContextMenu(null);
					}}
					onDelete={() => {
						draftRef.current.setBlocks(removeBlock(draftRef.current.blocks, contextBlock.id));
						setContextMenu(null);
						setSelectedId(null);
					}}
					onMove={(delta) => {
						draftRef.current.setBlocks(moveBlockRelative(draftRef.current.blocks, contextBlock.id, delta));
					}}
					onOpenRichEditor={
						contextBlock.type === 'text'
							? () => {
									setContextMenu(null);
									setRichEditorBlockId(contextBlock.id);
							  }
							: undefined
					}
				/>
			) : null}
			{richEditorBlock ? (
				<RichTextModal
					block={richEditorBlock}
					isOpen
					onClose={() => setRichEditorBlockId(null)}
					onApply={(patch) => {
						draftRef.current.setBlocks(updateBlock(draftRef.current.blocks, richEditorBlock.id, patch));
					}}
				/>
			) : null}
		</>
	);

	const deselect = React.useCallback(() => setSelectedId(null), []);

	return {
		chrome,
		selectedId,
		deselect,
		insertMenu,
		uploadToBlock,
		uploadToPosition
	};
};
