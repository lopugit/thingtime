import React from 'react';

import { BlockInsertMenu, type InsertPick } from './BlockInsertMenu';
import { collectBlockIds, insertBlock, moveBlock } from './webpageBlocks';
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

	const chrome = React.useMemo<BuilderChrome>(
		() => ({
			hoverId,
			selectedId,
			onHover: setHoverId,
			onSelect: (id) => setSelectedId((prev) => (prev === id ? null : id)),
			onInsert: (containerId, index, anchor) => setInsertAt({ containerId, index, anchor }),
			onMove: (id, containerId, index) => {
				draftRef.current.setBlocks(moveBlock(draftRef.current.blocks, id, containerId, index));
			}
		}),
		[hoverId, selectedId]
	);

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
