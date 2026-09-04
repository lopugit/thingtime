import React from 'react';
import { Box } from '@chakra-ui/react';

// Click-and-hold (then drag) reorderable vertical list.
// Pointer-events based so it works for mouse and touch without extra deps:
// - hold HOLD_MS with the pointer mostly still to arm the drag
// - moving before the hold completes cancels it (so taps/scrolls still work)
// - while dragging, non-active items preview-shift out of the way
// - on release the new id order is committed via onReorder

export interface ReorderableEntry {
	id: string;
	node: React.ReactNode;
}

interface ReorderableListProps {
	items: ReorderableEntry[];
	onReorder: (ids: string[]) => void;
	disabled?: boolean;
	// When enabled, a drag can only start from an element marked with
	// data-reorder-handle. Existing drawer lists deliberately keep their
	// click-and-hold-anywhere behaviour.
	handleOnly?: boolean;
	// restrict where a drag may start (e.g. a dedicated handle) so a list of
	// composite entries can nest other ReorderableLists without both arming
	// from the same pointerdown
	shouldStartDrag?: (event: React.PointerEvent) => boolean;
}

const HOLD_MS = 280;
const MOVE_CANCEL_PX = 8;

interface DragRects {
	[id: string]: { top: number; height: number; center: number };
}

interface DragState {
	activeId: string;
	delta: number;
	order: string[];
}

