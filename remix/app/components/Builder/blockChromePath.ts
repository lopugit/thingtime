import type { WebpageBlock } from './webpageBlocks';

/** Include every saved ancestor, including editable DOM/template boundaries. */
export const blockChromePath = (blocks: WebpageBlock[], id: string | null): WebpageBlock[] => {
 if (!id) return [];
 const stack = blocks.map(block => ({ block, path: [block] }));
 while (stack.length) {
  const entry = stack.pop()!;
  if (entry.block.id === id) return entry.path;
  for (const block of entry.block.children || []) stack.push({ block, path: [...entry.path, block] });
 }
 return [];
};

export { canAddBlockChildren } from './webpageBlocks';

/** Nested focus and pointer re-entry belong to the innermost block boundary. */
export const ownsBlockTarget = (target: EventTarget | null, currentTarget: EventTarget): boolean =>
 (target as Element | null)?.closest?.('[data-block-id]') === currentTarget;

/** Bound the full measured toolbar, not just its anchor, to its owning viewport. */
export const blockChromePosition = ({ frame, toolbar, viewport, clearance = 0, bottomClearance = 0 }: {
 frame: { left: number; top: number; bottom: number };
 toolbar: { width: number; height: number };
 viewport: { width: number; height: number };
 clearance?: number;
 bottomClearance?: number;
}): { left: number; top: number } => {
 const inset = 8;
 const bottom = Math.max(inset, viewport.height - bottomClearance - inset);
 const width = Math.min(toolbar.width, Math.max(0, viewport.width - inset * 2));
 const height = Math.min(toolbar.height, Math.max(0, bottom - clearance - inset));
 const minTop = Math.min(clearance + inset, Math.max(inset, bottom - height));
 const maxTop = Math.max(minTop, bottom - height);
 const above = frame.top - height + 2;
 const below = frame.bottom - 2;
 const preferred = above >= minTop ? above : below + height <= bottom ? below : above;
 return {
  left: Math.max(inset, Math.min(frame.left + 6, viewport.width - width - inset)),
  top: Math.max(minTop, Math.min(preferred, maxTop))
 };
};


/** Synthetic hover from a relocated toolbar is not new canvas pointer intent. */
export const shouldReleaseBlockChromePin = (origin: { x: number; y: number }, point: { x: number; y: number }, insideChrome: boolean, pointerDown = false): boolean =>
 !insideChrome && (pointerDown || Math.hypot(point.x - origin.x, point.y - origin.y) > 4);


/** Parent chrome may lag local selection by an effect; wait for its handshake. */
export const blockChromeSelectionState = (requestedId: string, selectedId: string | null, acknowledgedId: string | null): 'pending' | 'acknowledged' | 'changed' =>
 selectedId === requestedId ? 'acknowledged' : acknowledgedId === requestedId ? 'changed' : 'pending';


/** Project the host's reserved footer edge into a scaled preview viewport. */
export const blockChromeBottomInset = (viewportHeight: number, hostBottom: number, originY: number, scaleY: number): number =>
 Math.max(0, Math.min(viewportHeight, viewportHeight - (hostBottom - originY) / (scaleY || 1)));
