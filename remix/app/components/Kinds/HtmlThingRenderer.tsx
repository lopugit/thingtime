import React from 'react';

import { applyNoOpener, isEventHandlerProp, isSafeCssText, isSafeUrl } from './safeUrl';

// JSON → DOM renderer: lets people build their own html/css components as
// plain JSON things (stored in Mongo like any other thing) and render them
// live. A node is either a string (text) or:
//   { tag: 'div', props: { style: {…}, href, src, … }, children: [node, …] }
//
// Because the page is *data*, the same sanitisation gate that protects pasted
// JSON protects rendered pages: only whitelisted tags/props render, styles are
// object-form only, URLs are checked, and event handlers never pass through.

const ALLOWED_TAGS = new Set([
	'div',
	'span',
	'p',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'a',
	'img',
	'button',
	'ul',
	'ol',
	'li',
	'section',
	'article',
	'header',
	'footer',
	'nav',
	'aside',
	'main',
	'strong',
	'em',
	'small',
	// inline formatting produced by WYSIWYG editing / rich paste — pure
	// text-level semantics, no URL or script surface
	'b',
	'i',
	'u',
	's',
	'mark',
	'sub',
	'sup',
	'code',
	'pre',
	'blockquote',
	'hr',
	'br',
	'table',
	'thead',
	'tbody',
	'tr',
	'th',
	'td',
	'figure',
	'figcaption',
	'label',
	// a FORM GROUP: the ttAction click wrapper reads named fields from the
	// control's closest fieldset (else the whole component), so one component
	// can hold several independent forms
	'fieldset',
	'legend',
	'input',
	'textarea',
	'select',
	'option',
	'video',
	'audio',
	'svg',
	'path',
	'circle',
	'ellipse',
	'rect',
	'line',
	'polyline',
	'polygon',
	// svg text + grouping: pure drawing primitives with no URL or script
	// surface (a chart wheel, a badge, a stat ring)
	'text',
	'tspan',
	'g'
]);

const ALLOWED_PROPS = new Set([
	'style',
	'className',
	'class',
	'href',
	'target',
	'rel',
	'src',
	'alt',
	'title',
	'width',
	'height',
	'type',
	'placeholder',
	'value',
	'checked',
	'disabled',
	// form-field props: a NAMED field inside a component root is what the
	// trusted ttAction click wrapper reads into the run inputs
	// (useTtActionClicks) — inert markup otherwise, no URL or JS sink
	'name',
	'min',
	'max',
	'step',
	'maxLength',
	'required',
	'readOnly',
	'htmlFor',
	'selected',
	'autoComplete',
	'inputMode',
	'pattern',
	'role',
	'aria-label',
	'aria-hidden',
	'rows',
	'cols',
	'controls',
	'loop',
	'muted',
	'poster',
	'viewBox',
	'fill',
	'stroke',
	'strokeWidth',
	'strokeLinecap',
	'strokeLinejoin',
	'd',
	'cx',
	'cy',
	'r',
	'x',
	'y',
	'x1',
	'y1',
	'x2',
	'y2',
	'rx',
	'ry',
	'points',
	'xmlns',
	'transform',
	'opacity',
	'fillOpacity',
	'strokeOpacity',
	'strokeDasharray',
	'textAnchor',
	'dominantBaseline',
	'fontSize',
	'fontWeight',
	'fontFamily',
	'letterSpacing',
	'dx',
	'dy',
	// the ONLY data-* attributes allowed through: the component ttAction
	// binding (componentTemplate.ts) — inert markup that a trusted-surface
	// click wrapper reads to run an action AS the viewer. Values are plain
	// strings (an action key/id and a JSON inputs blob); no URL or JS sink.
	'data-tt-action',
	'data-tt-action-inputs'
]);

const VOID_TAGS = new Set(['img', 'input', 'br', 'hr']);

const MAX_NODES = 600;
const MAX_DEPTH = 24;