export const ReorderableList = (props: ReorderableListProps) => {
	const { items, onReorder, disabled, handleOnly, shouldStartDrag } = props;
	const shouldStartDragRef = React.useRef(shouldStartDrag);
	shouldStartDragRef.current = shouldStartDrag;

	const ids = React.useMemo(() => items.map((item) => item.id), [items]);
	const idsRef = React.useRef(ids);
	idsRef.current = ids;

	const itemRefs = React.useRef(new Map<string, HTMLDivElement>());
	const sessionRef = React.useRef<any>(null);
	const suppressClickRef = React.useRef(false);

	const [drag, setDrag] = React.useState<DragState | null>(null);

	// holds the just-committed order until the parent's ordering prop catches
	// up (onReorder lands via the setThingtime queue a render later) so the
	// drop never paints one frame in the old order
	const [pendingOrder, setPendingOrder] = React.useState<string[] | null>(null);

	const onReorderRef = React.useRef(onReorder);
	onReorderRef.current = onReorder;

	React.useEffect(() => {
		if (!pendingOrder) {
			return;
		}

		const sameSet = ids.length === pendingOrder.length && ids.every((id) => pendingOrder.includes(id));
		const caughtUp = sameSet && ids.every((id, index) => id === pendingOrder[index]);

		// clear once the parent matches — or diverges (items changed under us)
		if (caughtUp || !sameSet) {
			setPendingOrder(null);
		}
	}, [ids, pendingOrder]);

	const cleanupSession = React.useCallback(() => {
		const session = sessionRef.current;

		if (!session) {
			return;
		}

		clearTimeout(session.holdTimer);
		window.removeEventListener('pointermove', session.onPointerMove);
		window.removeEventListener('pointerup', session.onPointerUp);
		window.removeEventListener('pointercancel', session.onPointerCancel);
		window.removeEventListener('touchmove', session.onTouchMove);

		try {
			document.body.style.userSelect = '';
			document.body.style.cursor = '';
		} catch {
			// nothing
		}

		sessionRef.current = null;
		setDrag(null);
	}, []);

	// unmount safety
	React.useEffect(() => {
		return () => {
			cleanupSession();
		};
	}, [cleanupSession]);

	const computeOrder = React.useCallback((session: any, delta: number): string[] => {
		const startIds: string[] = session.startIds;
		const rects: DragRects = session.rects;
		const activeId: string = session.id;

		const activeCenter = rects[activeId].center + delta;
		const others = startIds.filter((id) => id !== activeId);

		let newIndex = 0;
		others.forEach((id) => {
			if (rects[id].center < activeCenter) {
				newIndex += 1;
			}
		});

		const order = [...others];
		order.splice(newIndex, 0, activeId);

		return order;
	}, []);

	const armDrag = React.useCallback(
		(session: any) => {
			const rects: DragRects = {};

			session.startIds.forEach((id: string) => {
				const el = itemRefs.current.get(id);
				if (el) {
					const rect = el.getBoundingClientRect();
					rects[id] = {
						top: rect.top,
						height: rect.height,
						center: rect.top + rect.height / 2
					};
				}
			});

			// if anything failed to measure, bail rather than glitch
			if (session.startIds.some((id: string) => !rects[id])) {
				cleanupSession();
				return;
			}

			let gap = 0;
			if (session.startIds.length >= 2) {
				const first = rects[session.startIds[0]];
				const second = rects[session.startIds[1]];
				gap = Math.max(0, second.top - (first.top + first.height));
			}

			session.rects = rects;
			session.gap = gap;
			session.armed = true;
			session.order = session.startIds;

			try {
				document.body.style.userSelect = 'none';
				document.body.style.cursor = 'grabbing';
			} catch {
				// nothing
			}

			setDrag({
				activeId: session.id,
				delta: session.lastDelta || 0,
				order: session.startIds
			});
		},
		[cleanupSession]
	);

	const onItemPointerDown = React.useCallback(
		(event: React.PointerEvent, id: string) => {
			if (disabled || sessionRef.current) {
				return;
			}

			if (handleOnly) {
				const target = event.target instanceof Element ? event.target : null;
				if (!target?.closest('[data-reorder-handle]')) {
					return;
				}
			}

			// primary button / touch only
			if (event.pointerType === 'mouse' && event.button !== 0) {
				return;
			}

			if (shouldStartDragRef.current && !shouldStartDragRef.current(event)) {
				return;
			}

			const session: any = {
				id,
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				startIds: [...idsRef.current],
				armed: false,
				lastDelta: 0
			};

			session.onPointerMove = (e: PointerEvent) => {
				if (e.pointerId !== session.pointerId) {
					return;
				}

				const dx = e.clientX - session.startX;
				const dy = e.clientY - session.startY;

				if (!session.armed) {
					// moving before the hold completes = scroll/click intent
					if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
						cleanupSession();
					}
					return;
				}

				session.lastDelta = dy;
				const order = computeOrder(session, dy);
				session.order = order;

				setDrag({
					activeId: session.id,
					delta: dy,
					order
				});
			};

			session.onPointerUp = (e: PointerEvent) => {
				if (e.pointerId !== session.pointerId) {
					return;
				}

				if (session.armed) {
					const finalOrder: string[] = session.order || session.startIds;
					const changed = finalOrder.some((orderedId: string, index: number) => orderedId !== session.startIds[index]);

					if (changed) {
						setPendingOrder(finalOrder);
						onReorderRef.current?.(finalOrder);
					}

					// swallow the click that follows a drag release
					suppressClickRef.current = true;
					setTimeout(() => {
						suppressClickRef.current = false;
					}, 120);
				}

				cleanupSession();
			};

			session.onPointerCancel = () => {
				cleanupSession();
			};

			// non-passive so we can stop touch scrolling once the drag is armed
			session.onTouchMove = (e: TouchEvent) => {
				if (session.armed) {
					e.preventDefault();
				}
			};

			session.holdTimer = setTimeout(() => {
				if (sessionRef.current === session) {
					armDrag(session);
				}
			}, HOLD_MS);

			sessionRef.current = session;

			window.addEventListener('pointermove', session.onPointerMove);
			window.addEventListener('pointerup', session.onPointerUp);
			window.addEventListener('pointercancel', session.onPointerCancel);
			window.addEventListener('touchmove', session.onTouchMove, { passive: false });
		},
		[disabled, handleOnly, armDrag, cleanupSession, computeOrder]
	);

	const onItemClickCapture = React.useCallback((event: React.MouseEvent) => {
		if (suppressClickRef.current) {
			event.preventDefault();
			event.stopPropagation();
		}
	}, []);

	const session = sessionRef.current;

	const renderItems = React.useMemo(() => {
		if (!pendingOrder) {
			return items;
		}

		return [...items].sort((a, b) => pendingOrder.indexOf(a.id) - pendingOrder.indexOf(b.id));
	}, [items, pendingOrder]);

	return (
		<>
			{renderItems.map((item) => {
				const isActive = drag?.activeId === item.id;

				let transform;
				let transition;

				if (drag && session?.armed) {
					if (isActive) {
						transform = `translateY(${drag.delta}px) scale(1.02)`;
						transition = 'none';
					} else {
						const origIndex = session.startIds.indexOf(item.id);
						const previewIndex = drag.order.indexOf(item.id);

						if (origIndex !== -1 && previewIndex !== -1 && origIndex !== previewIndex) {
							const activeHeight = session.rects?.[drag.activeId]?.height || 0;
							const shift = (previewIndex - origIndex) * (activeHeight + (session.gap || 0));
							transform = `translateY(${shift}px)`;
						}

						transition = 'transform 0.16s ease-out';
					}
				}

				return (
					<Box
						key={item.id}
						ref={(el: HTMLDivElement | null) => {
							if (el) {
								itemRefs.current.set(item.id, el);
							} else {
								itemRefs.current.delete(item.id);
							}
						}}
						position="relative"
						zIndex={isActive ? 1 : undefined}
						sx={{ touchAction: 'pan-y' }}
						borderRadius="var(--tt-radius-sm, 9px)"
						transform={transform}
						transition={transition}
						boxShadow={isActive ? 'var(--tt-shadow-popover, 0 16px 40px -12px rgba(20, 20, 40, 0.3))' : undefined}
						opacity={isActive ? 0.95 : undefined}
						background={isActive ? 'var(--tt-card, #ffffff)' : undefined}
						cursor={isActive ? 'grabbing' : undefined}
						onClickCapture={onItemClickCapture}
						onPointerDown={(e) => onItemPointerDown(e, item.id)}
					>
						{item.node}
					</Box>
				);
			})}
		</>
	);
};
