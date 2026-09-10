// Shared by the browser renderer and server-side authored-markup discovery.
// Unknown tags render only their children; dropped markup containers never do.
export const HTML_ALLOWED_TAGS = new Set([
	'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'img', 'button',
	'ul', 'ol', 'li', 'section', 'article', 'header', 'footer', 'nav', 'aside', 'main',
	'strong', 'em', 'small', 'b', 'i', 'u', 's', 'mark', 'sub', 'sup', 'code', 'pre',
	'blockquote', 'hr', 'br', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure',
	'figcaption', 'label', 'fieldset', 'legend', 'input', 'textarea', 'select', 'option',
	'video', 'audio', 'svg', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline',
	'polygon', 'text', 'tspan', 'g'
]);
export const HTML_MARKUP_DROP_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'noscript', 'template']);
export const HTML_VOID_TAGS = new Set(['img', 'input', 'br', 'hr']);
export const HTML_MAX_NODES = 600;
export const HTML_MAX_DEPTH = 24;
