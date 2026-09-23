// Authoring helpers only: styles are serialized into each saved Component.
// The runtime never imports the original workspace or this preset.
import { serviceWorkspaceStyles } from '../components/Builder/ServiceWorkspace/serviceWorkspaceStyles';
import { collectionStyles } from '../components/Collections/collectionStyles';
import type { ComponentStyleRule } from '../components/Builder/componentStyleRules';

type Json = any;
export const node = (tag: string, children: Json[] = [], props: Json = {}): Json => ({ tag, props, children });
const extra = `
.service-workspace {border:0;border-radius:0;margin:0;max-width:none;overflow:visible}
.service-workspace .sw-nav a {display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:36px;padding:8px 10px;border:1px solid transparent;border-radius:9px;font-size:13px;font-weight:500;text-decoration:none;color:var(--sw-muted)}
.service-workspace .sw-nav a[aria-current="page"] {background:#eaf1e7;color:var(--sw-green);font-weight:650}
.service-workspace .sw-link-button {display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:36px;padding:7px 12px;border:1px solid var(--sw-line);border-radius:9px;background:#fff;color:var(--sw-ink);font-size:13px;font-weight:600;text-decoration:none}
.service-workspace a.sw-primary {background:var(--sw-green);color:#fff;border-color:var(--sw-green);padding:10px 16px}
.service-workspace a.sw-record-main {display:flex;align-items:center;text-decoration:none;color:var(--sw-ink);font-weight:600}
.service-workspace .sw-stats a {display:flex;flex-direction:column;align-items:flex-start;padding:18px;font-weight:500}
.service-workspace .sw-record-menu summary {list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border:1px solid var(--sw-line);border-radius:9px}
.service-workspace .sw-record-menu {position:relative;flex-shrink:0}
.service-workspace .sw-record-menu[open] {align-self:flex-start}
.service-workspace .sw-record-menu nav {display:flex;flex-direction:column;gap:6px;padding:8px;background:#fff;border:1px solid var(--sw-line);border-radius:9px;min-width:130px}
.service-workspace .sw-record-menu nav a {font-size:13px;text-decoration:none;padding:4px}
.service-workspace .sw-form-grid {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.service-workspace.sw-modal {max-width:620px !important;width:calc(100% - 24px) !important;margin:24px auto;padding:20px 24px 24px;max-height:calc(100dvh - 48px) !important;overflow:auto !important;border:1px solid var(--sw-line);border-radius:12px}
.service-workspace.sw-modal::backdrop {background:rgba(0,0,0,.45)}
.service-workspace .sw-form textarea {min-height:100px}
.service-workspace .sw-detail-fields dt {display:block;font-size:11px;color:var(--sw-muted);margin-bottom:4px}
.service-workspace .sw-detail-fields dd {font-size:14px;font-weight:500;overflow-wrap:anywhere;white-space:pre-wrap}
.service-workspace .tt-collection-sr {display:none}
.service-workspace a.sw-card-open {display:flex;text-decoration:none;color:var(--sw-ink)}
.service-workspace [data-drop-active] {outline:2px solid var(--sw-green);outline-offset:2px}
.service-workspace .sw-day a.sw-add-day {width:100%;margin-top:auto;background:transparent;border-style:dashed;color:var(--sw-muted)}
@media(max-width:650px){
.service-workspace .sw-nav a {font-size:11px;padding:7px 8px;gap:5px;flex:1 0 auto}
.service-workspace .sw-stats a {padding:15px}
.service-workspace .sw-form-grid {grid-template-columns:minmax(0,1fr)}
}
`;
function parse(source: string, maxWidth?: number): ComponentStyleRule[] {
	const rules: ComponentStyleRule[] = [];
	let cursor = 0;
	while (cursor < source.length) {
		const brace = source.indexOf('{', cursor);
		if (brace < 0) break;
		const selector = source.slice(cursor, brace).trim();
		let depth = 1,
			end = brace + 1;
		while (end < source.length && depth) {
			if (source[end] === '{') depth++;
			if (source[end] === '}') depth--;
			end++;
		}
		const body = source.slice(brace + 1, end - 1);
		const media = /^@media\s*\(max-width:\s*(\d+)px\)$/.exec(selector);
		if (media) rules.push(...parse(body, Number(media[1])));
		else if (!selector.startsWith('@'))
			rules.push({
				selector,
				declarations: Object.fromEntries(
					body
						.split(';')
						.filter((value) => value.includes(':'))
						.map((value) => {
							const split = value.indexOf(':');
							return [value.slice(0, split).trim(), value.slice(split + 1).trim()];
						})
				),
				...(maxWidth ? { maxWidth } : {})
			});
		cursor = end;
	}
	return rules;
}
const rules = parse(serviceWorkspaceStyles + collectionStyles + extra).map((rule) => ({
	...rule,
	declarations: Object.fromEntries(
		Object.entries(rule.declarations).map(([key, value]) => [key, key.startsWith('--sw-') ? `var(--app-${key.slice(5)}, ${value})` : value])
	)
}));
export function styledApp(content: Json): Json {
	// Preserve authored layout as editable scoped rules, not inline styles
	// which would otherwise beat the inherited app theme and CSS cascade.
	const instanceRules: ComponentStyleRule[] = [];
	const styles = new Map<string, string>();
	const unitless = new Set(['opacity', 'fontWeight', 'lineHeight', 'flex', 'flexGrow', 'flexShrink', 'order', 'gridRow', 'gridColumn']);
	const theme: Record<string, string> = { '#fff': 'var(--app-surface, #fff)', '#cbd5cd': 'var(--sw-line)', '#dce5df': 'var(--sw-line)' };
	const visit = (value: Json): Json => {
		if (Array.isArray(value)) return value.map(visit);
		if (!value || typeof value !== 'object') return value;
		const next = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)])) as Json;
		if (next.tag && next.props?.style && Object.values(next.props.style).every((entry) => ['string', 'number'].includes(typeof entry))) {
			const signature = JSON.stringify(next.props.style);
			let className = styles.get(signature);
			if (!className) {
				className = `sw-authored-${styles.size}`;
				styles.set(signature, className);
				instanceRules.push({
					selector: `.service-workspace .${className}`,
					declarations: Object.fromEntries(
						Object.entries(next.props.style).map(([key, entry]) => {
							const cssKey = key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());
							const cssValue =
								typeof entry === 'number'
									? `${entry}${entry && !unitless.has(key) ? 'px' : ''}`
									: String(entry).replace(/#fff\b|#cbd5cd\b|#dce5df\b/g, (color) => theme[color]);
							return [cssKey, cssValue];
						})
					)
				});
			}
			next.props.className = [next.props.className, className].filter(Boolean).join(' ');
			delete next.props.style;
		}
		return next;
	};
	content = visit(content);
	const serialized = JSON.stringify(content);
	const classes = new Set([...Array.from(serialized.match(/(?:sw|tt-collection)[a-z-]*/g) || []), 'service-workspace']);
	// Collections and avatar variants add DOM classes at render time. Include
	// their saved style rules even though those classes are not in the template.
	if (serialized.includes('tt-collection')) for (const name of collectionStyles.match(/tt-collection[a-z-]*/g) || []) classes.add(name);
	if (serialized.includes('sw-planner-')) for (const name of ['sw-planner-day', 'sw-planner-week']) classes.add(name);
	if (serialized.includes('sw-avatar-')) for (const kind of ['address', 'equipment', 'customer']) classes.add(`sw-avatar-${kind}`);
	const selected = rules.flatMap((rule) => {
		const selector = rule.selector
			.split(',')
			.filter((part) => [...part.matchAll(/\.([a-z][a-z-]+)/g)].every((match) => classes.has(match[1])))
			.join(',');
		return selector ? [{ ...rule, selector }] : [];
	});
	return node('tt-style', [content], { rules: [...selected, ...instanceRules] });
}
export function icon(name: string, size = 17): Json {
	const paths: Record<string, string[]> = {
		leaf: ['M11 20A8 8 0 0 1 9.8 4.1C16.5 3 18 2.5 20 2c1 2 1.7 4.5 1 8-1 6-4.5 10-10 10Z', 'M2 22c0-6 5-12 12-14'],
		overview: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
		planner: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M3 5h18v16H3z', 'M8 14h.01', 'M12 14h.01', 'M16 14h.01', 'M8 18h.01', 'M12 18h.01'],
		customer: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M16 3a4 4 0 0 1 0 8', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0'],
		address: ['M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z', 'M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
		job: ['M9 4H5v18h14V4h-4', 'M9 2h6v4H9z', 'M9 12h6', 'M9 16h6'],
		equipment: ['M14.7 6.3a5.5 5.5 0 0 0-7 7L2 19l3 3 5.7-5.7a5.5 5.5 0 0 0 7-7L14 13l-3-3Z'],
		maps: ['m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z', 'M9 3v15', 'M15 6v15'],
		member: ['M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z', 'm9 12 2 2 4-4'],
		setup: [
			'M4 5h4',
			'M12 5h8',
			'M4 12h10',
			'M18 12h2',
			'M4 19h2',
			'M10 19h10',
			'M12 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
			'M18 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
			'M10 19a2 2 0 1 1-4 0 2 2 0 0 1 4 0'
		],
		trash: ['M3 6h18', 'M5 6l1 16h12l1-16', 'M9 6V2h6v4', 'M10 10v8', 'M14 10v8'],
		refresh: ['M20 7A8 8 0 0 0 6 4L3 7', 'M3 2v5h5', 'M4 17a8 8 0 0 0 14 3l3-3', 'M16 17h5v5'],
		plus: ['M12 5v14', 'M5 12h14']
	};
	return node(
		'svg',
		(paths[name] || paths.job).map((d) => node('path', [], { d })),
		{
			width: size,
			height: size,
			viewBox: '0 0 24 24',
			fill: 'none',
			stroke: 'currentColor',
			strokeWidth: 2,
			strokeLinecap: 'round',
			strokeLinejoin: 'round',
			'aria-hidden': 'true'
		}
	);
}
