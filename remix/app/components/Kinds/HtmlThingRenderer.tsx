import { ComponentSelect } from '../Builder/ComponentSelect';
import { Link, useInRouterContext } from 'react-router';
import { ComponentAttachments, ComponentMedia } from '../Builder/ComponentAttachments';
import { ComponentMap } from '../Builder/ComponentMap';
import { ComponentDialog, ComponentForm, ComponentCountdown, NativeControlsEnabled } from '../Builder/NativeComponentControls';
import { ComponentUpload } from '../Builder/ComponentUpload';
import React from 'react';
import { HtmlTemplateField } from './HtmlTemplateField';
import { mapStyleMediaUrls } from '../Sharing/renderMediaCore';
import { useSharedMediaUrl } from '../Sharing/SharedMedia';
import { HTML_ALLOWED_TAGS as ALLOWED_TAGS, HTML_VOID_TAGS as VOID_TAGS, HTML_MAX_NODES as MAX_NODES, HTML_MAX_DEPTH as MAX_DEPTH } from './htmlRenderPolicy';

import { applyNoOpener, isEventHandlerProp, isSafeCssText, isSafeUrl } from './safeUrl';

const WebPlatformSurface = React.lazy(() => import('../../webPlatform/WebPlatformSurface'));

const ServiceWorkspace = React.lazy(() => import('../Builder/ServiceWorkspace/ServiceWorkspace'));

// Native workspace controls touch persisted account data. Inert component and
// Thing previews must neither mount their data loader nor offer those controls.
// Interactive shared pages remain available to their authorized staff members.
// Live page surfaces (LiveTemplate for components, the html block view for
// authored markup) provide NativeControlsEnabled; nothing else should.
export function InteractiveWorkspace({ name, children }: { name?: string; children: React.ReactNode }) {
	const interactive = React.useContext(NativeControlsEnabled);
	if (interactive) return <>{children}</>;
	return (
		<div
			role="note"
			style={{
				display: 'grid',
				gap: 4,
				padding: '16px 18px',
				border: '1px dashed var(--tt-border, #ececef)',
				borderRadius: 'var(--tt-radius-md, 12px)',
				color: 'var(--tt-muted, #5a5a66)',
				fontSize: 14,
				lineHeight: 1.45
			}}
		>
			<strong style={{ color: 'var(--tt-ink, #16161a)' }}>🌿 {name || 'Service workspace'}</strong>
			<span>This service workspace runs on the live page. Open the page (View or Visit) to use it — previews keep it inert.</span>
		</div>
	);
}


// JSON → DOM renderer: lets people build their own html/css components as
// plain JSON things (stored in Mongo like any other thing) and render them
// live. A node is either a string (text) or:
//   { tag: 'div', props: { style: {…}, href, src, … }, children: [node, …] }
//
// Because the page is *data*, the same sanitisation gate that protects pasted
// JSON protects rendered pages: only whitelisted tags/props render, styles are
// object-form only, URLs are checked, and event handlers never pass through.

// Exported so the allowlist itself carries a regression test: every entry is a
// decision about what untrusted markup may hand the browser, and a prop added
// back by habit should fail a test rather than ship.
export const ALLOWED_PROPS = new Set([
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
	// accessibility labelling: inert strings the browser only ever exposes to
	// assistive tech — no URL, no JS sink, no validation engine
	'role',
	'aria-label',
	'aria-hidden',
	'aria-pressed',
	'aria-expanded',
	'aria-selected',
	'open',
	// NOT `pattern`. Every other constraint-validation prop above is a cheap
	// numeric/boolean compare, but `pattern` is a REGEX the browser compiles
	// and runs from untrusted markup, on the main thread, with no timeout.
	// Constraint validation runs as soon as a field has a non-empty value —
	// and `fieldProps` below turns a template's `value` into `defaultValue`,
	// so a component thing can ship both halves — which makes
	// `<input value="aaaaaaaaaaaaaaaaaaaaaaaaaaX" pattern="(a+)+$">` a wedged
	// tab for anyone who merely renders that component. Nothing in the
	// library uses it, the run inputs are validated server-side by the action
	// input descriptors (type/min/max/maxLength/enum) rather than by the
	// field's own validity, and a client-side hint is not worth an
	// author-supplied regex engine.
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
	'data-tt-action-inputs',
	// Inert editor address, validated against the authored template before editing.
	'data-tt-label-key'
]);

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
	// Local bindings are controlled by LiveTemplate's bounded instance state.
	// Keep the DOM in sync after another control changes a value or resets it.
	if (out['data-tt-action'] === '$ui') return { ...out, value: out.value ?? '', onChange: () => {} };
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

