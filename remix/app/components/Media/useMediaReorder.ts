import React from 'react';

// Grip-handle reordering for media tiles and file rows. Pointer events (not
// HTML5 drag-and-drop) so one code path covers mouse AND touch, and so tile
// drags can never be mistaken for OS file drops by the surrounding
// "drop files anywhere in this panel" zone. The move commits on RELEASE (the
// hovered tile shows a drop outline while dragging): reordering mid-drag
// would make React move the captured grip's DOM node, which releases pointer
// capture and kills the drag. Arrow keys on the focused grip move instantly.

export type MediaReorderNudge = 'earlier' | 'later' | 'start' | 'end';

export const MEDIA_REORDER_ID_ATTR = 'data-media-reorder-id';
export const MEDIA_REORDER_GROUP_ATTR = 'data-media-reorder-group';

const NUDGE_BY_KEY: Record<string, MediaReorderNudge> = {
	ArrowLeft: 'earlier',
	ArrowUp: 'earlier',
	ArrowRight: 'later',
	ArrowDown: 'later',
	Home: 'start',
	End: 'end'
};

const EDGE_SCROLL_ZONE_PX = 72;
const EDGE_SCROLL_STEP_PX = 14;

type ActiveDrag = { id: string; group: string; pointerId: number };

export type MediaReorderTileProps = {
	[MEDIA_REORDER_ID_ATTR]: string;
	[MEDIA_REORDER_GROUP_ATTR]: string;
};

export const useMediaReorder = (options: {
	disabled?: boolean;
	onMove: (sourceId: string, targetId: string) => void;
	onNudge: (sourceId: string, nudge: MediaReorderNudge) => void;
}) => {
	const { disabled, onMove, onNudge } = options;
	const [draggingId, setDraggingId] = React.useState<string | null>(null);
	const [dropTargetId, setDropTargetId] = React.useState<string | null>(null);
	const activeRef = React.useRef<ActiveDrag | null>(null);
	const dropTargetRef = React.useRef<string | null>(null);
	const onMoveRef = React.useRef(onMove);
	onMoveRef.current = onMove;
	const onNudgeRef = React.useRef(onNudge);
	onNudgeRef.current = onNudge;

	const endDrag = React.useCallback(() => {
		if (!activeRef.current) return;
		activeRef.current = null;
		dropTargetRef.current = null;
		document.body.style.removeProperty('user-select');
		setDraggingId(null);
		setDropTargetId(null);
	}, []);

	React.useEffect(() => endDrag, [endDrag]);

	const tileProps = React.useCallback(
		(id: string, group: string): MediaReorderTileProps => ({
			[MEDIA_REORDER_ID_ATTR]: id,
			[MEDIA_REORDER_GROUP_ATTR]: group
		}),
		[]
	);

	const gripProps = React.useCallback(
		(id: string, group: string) => ({
			// touchAction none lets a touch drag start from the grip instead of
			// scrolling the page; the rest of the tile scrolls normally
			style: { touchAction: 'none' } as React.CSSProperties,
			onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
				if (disabled || activeRef.current) return;
				if (event.pointerType === 'mouse' && event.button !== 0) return;
				activeRef.current = { id, group, pointerId: event.pointerId };
				try {
					event.currentTarget.setPointerCapture(event.pointerId);
				} catch {
					// a pointer already released in this frame cannot be captured; the
					// drag simply stays armed until its pointerup/cancel reaches the grip
				}
				document.body.style.userSelect = 'none';
				setDraggingId(id);
			},
			onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
				const active = activeRef.current;
				if (!active || event.pointerId !== active.pointerId) return;
				event.preventDefault();
				// keep long grids reachable: nudge the window when dragging near its edges
				if (event.clientY < EDGE_SCROLL_ZONE_PX) window.scrollBy(0, -EDGE_SCROLL_STEP_PX);
				else if (event.clientY > window.innerHeight - EDGE_SCROLL_ZONE_PX) window.scrollBy(0, EDGE_SCROLL_STEP_PX);
				const hovered = document
					.elementFromPoint(event.clientX, event.clientY)
					?.closest(`[${MEDIA_REORDER_ID_ATTR}]`) as HTMLElement | null;
				const targetId =
					hovered && hovered.getAttribute(MEDIA_REORDER_GROUP_ATTR) === active.group ? hovered.getAttribute(MEDIA_REORDER_ID_ATTR) : null;
				const next = targetId && targetId !== active.id ? targetId : null;
				if (dropTargetRef.current === next) return;
				dropTargetRef.current = next;
				setDropTargetId(next);
			},
			onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
				const active = activeRef.current;
				if (!active || event.pointerId !== active.pointerId) return;
				const targetId = dropTargetRef.current;
				endDrag();
				if (targetId) onMoveRef.current(active.id, targetId);
			},
			onPointerCancel: (event: React.PointerEvent<HTMLElement>) => {
				if (activeRef.current?.pointerId === event.pointerId) endDrag();
			},
			onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
				if (disabled) return;
				const nudge = NUDGE_BY_KEY[event.key];
				if (!nudge) return;
				event.preventDefault();
				event.stopPropagation();
				onNudgeRef.current(id, nudge);
			}
		}),
		[disabled, endDrag]
	);

	return { draggingId, dropTargetId, tileProps, gripProps };
};

// Shared list-move semantics: the source item takes the target item's current
// position (splice out, splice in) — the same shape the uploads hook applies,
// so pointer drags and keyboard nudges land identically everywhere.
export const movedToTargetPosition = <T>(items: readonly T[], idOf: (item: T) => string, sourceId: string, targetId: string): T[] | null => {
	const from = items.findIndex((item) => idOf(item) === sourceId);
	const to = items.findIndex((item) => idOf(item) === targetId);
	if (from < 0 || to < 0 || from === to) return null;
	const next = [...items];
	const [moved] = next.splice(from, 1);
	next.splice(to, 0, moved);
	return next;
};

// Resolve a keyboard nudge into the concrete same-group neighbour to move to.
// `groupIds` is the section's ids in current visual order.
export const nudgeTargetId = (groupIds: readonly string[], sourceId: string, nudge: MediaReorderNudge): string | null => {
	const index = groupIds.indexOf(sourceId);
	if (index < 0 || groupIds.length < 2) return null;
	const targetIndex =
		nudge === 'start' ? 0 : nudge === 'end' ? groupIds.length - 1 : nudge === 'earlier' ? Math.max(0, index - 1) : Math.min(groupIds.length - 1, index + 1);
	return targetIndex === index ? null : groupIds[targetIndex];
};
