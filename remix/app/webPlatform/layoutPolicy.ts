import type { Arg, Policy } from './domBridge';
export type LayoutArg =
	| 'layout-options'
	| 'layout-point'
	| 'layout-rect'
	| 'layout-quad'
	| 'layout-scroll'
	| 'layout-visibility'
	| 'layout-box'
	| 'layout-convert'
	| 'layout-caret'
	| 'layout-event';
const call = (args: Arg[] = [], min = args.length) => ({ args, min });
const scroll = (rule: Arg) => ({ ...call([rule], 0), awaitResult: true });
export const LAYOUT_GLOBALS: Record<string, string> = {
	Window:
		'devicePixelRatio innerHeight innerWidth outerHeight outerWidth pageXOffset pageYOffset screen screenLeft screenTop screenX screenY scrollX scrollY visualViewport',
	Document: 'scrollingElement'
};
export const LAYOUT_CONSTRUCTORS = {
	DOMQuad: call(['layout-point', 'layout-point', 'layout-point', 'layout-point'], 0),
	MediaQueryListEvent: call(['text', 'layout-event'], 1),
	MouseEvent: call(['text', 'layout-event'], 1)
};
export const LAYOUT_STATIC = {
	DOMQuad: { fromRect: call(['layout-rect'], 0), fromQuad: call(['layout-quad'], 0) },
	Window: {
		matchMedia: call(['css-text']),
		scroll: scroll('layout-scroll'),
		scrollTo: scroll('layout-scroll'),
		scrollBy: scroll('layout-scroll'),
		moveBy: call(['finite', 'finite']),
		moveTo: call(['finite', 'finite']),
		resizeBy: call(['finite', 'finite']),
		resizeTo: call(['finite', 'finite'])
	},
	Document: {
		createRange: call(),
		elementFromPoint: call(['finite', 'finite']),
		elementsFromPoint: call(['finite', 'finite']),
		caretPositionFromPoint: call(['finite', 'finite', 'layout-caret'], 2)
	}
};
export const LAYOUT_ELEMENT: Policy = {
	reads: 'clientHeight clientLeft clientTop clientWidth currentCSSZoom scrollHeight scrollLeft scrollTop scrollWidth',
	writes: 'scrollLeft scrollTop',
	writeArgs: { scrollLeft: 'finite', scrollTop: 'finite' },
	calls: {
		checkVisibility: call(['layout-visibility'], 0),
		getBoundingClientRect: call(),
		getClientRects: call(),
		scroll: scroll('layout-scroll'),
		scrollBy: scroll('layout-scroll'),
		scrollTo: scroll('layout-scroll'),
		scrollIntoView: scroll('layout-options'),
		getBoxQuads: call(['layout-box'], 0),
		convertPointFromNode: call(['layout-point', 'node', 'layout-convert'], 2),
		convertRectFromNode: call(['layout-rect', 'node', 'layout-convert'], 2),
		convertQuadFromNode: call(['layout-quad', 'node', 'layout-convert'], 2)
	}
};
export const LAYOUT_RECEIVER_POLICY: Record<string, Policy> = {
	HTMLImageElement: { reads: 'x y' },
	CaretPosition: { reads: 'offset offsetNode', calls: { getClientRect: call() } },
	Range: {
		// Engines expose these accessors on Range or its AbstractRange base.
		reads: 'startContainer startOffset endContainer endOffset collapsed',
		calls: { selectNodeContents: call(['node']), getBoundingClientRect: call(), getClientRects: call() }
	},
	AbstractRange: { reads: 'startContainer startOffset endContainer endOffset collapsed' },
	MediaQueryList: { reads: 'matches media' },
	MediaQueryListEvent: { reads: 'matches media type isTrusted' },
	MouseEvent: { reads: 'offsetX offsetY pageX pageY x y clientX clientY type isTrusted' },
	Screen: { reads: 'availHeight availWidth colorDepth height pixelDepth width' },
	VisualViewport: { reads: 'height offsetLeft offsetTop pageLeft pageTop scale width' },
	DOMQuad: { reads: 'p1 p2 p3 p4', calls: { getBounds: call(), toJSON: call() } },
	DOMRectList: { reads: 'length', calls: { item: call(['number']) } }
};