const sanitizeStyle = (style: unknown): React.CSSProperties | undefined => {
	if (!style || typeof style !== 'object' || Array.isArray(style)) return undefined;

	const out: Record<string, string | number> = {};
	Object.entries(style as Record<string, unknown>).forEach(([key, value]) => {
		if (typeof value !== 'string' && typeof value !== 'number') return;
		// block css escape hatches (url(javascript:…), expression(), imports)
		if (!isSafeCssText(value)) return;
		out[key] = value as string | number;
	});
	return out;
};

const sanitizeProps = (props: unknown): Record<string, unknown> => {
	if (!props || typeof props !== 'object' || Array.isArray(props)) return {};

	const out: Record<string, unknown> = {};
	Object.entries(props as Record<string, unknown>).forEach(([key, value]) => {
		// no event handlers, no dangerouslySetInnerHTML, whitelist only
		if (isEventHandlerProp(key)) return;
		if (!ALLOWED_PROPS.has(key)) return;

		if (key === 'style') {
			const style = sanitizeStyle(value);
			if (style) out.style = style;
			return;
		}
		if (key === 'class') {
			if (typeof value === 'string') out.className = value;
			return;
		}
		if ((key === 'href' || key === 'src' || key === 'poster') && typeof value === 'string') {
			if (!isSafeUrl(value)) return;
			out[key] = value;
			return;
		}
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
			out[key] = value;
		}
	});

	// external links never keep the opener
	applyNoOpener(out);

	return out;
};

// Form fields render UNCONTROLLED: a template's `value` / `checked` becomes
// the field's initial value so people can actually type into it (a React
// `value` without onChange is read-only), and the click wrapper reads the
// live DOM value by `name` when a control fires. `option` keeps `value` —
// that is the option's submit value, not a field state.
const FIELD_TAGS = new Set(['input', 'textarea', 'select']);

const fieldProps = (tag: string, props: Record<string, unknown>): Record<string, unknown> => {
	if (!FIELD_TAGS.has(tag)) return props;
	const out: Record<string, unknown> = { ...props };
	if ('value' in out) {
		out.defaultValue = out.value;
		delete out.value;
	}
	if ('checked' in out) {
		out.defaultChecked = out.checked === true || out.checked === 'true' || out.checked === 'checked';
		delete out.checked;
	}
	return out;
};

export type HtmlThingNode =
	| string
	| number
	| {
			tag?: string;
			props?: Record<string, unknown>;
			children?: HtmlThingNode[] | HtmlThingNode;
	  };

type RenderState = { count: number };

const renderNode = (node: HtmlThingNode, key: number, depth: number, state: RenderState): React.ReactNode => {
	if (state.count >= MAX_NODES || depth > MAX_DEPTH) return null;
	state.count++;

	if (typeof node === 'string' || typeof node === 'number') {
		return node;
	}

	if (!node || typeof node !== 'object' || Array.isArray(node)) return null;

	const tag = String(node.tag || 'div').toLowerCase();
	if (!ALLOWED_TAGS.has(tag)) {
		// unknown tag: render children in a plain span so content still shows
		return (
			<span key={key}>{renderChildren(node.children, depth + 1, state)}</span>
		);
	}

	const props = fieldProps(tag, sanitizeProps(node.props));

	if (VOID_TAGS.has(tag)) {
		return React.createElement(tag, { ...props, key });
	}

	return React.createElement(tag, { ...props, key }, renderChildren(node.children, depth + 1, state));
};

const renderChildren = (children: HtmlThingNode[] | HtmlThingNode | undefined, depth: number, state: RenderState): React.ReactNode => {
	if (children === undefined || children === null) return null;
	const list = Array.isArray(children) ? children : [children];
	return list.map((child, idx) => renderNode(child, idx, depth, state));
};

export const HtmlThingRenderer = ({ node }: { node: HtmlThingNode }) => {
	const state: RenderState = { count: 0 };
	return <>{renderNode(node, 0, 0, state)}</>;
};
