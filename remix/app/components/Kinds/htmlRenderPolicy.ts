// Shared by the browser renderer and server-side authored-markup discovery.
// Unknown tags render only their children; dropped markup containers never do.
export const HTML_ALLOWED_TAGS = new Set([
	'tt-web-platform',
	'tt-media-pipeline',
	'progress',
	'output',
	'tt-service-workspace',
	'tt-style',
	'tt-collection',
	'tt-drag',
	'tt-change',
	'tt-drop',
	'tt-form',
	'tt-rich-text',
	'tt-menu',
	'tt-select',
	'tt-map',
	'tt-mapbox',
	'tt-media',
	'tt-pdf',
	'tt-pdf-page',
	'tt-attachments',
	'tt-discussion',
	'dl',
	'dt',
	'dd',
	'tt-dialog',
	'tt-countdown',
	'dialog',
	'details',
	'summary',
	'tt-upload',
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
	'text',
	'tspan',
	'g'
]);
export const HTML_MARKUP_DROP_TAGS = new Set([
	'script',
	'style',
	'iframe',
	'object',
	'embed',
	'link',
	'meta',
	'base',
	'form',
	'noscript',
	'template'
]);
export const HTML_VOID_TAGS = new Set(['img', 'input', 'br', 'hr']);
export const HTML_MAX_NODES = 600;
export const HTML_MAX_DEPTH = 24;

export const ALLOWED_PROPS = new Set([
	'style',
	'id',
	'lang',
	'dir',
	'role',
	'accept',
	'hidden',
	'download',
	'preload',
	'playsInline',
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
	'aria-label',
	'aria-live',
	'aria-atomic',
	'aria-valuenow',
	'aria-valuemin',
	'aria-valuemax',
	'aria-valuetext',
	'aria-hidden',
	'aria-pressed',
	'aria-checked',
	'aria-busy',
	'aria-disabled',
	'aria-expanded',
	'aria-selected',
	'aria-current',
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
	'data-tt-pdf',
	'data-tt-pdf-value',
	'data-tt-action-inputs',
	// Inert composition slots adopted only by the trusted authored menu.
	'data-tt-menu-slot',
	'data-tt-menu-trigger',
	'data-tt-input-type',
	// Inert names; only an explicit private-controls host supplies live values.
	'data-tt-private-control',
	'data-tt-private-text',
	// Inert editor address, validated against the authored template before editing.
	'data-tt-label-key'
]);

// These standard attributes express local element semantics. Attributes
// controlling document execution, form submission, fetching or a second
// media source remain outside this list.
const passiveGlobal = new Set([
 'tabIndex', 'spellCheck', 'translate', 'draggable', 'inert', 'enterKeyHint', 'autoCapitalize',
 'itemProp', 'itemScope', 'itemType', 'itemId', 'itemRef', 'part'
]);
const passiveByTag: Record<string, readonly string[]> = {
 a: ['hrefLang'],
 img: ['loading', 'decoding', 'fetchPriority'],
 input: ['minLength', 'multiple', 'size'],
 textarea: ['minLength', 'wrap'],
 select: ['multiple', 'size'],
 ol: ['reversed', 'start'],
 th: ['colSpan', 'rowSpan', 'abbr', 'headers', 'scope'],
 td: ['colSpan', 'rowSpan', 'headers'],
 video: ['disablePictureInPicture', 'disableRemotePlayback'],
 audio: ['disableRemotePlayback'],
 details: ['name']
};
export function allowsAuthoredHtmlAttribute(name: string, tag?: string): boolean {
 const scoped = tag && Object.prototype.hasOwnProperty.call(passiveByTag, tag) ? passiveByTag[tag] : undefined;
 return ALLOWED_PROPS.has(name) || passiveGlobal.has(name) || !!scoped?.includes(name) ||
  /^aria-[a-z][a-z0-9-]*$/.test(name) || /^data-user-[a-z0-9][a-z0-9_.:-]*$/.test(name);
}

const htmlToReact: Record<string, string> = {
 'class': 'className', 'for': 'htmlFor', maxlength: 'maxLength', readonly: 'readOnly',
 autocomplete: 'autoComplete', inputmode: 'inputMode', playsinline: 'playsInline', fetchpriority: 'fetchPriority',
 tabindex: 'tabIndex', spellcheck: 'spellCheck', enterkeyhint: 'enterKeyHint', autocapitalize: 'autoCapitalize',
 itemprop: 'itemProp', itemscope: 'itemScope', itemtype: 'itemType', itemid: 'itemId', itemref: 'itemRef',
 hreflang: 'hrefLang', minlength: 'minLength', colspan: 'colSpan', rowspan: 'rowSpan',
 disablepictureinpicture: 'disablePictureInPicture', disableremoteplayback: 'disableRemotePlayback'
};
export const authoredHtmlPropName = (name: string) => Object.prototype.hasOwnProperty.call(htmlToReact, name) ? htmlToReact[name] : name;
export function authoredHtmlAttributeName(prop: string): string {
 return Object.entries(htmlToReact).find(([, value]) => value === prop)?.[0] ?? prop;
}

const booleanProps = new Set([
 'checked', 'disabled', 'hidden', 'required', 'readOnly', 'selected', 'open', 'controls', 'loop',
 'muted', 'playsInline', 'inert', 'itemScope', 'multiple', 'reversed', 'disablePictureInPicture', 'disableRemotePlayback'
]);
export function authoredHtmlPropValue(name: string, value: string): string | boolean {
 if (!booleanProps.has(name) || (name === 'hidden' && value === 'until-found') || /^\{[^{}]+\}$/.test(value)) return value;
 return !['false', '0'].includes(value.toLowerCase());
}
