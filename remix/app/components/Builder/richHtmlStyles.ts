import { EDITOR_JS_HEADING_FONT_SIZES } from '../Editor/editorJsValue';

// Typography for rendered rich-text/html block content. Chakra's global reset
// deliberately makes native h1-h6/ul/ol/blockquote render UNSTYLED (headings
// inherit body size), so sanitised markup from the Editor.js path looked like
// plain text. This sx restores a real document scale — heading sizes match
// the Editor.js editing scale exactly, so what you type is what renders.
export const RICH_HTML_SX: Record<string, unknown> = {
	'& h1, & h2, & h3, & h4, & h5, & h6': {
		fontFamily: 'var(--tt-font-heading, system-ui, sans-serif)',
		fontWeight: 800,
		letterSpacing: '-0.02em',
		lineHeight: 1.25,
		color: 'var(--tt-ink, #16161a)',
		margin: '0.6em 0 0.3em'
	},
	'& h1': { fontSize: EDITOR_JS_HEADING_FONT_SIZES[1] },
	'& h2': { fontSize: EDITOR_JS_HEADING_FONT_SIZES[2] },
	'& h3': { fontSize: EDITOR_JS_HEADING_FONT_SIZES[3] },
	'& h4': { fontSize: EDITOR_JS_HEADING_FONT_SIZES[4] },
	'& h5': { fontSize: EDITOR_JS_HEADING_FONT_SIZES[5] },
	'& h6': { fontSize: EDITOR_JS_HEADING_FONT_SIZES[6] },
	'& > *:first-child': { marginTop: 0 },
	'& > *:last-child': { marginBottom: 0 },
	'& p': { margin: '0.35em 0' },
	'& ul, & ol': { paddingLeft: '1.5em', margin: '0.4em 0' },
	'& ul': { listStyleType: 'disc' },
	'& ol': { listStyleType: 'decimal' },
	'& li': { margin: '0.15em 0' },
	'& blockquote': {
		borderLeft: '3px solid var(--tt-border, #ececef)',
		paddingLeft: '12px',
		margin: '0.5em 0',
		color: 'var(--tt-text, #5a5a66)'
	},
	'& blockquote footer': { fontSize: '12px', color: 'var(--tt-muted, #9a9aa6)', marginTop: '4px' },
	'& pre': {
		fontFamily: 'var(--tt-font-mono, ui-monospace, monospace)',
		fontSize: '13px',
		background: 'var(--tt-surface, #fafafb)',
		border: '1px solid var(--tt-border, #ececef)',
		borderRadius: 'var(--tt-radius-md, 12px)',
		padding: '12px',
		overflowX: 'auto',
		margin: '0.5em 0',
		whiteSpace: 'pre-wrap'
	},
	'& code': { fontFamily: 'var(--tt-font-mono, ui-monospace, monospace)', fontSize: '0.9em' },
	'& hr': { border: 0, borderTop: '1px solid var(--tt-border, #ececef)', margin: '1em 0' },
	'& table': { borderCollapse: 'collapse', width: '100%', margin: '0.5em 0' },
	'& th, & td': { border: '1px solid var(--tt-border, #ececef)', padding: '6px 10px', textAlign: 'left' },
	'& th': { background: 'var(--tt-surface, #fafafb)', fontWeight: 700 },
	'& img': { maxWidth: '100%', borderRadius: 'var(--tt-radius-md, 12px)' },
	'& figcaption': { fontSize: '12px', color: 'var(--tt-muted, #9a9aa6)', marginTop: '4px' },
	'& a': { color: 'var(--tt-link, #2f8fd6)', textDecoration: 'underline' },
	'& b, & strong': { fontWeight: 700 },
	'& mark': { background: '#fff3b0', padding: '0 2px', borderRadius: '3px' }
};
