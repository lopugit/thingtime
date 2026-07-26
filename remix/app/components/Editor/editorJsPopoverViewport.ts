export const EDITOR_JS_POPOVER_VIEWPORT_CSS_VARS = {
	left: '--tt-editor-visual-viewport-left',
	width: '--tt-editor-visual-viewport-width',
	height: '--tt-editor-visual-viewport-height',
	bottomInset: '--tt-editor-visual-viewport-bottom-inset'
} as const;

export type EditorJsPopoverViewportInput = {
	layoutWidth: number;
	layoutHeight: number;
	visualViewport?: {
		width: number;
		height: number;
		offsetLeft: number;
		offsetTop: number;
	} | null;
};

export type EditorJsPopoverViewportMetrics = {
	left: number;
	top: number;
	width: number;
	height: number;
	bottomInset: number;
};

const finiteNonNegative = (value: unknown, fallback = 0): number => {
	return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;
};

/**
 * Translate the browser's visual viewport into layout-viewport coordinates.
 * Editor.js anchors its mobile popovers to the layout viewport, while iOS can
 * shrink and pan the actually visible viewport for the keyboard or pinch zoom.
 */
export const getEditorJsPopoverViewportMetrics = (input: EditorJsPopoverViewportInput): EditorJsPopoverViewportMetrics => {
	const layoutWidth = finiteNonNegative(input.layoutWidth);
	const layoutHeight = finiteNonNegative(input.layoutHeight);
	const viewportWidth = Math.min(layoutWidth, finiteNonNegative(input.visualViewport?.width, layoutWidth));
	const viewportHeight = Math.min(layoutHeight, finiteNonNegative(input.visualViewport?.height, layoutHeight));
	const left = Math.min(finiteNonNegative(input.visualViewport?.offsetLeft), Math.max(0, layoutWidth - viewportWidth));
	const top = Math.min(finiteNonNegative(input.visualViewport?.offsetTop), Math.max(0, layoutHeight - viewportHeight));

	return {
		left,
		top,
		width: viewportWidth,
		height: viewportHeight,
		bottomInset: Math.max(0, layoutHeight - top - viewportHeight)
	};
};

type EditorJsPopoverViewportHolder = Pick<HTMLElement, 'style'>;

type EditorJsPopoverViewportSubscription = {
	holders: Map<EditorJsPopoverViewportHolder, number>;
	applyToHolder: (holder: EditorJsPopoverViewportHolder) => void;
	destroy: () => void;
};

const subscriptions = new WeakMap<Window, EditorJsPopoverViewportSubscription>();

const clearViewportCssVars = (holder: EditorJsPopoverViewportHolder): void => {
	for (const property of Object.values(EDITOR_JS_POPOVER_VIEWPORT_CSS_VARS)) holder.style.removeProperty(property);
};

const createViewportSubscription = (viewportWindow: Window): EditorJsPopoverViewportSubscription => {
	const holders = new Map<EditorJsPopoverViewportHolder, number>();
	const visualViewport = viewportWindow.visualViewport;
	let animationFrame: number | null = null;

	const readMetrics = (): EditorJsPopoverViewportMetrics => {
		return getEditorJsPopoverViewportMetrics({
			layoutWidth: viewportWindow.innerWidth,
			layoutHeight: viewportWindow.innerHeight,
			visualViewport: visualViewport
				? {
						width: visualViewport.width,
						height: visualViewport.height,
						offsetLeft: visualViewport.offsetLeft,
						offsetTop: visualViewport.offsetTop
				  }
				: null
		});
	};

	const applyMetrics = (holder: EditorJsPopoverViewportHolder, metrics: EditorJsPopoverViewportMetrics): void => {
		const { left, width, height, bottomInset } = EDITOR_JS_POPOVER_VIEWPORT_CSS_VARS;
		holder.style.setProperty(left, `${metrics.left}px`);
		holder.style.setProperty(width, `${metrics.width}px`);
		holder.style.setProperty(height, `${metrics.height}px`);
		holder.style.setProperty(bottomInset, `${metrics.bottomInset}px`);
	};

	const applyToHolder = (holder: EditorJsPopoverViewportHolder): void => {
		applyMetrics(holder, readMetrics());
	};

	const syncAll = (): void => {
		animationFrame = null;
		const metrics = readMetrics();
		for (const holder of holders.keys()) applyMetrics(holder, metrics);
	};

	const scheduleSync = (): void => {
		if (animationFrame !== null) return;
		animationFrame = viewportWindow.requestAnimationFrame(syncAll);
	};

	viewportWindow.addEventListener('resize', scheduleSync);
	visualViewport?.addEventListener('resize', scheduleSync);
	visualViewport?.addEventListener('scroll', scheduleSync, { passive: true });

	return {
		holders,
		applyToHolder,
		destroy: () => {
			viewportWindow.removeEventListener('resize', scheduleSync);
			visualViewport?.removeEventListener('resize', scheduleSync);
			visualViewport?.removeEventListener('scroll', scheduleSync);
			if (animationFrame !== null) viewportWindow.cancelAnimationFrame(animationFrame);
		}
	};
};

/**
 * Keep Editor.js mobile popovers aligned to the visible viewport. Subscriptions
 * are shared across editor instances so a feed containing many editors still
 * adds only one listener set to the window and VisualViewport.
 */
export const watchEditorJsPopoverViewport = (holder: HTMLElement, viewportWindow: Window = window): (() => void) => {
	let subscription = subscriptions.get(viewportWindow);
	if (!subscription) {
		subscription = createViewportSubscription(viewportWindow);
		subscriptions.set(viewportWindow, subscription);
	}

	subscription.holders.set(holder, (subscription.holders.get(holder) ?? 0) + 1);
	subscription.applyToHolder(holder);
	let active = true;

	return () => {
		if (!active) return;
		active = false;
		const holderSubscriptions = subscription?.holders.get(holder) ?? 0;
		if (holderSubscriptions <= 1) {
			clearViewportCssVars(holder);
			subscription?.holders.delete(holder);
		} else {
			subscription?.holders.set(holder, holderSubscriptions - 1);
		}
		if (subscription?.holders.size === 0) {
			subscription.destroy();
			subscriptions.delete(viewportWindow);
		}
	};
};
