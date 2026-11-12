import { ACTION_BATCH_ATTRIBUTE } from '../Actions/actionBatches';
import { MODIFIER_ACTION_INPUTS } from '../Actions/localUiAction';
import LocalMediaPipeline from '../../webPlatform/LocalMediaPipeline';
import { isPngThumbnail } from '../../utils/pngThumbnail';
import { ComponentChange } from '../Builder/ComponentChange';
import { ComponentMenu } from '../Builder/ComponentMenu';
import { ComponentRichText } from '../Builder/ComponentRichText';
import { ComponentSelect } from '../Builder/ComponentSelect';
import { ComponentStyle } from '../Builder/ComponentStyle';
import { ComponentCollection } from '../Builder/ComponentCollection';
import { ComponentDragSource, ComponentDropTarget } from '../Builder/ComponentDrag';
import { Link, useInRouterContext, useLocation } from 'react-router';
import { useWebpageRuntime } from '../Builder/webpageRuntime';
import { componentPageHref, componentNavigationState } from '../Builder/componentNavigation';
import { ComponentAttachments, ComponentMedia } from '../Builder/ComponentAttachments';
import { ComponentDiscussion } from '../Builder/ComponentDiscussion';
import { ComponentMap } from '../Builder/ComponentMap';
import { ComponentMapbox } from '../Builder/Maps/ComponentMapbox';
import { ComponentDialog, ComponentForm, ComponentCountdown, NativeControlsEnabled, ComponentDisplayOnly } from '../Builder/NativeComponentControls';
import { ComponentUpload } from '../Builder/ComponentUpload';
import { useContentExecutionHeld } from '../Builder/ContentExecutionHold';
import React from 'react';
import { HtmlTemplateField } from './HtmlTemplateField';
import { HtmlMultipleSelect, HtmlSelectOption } from './HtmlMultipleSelect';
import { mapStyleMediaUrls } from '../Sharing/renderMediaCore';
import { useSharedMediaUrl } from '../Sharing/SharedMedia';
import {
	HTML_ALLOWED_TAGS as ALLOWED_TAGS,
	HTML_VOID_TAGS as VOID_TAGS,
	HTML_MAX_NODES as MAX_NODES,
	HTML_MAX_DEPTH as MAX_DEPTH
} from './htmlRenderPolicy';

import { applyNoOpener, isEventHandlerProp, isSafeCssText, isSafeUrl } from './safeUrl';
import { allowsAuthoredHtmlAttribute, authoredHtmlPropValue } from './htmlRenderPolicy';



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
export { ALLOWED_PROPS } from './htmlRenderPolicy';

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