type RenderState = { count: number; mediaUrl: (url: string) => string };

function ComponentLink({ href, children, ...props }: Record<string, any>) {
 const inRouter = useInRouterContext();
 if (inRouter && typeof href === 'string' && /^\/(?!\/)/.test(href) && !href.startsWith('/api/') && !props.download) return <Link {...props} to={href}>{children}</Link>;
 return <a {...props} href={href}>{children}</a>;
}

const renderNode = (node: HtmlThingNode, key: number, depth: number, state: RenderState): React.ReactNode => {
	if (state.count >= MAX_NODES || depth > MAX_DEPTH) return null;
	state.count++;

	if (typeof node === 'string' || typeof node === 'number') {
		return node;
	}

	if (!node || typeof node !== 'object' || Array.isArray(node)) return null;

	const tag = String(node.tag || 'div').toLowerCase();
	if (tag === 'tt-web-platform') return <React.Suspense key={key} fallback={<p>Web Platform program</p>}><WebPlatformSurface program={node.props?.program} name={node.props?.name} /></React.Suspense>;
	if (tag === 'tt-service-workspace') {
		const name = typeof node.props?.name === 'string' ? node.props.name : undefined;
		return (
			<InteractiveWorkspace key={key} name={name}>
				<React.Suspense fallback={<div aria-busy="true">Opening workspace…</div>}>
					<ServiceWorkspace rootId={node.props?.rootId ?? node.props?.rootid} name={name} />
				</React.Suspense>
			</InteractiveWorkspace>
		);
	}
	if (tag === 'tt-attachments') return <ComponentAttachments key={key} {...node.props} />;
	if (tag === 'tt-media') return <ComponentMedia key={key} {...node.props} />;
	if (tag === 'tt-select') return <ComponentSelect key={key} {...node.props} />;
	if (tag === 'tt-map') return <ComponentMap key={key} {...node.props} />;
	if (tag === 'tt-form') return <ComponentForm key={key} identityName={node.props?.identityName} identity={node.props?.identity} revisionName={node.props?.revisionName} revision={node.props?.revision} resetKey={node.props?.resetKey}>{renderChildren(node.children, depth + 1, state)}</ComponentForm>;
	if (tag === 'tt-countdown') return <ComponentCountdown key={key} value={node.props?.value} />;
	if (tag === 'tt-dialog') return <ComponentDialog key={key} title={node.props?.title} name={node.props?.name} type={node.props?.type}>{renderChildren(node.children, depth + 1, state)}</ComponentDialog>;
	if (tag === 'tt-upload') return <ComponentUpload key={key} name={node.props?.name} imageOnly={node.props?.imageOnly} disabled={node.props?.disabled} title={node.props?.title} value={node.props?.value} attachmentId={node.props?.attachmentId} />;
	if (!ALLOWED_TAGS.has(tag)) {
		// unknown tag: render children in a plain span so content still shows
		return (
			<span key={key}>{renderChildren(node.children, depth + 1, state)}</span>
		);
	}

	const props = fieldProps(tag, sanitizeProps(node.props));
	if (props.style) props.style = mapStyleMediaUrls(props.style, state.mediaUrl);
	for (const field of ['src', 'poster', 'href']) if (typeof props[field] === 'string') props[field] = state.mediaUrl(props[field]);

	if (tag === 'textarea') {
		// React forbids textarea children whenever a value/defaultValue exists,
		// even an empty array. Legacy text children become an initial value.
		if (!('value' in props) && !('defaultValue' in props)) {
			const children = Array.isArray(node.children) ? node.children : [node.children];
			props.defaultValue = children.filter(value => typeof value === 'string' || typeof value === 'number').join('');
		}
		return <HtmlTemplateField key={key} tag={tag} fieldProps={props} />;
	}
	if (FIELD_TAGS.has(tag) && props['data-tt-action'] !== '$ui') {
		return <HtmlTemplateField key={key} tag={tag as 'input' | 'select'} fieldProps={props}>{tag === 'input' ? undefined : renderChildren(node.children, depth + 1, state)}</HtmlTemplateField>;
	}
	if (tag === 'a') return <ComponentLink key={key} {...props}>{renderChildren(node.children,depth+1,state)}</ComponentLink>;
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
	const state: RenderState = { count: 0, mediaUrl: useSharedMediaUrl() };
	return <>{renderNode(node, 0, 0, state)}</>;
};
