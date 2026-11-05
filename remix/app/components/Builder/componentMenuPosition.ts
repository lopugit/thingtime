type Anchor = { left: number; right: number; top: number; bottom: number };
/** Keep native top-layer menus inside the viewport, including pointer anchors. */
export function menuPosition(anchor: Anchor, bounds: { width: number; height: number }, width: number, height: number, context: boolean) {
	const gap = context ? 0 : 8;
	const left = context ? anchor.left : anchor.right - bounds.width;
	const top = anchor.bottom + gap + bounds.height <= height - 12
		? anchor.bottom + gap : anchor.top - bounds.height - gap;
	return {
		left: Math.max(12, Math.min(left, width - bounds.width - 12)),
		top: Math.max(12, Math.min(top, height - bounds.height - 12)),
	};
}

/** Preserve authored grid/flex layout only while the trusted popover is open. */
export function setMenuDisplay(style: Pick<CSSStyleDeclaration, 'setProperty' | 'removeProperty'>, authored: { value: string; priority: string }, open: boolean) {
	if (!open) style.setProperty('display', 'none', 'important');
	else if (authored.value) style.setProperty('display', authored.value, authored.priority);
	else style.removeProperty('display');
}
