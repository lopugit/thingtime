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
	'input',
	'textarea',
	'select',
	'option',
	'video',
	'audio',
	'svg',
	'path',
	'circle',
	'rect',
	'line',
	'polyline',
	'polygon'
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

	const props = sanitizeProps(node.props);

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