const sanitizeProps = (props: unknown, tag?: string): Record<string, unknown> => {
	if (!props || typeof props !== 'object' || Array.isArray(props)) return {};

	const out: Record<string, unknown> = {};
	const attributes = props as Record<string, unknown>;
	const multiple = tag === 'select' && (attributes.multiple === true ||
		(typeof attributes.multiple === 'string' && authoredHtmlPropValue('multiple', attributes.multiple) === true));
	Object.entries(attributes).forEach(([key, value]) => {
		// no event handlers, no dangerouslySetInnerHTML, whitelist only
		if (isEventHandlerProp(key)) return;
		// Structured Action descriptors use a button-only serializer, separate
		// from the ordinary HTML attribute policy and free-form inspector.
		if (key === MODIFIER_ACTION_INPUTS || key === ACTION_BATCH_ATTRIBUTE) {
			if (tag === 'button' && value && typeof value === 'object' && !Array.isArray(value)) out[key] = JSON.stringify(value);
			return;
		}
		if (!allowsAuthoredHtmlAttribute(key, tag)) return;
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
			if (!isSafeUrl(value) && !(tag === 'img' && key === 'src' && isPngThumbnail(value))) return;
			out[key] = value;
			return;
		}
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
			out[key] = typeof value === 'string' ? authoredHtmlPropValue(key, value) : value;
		} else if (multiple && key === 'value' && Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
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
	if (tag === 'select' && out.multiple === true) {
		// A typed array is an authored default. String query bindings stay
		// authoritative and can explicitly clear an edited filter.
		if (Array.isArray(out.value)) {
			out.defaultValue = out.value;
			delete out.value;
		}
		return out;
	}
	// Local bindings are controlled by LiveTemplate's bounded instance state.
	// Keep the DOM in sync after another control changes a value or resets it.
	if (out.type === 'file') { delete out.value; delete out.defaultValue; return out; }
 if (out['data-tt-action'] === '$ui' || (out['data-tt-action'] === '$transient' && ('value' in out || 'checked' in out))) {
  return { ...out, ...('checked' in out ? { checked: out.checked === true || out.checked === 'true' || out.checked === 'checked' } : { value: out.value ?? '' }), onChange: () => {} };
 }
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

type RenderState = { displayOnly?: boolean; count: number; mediaUrl: (url: string) => string };

function ComponentLink({ href, children, ...props }: Record<string, any>) {
	const inRouter = useInRouterContext();
	if (inRouter && typeof href === 'string' && /^(?:\/(?!\/)|[?#])/.test(href) && !href.startsWith('/api/') && !props.download)
		return <RoutedComponentLink {...props} href={href}>{children}</RoutedComponentLink>;
	return (
		<a {...props} href={href}>
			{children}
		</a>
	);
}

function RoutedComponentLink({ href, children, ...props }: Record<string, any>) {
	const location = useLocation();
	const { pageId } = useWebpageRuntime();
	const to = componentPageHref(pageId, location, href);
	return <Link {...props} to={to} state={componentNavigationState(pageId, location, to)}>{children}</Link>;
}

const renderNode = (node: HtmlThingNode, key: number, depth: number, state: RenderState): React.ReactNode => {
	if (state.count >= MAX_NODES || depth > MAX_DEPTH) return null;
	state.count++;

	if (typeof node === 'string' || typeof node === 'number') {
		return node;
	}

	if (!node || typeof node !== 'object' || Array.isArray(node)) return null;

	const tag = String(node.tag || 'div').toLowerCase();
	if (tag === 'tt-media-pipeline') return <LocalMediaPipeline key={key} pipeline={node.props?.pipeline}>{renderChildren(node.children, depth + 1, state)}</LocalMediaPipeline>;
	if (tag === 'tt-web-platform' && state.displayOnly) return <p key={key}>Web Platform programs are available on the interactive page.</p>;
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
	if (tag === 'tt-discussion') return <ComponentDiscussion key={key} {...node.props} />;
	if (tag === 'tt-collection') return <ComponentCollection key={key} {...node.props} />;
	if (tag === 'tt-change') return <ComponentChange key={key} {...node.props}>{renderChildren(node.children, depth + 1, state)}</ComponentChange>;
	if (tag === 'tt-menu') return <ComponentMenu key={key} {...node.props} triggerContent={node.props?.triggerContent === undefined ? undefined : renderChildren(node.props.triggerContent, depth + 1, state)}>{renderChildren(node.children, depth + 1, state)}</ComponentMenu>;
	if (tag === 'tt-drag') return <ComponentDragSource key={key} {...node.props}>{renderChildren(node.children, depth + 1, state)}</ComponentDragSource>;
	if (tag === 'tt-drop') return <ComponentDropTarget key={key} {...node.props}>{renderChildren(node.children, depth + 1, state)}</ComponentDropTarget>;
	if (tag === 'tt-style')
		return (
			<ComponentStyle key={key} rules={node.props?.rules}>
				{renderChildren(node.children, depth + 1, state)}
			</ComponentStyle>
		);
	if (tag === 'tt-media') return <ComponentMedia key={key} {...node.props} />;
	if (tag === 'tt-select') return <ComponentSelect key={key} {...node.props} />;
	if (tag === 'tt-rich-text') return <ComponentRichText key={key} {...node.props} />;
	if (tag === 'tt-map') return <ComponentMap key={key} {...node.props} />;
	if (tag === 'tt-mapbox') return <ComponentMapbox key={key} {...node.props} />;
	if (tag === 'tt-form')
		return (
			<ComponentForm
				key={key}
				identityName={node.props?.identityName}
				identity={node.props?.identity}
				revisionName={node.props?.revisionName}
				revision={node.props?.revision}
				resetKey={node.props?.resetKey}
				completion={node.props?.completion}
				completionState={node.props?.completionState}
				disabled={node.props?.disabled}
			>
				{renderChildren(node.children, depth + 1, state)}
			</ComponentForm>
		);
	if (tag === 'tt-countdown') return <ComponentCountdown key={key} value={node.props?.value} />;
	if (tag === 'tt-dialog')
		return (
			<ComponentDialog key={key} {...node.props} triggerContent={node.props?.triggerContent === undefined ? undefined : renderChildren(node.props.triggerContent, depth + 1, state)} closeContent={node.props?.closeContent === undefined ? undefined : renderChildren(node.props.closeContent, depth + 1, state)}>
				{renderChildren(node.children, depth + 1, state)}
			</ComponentDialog>
		);
	if (tag === 'tt-upload')
		return (
			<ComponentUpload
				key={key}
				name={node.props?.name}
				imageOnly={node.props?.imageOnly}
				disabled={node.props?.disabled}
				title={node.props?.title}
				value={node.props?.value}
				attachmentId={node.props?.attachmentId}
			/>
		);
	if (!ALLOWED_TAGS.has(tag)) {
		// unknown tag: render children in a plain span so content still shows
		return <span key={key}>{renderChildren(node.children, depth + 1, state)}</span>;
	}

	const props = fieldProps(tag, sanitizeProps(node.props, tag));
	if (state.displayOnly) { delete props['data-tt-action']; delete props['data-tt-action-inputs']; delete props[MODIFIER_ACTION_INPUTS]; delete props[ACTION_BATCH_ATTRIBUTE]; }
	if (props.style) props.style = mapStyleMediaUrls(props.style, state.mediaUrl);
	for (const field of ['src', 'poster', 'href']) if (typeof props[field] === 'string') props[field] = state.mediaUrl(props[field]) || undefined;
	if (tag === 'option') return <HtmlSelectOption key={key} props={props}>{renderChildren(node.children, depth + 1, state)}</HtmlSelectOption>;
	if (tag === 'select' && props.multiple) return <HtmlMultipleSelect key={key} props={props}>{renderChildren(node.children, depth + 1, state)}</HtmlMultipleSelect>;

	if (tag === 'textarea') {
		// React forbids textarea children whenever a value/defaultValue exists,
		// even an empty array. Legacy text children become an initial value.
		if (!('value' in props) && !('defaultValue' in props)) {
			const children = Array.isArray(node.children) ? node.children : [node.children];
			props.defaultValue = children.filter((value) => typeof value === 'string' || typeof value === 'number').join('');
		}
		return <HtmlTemplateField key={key} tag={tag} fieldProps={props} />;
	}
	if (FIELD_TAGS.has(tag) && props['data-tt-action'] !== '$ui') {
		return <HtmlTemplateField key={key} tag={tag as 'input' | 'select'} fieldProps={props}>{tag === 'input' ? undefined : renderChildren(node.children, depth + 1, state)}</HtmlTemplateField>;
	}
	if (tag === 'a')
		return (
			<ComponentLink key={key} {...props}>
				{renderChildren(node.children, depth + 1, state)}
			</ComponentLink>
		);
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
	const held = useContentExecutionHeld();
	const state: RenderState = { count: 0, mediaUrl: useSharedMediaUrl(), displayOnly: React.useContext(ComponentDisplayOnly) || held };
	return <>{renderNode(node, 0, 0, state)}</>;
};

// Authored images may keep a local fallback while a source loads or fails.
// The fallback is a static same-origin asset: it does not carry user data or
// expand the shared-media dependency graph to a second arbitrary source URL.
function HtmlBlockImage({ elementProps, fallback }: { elementProps: Record<string, any>; fallback: string }) {
 const [ready, setReady] = React.useState(false);
 const [failed, setFailed] = React.useState(false);
 const src = !failed && typeof elementProps.src === 'string' ? elementProps.src : undefined;
 return <img {...elementProps} src={src || fallback} alt={typeof elementProps.alt === 'string' ? elementProps.alt : ''} referrerPolicy="no-referrer"
  loading={elementProps.loading === 'eager' ? 'eager' : 'lazy'}
  decoding={elementProps.decoding === 'sync' || elementProps.decoding === 'auto' ? elementProps.decoding : 'async'}
  style={{ ...elementProps.style, ...(!ready && src && { background: `center / contain no-repeat url("${fallback}")`, color: 'transparent' }) }}
  onLoad={() => setReady(true)} onError={() => setFailed(true)} />;
}

/** Individual Builder elements share the exact HTML allowlist and URL policy. */
export function HtmlBlockElement({ tag, attributes, editorProps, children, markerContent }: {
 tag: string; attributes?: Record<string, unknown>; editorProps?: Record<string, any>; children?: React.ReactNode; markerContent?: React.ReactNode;
}) {
 const mediaUrl = useSharedMediaUrl();
 if (tag === 'tt-media-pipeline') return <LocalMediaPipeline pipeline={attributes?.pipeline} editorProps={editorProps}>{children}</LocalMediaPipeline>;
 if (tag === 'tt-mapbox') return <div {...editorProps}><ComponentMapbox {...attributes} markerContent={markerContent} /></div>;
 if (tag === 'tt-upload') return <div {...editorProps}><ComponentUpload {...attributes} /></div>;
 if (tag === 'tt-style') return <div {...editorProps}><ComponentStyle rules={attributes?.rules}>{children}</ComponentStyle></div>;
 if (tag === 'tt-form') return <div {...editorProps}><ComponentForm {...attributes}>{children}</ComponentForm></div>;
 if (tag === 'tt-select') return <div {...editorProps}><ComponentSelect {...attributes} /></div>;
 if (tag === 'tt-rich-text') return <div {...editorProps}><ComponentRichText {...attributes} /></div>;
 if (tag === 'tt-menu') return <div {...editorProps}><ComponentMenu {...attributes}>{children}</ComponentMenu></div>;
 if (tag === 'tt-change') return <span {...editorProps}><ComponentChange {...attributes}>{children}</ComponentChange></span>;
 const safeTag = ALLOWED_TAGS.has(tag) && !tag.startsWith('tt-') ? tag : 'div';
 const props = fieldProps(safeTag, sanitizeProps(attributes, safeTag));
 if (props.style) props.style = mapStyleMediaUrls(props.style, mediaUrl);
 for (const key of ['src', 'poster', 'href']) if (typeof props[key] === 'string') props[key] = mediaUrl(props[key]);
 const merged = { ...props, ...editorProps, style: { ...(props.style as React.CSSProperties), ...editorProps?.style } };
 if (safeTag === 'option') return <HtmlSelectOption props={merged}>{children}</HtmlSelectOption>;
 if (safeTag === 'select' && props.multiple) return <HtmlMultipleSelect props={merged} editing={!!editorProps?.onClick}>{children}</HtmlMultipleSelect>;
 if (FIELD_TAGS.has(safeTag)) return <HtmlTemplateField tag={safeTag as 'input' | 'textarea' | 'select'} fieldProps={merged}>{safeTag === 'select' ? children : undefined}</HtmlTemplateField>;
 if (safeTag === 'a') return <ComponentLink {...merged}>{children}</ComponentLink>;
 const fallback = attributes?.['data-tt-image-fallback'];
 if (safeTag === 'img' && typeof fallback === 'string' && /^\/[a-zA-Z0-9_/-]+\.(?:png|svg|webp)$/.test(fallback) && !fallback.startsWith('//')) {
  return <HtmlBlockImage key={String(props.src ?? '')} elementProps={merged} fallback={fallback} />;
 }
 return React.createElement(safeTag, merged, VOID_TAGS.has(safeTag) ? undefined : children);
}
