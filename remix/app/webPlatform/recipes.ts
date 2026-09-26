import { eventApiRecipe } from './eventFixtures';
import { streamApiRecipe } from './streamFixtures';
import { controllerApiRecipe } from './controllerFixtures';
import { parameter, base, recipe } from './programBuilders';
import { javascriptRecipe } from './javascriptRecipes';
import { workerApiRecipe } from './webApiFixtures';
import { domApiRecipe } from './domFixtures';
import { htmlFormRecipe } from './htmlFormFixtures';
import { liveFormRecipe } from './liveFormFixtures';
import { webIdlRecipe } from './webIdlFixtures';
import { webIdlStreamRecipe } from './webIdlStreamFixtures';
import type { Feature, PlatformNode, Recipe } from './types';
const node = (tag: string, children: PlatformNode[] = [], attributes: Record<string, string | number | boolean> = {}): PlatformNode => ({
	tag,
	attributes,
	children
});
const panel = (children: PlatformNode[]) => [node('section', children, { id: 'sample', class: 'sample' })];
const fixture = () =>
	panel([
		node('h2', ['Build something lovely']),
		node('p', ['CSS changes layout, typography and painting. Resize this preview and edit the value.'], { class: 'text' }),
		node('div', [node('span', ['One'], { class: 'item' }), node('span', ['Two'], { class: 'item' }), node('span', ['Three'], { class: 'item' })], {
			class: 'items'
		}),
		node('button', ['Try focus and hover'], { type: 'button' }),
		node('input', [], { placeholder: 'Type here', 'aria-label': 'Sample input' })
	]);
const baseStyles = [
	{ selector: '.sample', declarations: { padding: '18px', border: '1px solid #d4d4d8', 'border-radius': '12px' } },
	{ selector: '.items', declarations: { display: 'flex', gap: '8px', 'flex-wrap': 'wrap' } },
	{ selector: '.item', declarations: { padding: '12px', background: '#eee', 'border-radius': '6px' } }
];
const cssDefaults: Record<string, string> = {
	display: 'grid',
	color: 'rebeccapurple',
	background: 'linear-gradient(120deg, #dbeafe, #fce7f3)',
	'background-color': 'lavender',
	width: '75%',
	height: '200px',
	padding: '24px',
	margin: '16px',
	gap: '16px',
	opacity: '0.55',
	transform: 'rotate(-3deg)',
	rotate: '-3deg',
	scale: '0.9',
	translate: '12px 8px',
	filter: 'hue-rotate(90deg)',
	border: '3px dashed rebeccapurple',
	'border-radius': '24px',
	'box-shadow': '0 8px 24px #0003',
	'font-size': '24px',
	'font-weight': '800',
	'font-family': 'monospace',
	'line-height': '2',
	'letter-spacing': '0.1em',
	'text-align': 'center',
	'text-decoration': 'underline wavy rebeccapurple',
	'text-transform': 'uppercase',
	'text-wrap': 'balance',
	'word-spacing': '0.8em',
	'grid-template-columns': 'repeat(3, 1fr)',
	'grid-template-rows': '80px 100px',
	'grid-auto-flow': 'column',
	'grid-column': 'span 2',
	'flex-direction': 'column',
	'justify-content': 'space-between',
	'align-items': 'center',
	'aspect-ratio': '16 / 9',
	'writing-mode': 'vertical-rl',
	'column-count': '2',
	'column-gap': '2rem',
	'column-rule': '1px solid rebeccapurple',
	outline: '3px solid teal',
	'outline-offset': '8px',
	overflow: 'auto',
	position: 'relative',
	left: '20px',
	'list-style-type': 'upper-roman',
	cursor: 'crosshair',
	'clip-path': 'inset(4% round 30px)',
	'mix-blend-mode': 'multiply',
	'backdrop-filter': 'blur(4px)',
	'container-type': 'inline-size',
	'content-visibility': 'auto',
	'scroll-snap-type': 'x mandatory',
	'scroll-behavior': 'smooth',
	animation: 'pulse 2s infinite alternate',
	transition: 'all 500ms ease',
	'accent-color': 'rebeccapurple',
	appearance: 'none',
	resize: 'both',
	'white-space': 'pre-wrap',
	direction: 'rtl',
	'unicode-bidi': 'bidi-override',
	perspective: '400px',
	'user-select': 'all',
	'pointer-events': 'none',
	'touch-action': 'pan-y',
	content: '"Generated content"',
	float: 'left',
	'shape-outside': 'circle(50%)',
	'shape-margin': '12px'
};
function htmlRecipe(f: Feature): Recipe {
	const p = base(f);
	if (f.kind === 'element') {
		const tag = f.name;
		p.parameters = [parameter('text', 'Content', 'Hello from Thingtime')];
		p.probe = { kind: 'element', name: tag };
		const special: Record<string, PlatformNode[]> = {
			details: [node('details', [node('summary', ['Open this disclosure']), node('p', ['[[text]]'])])],
			summary: [node('details', [node('summary', ['[[text]]']), node('p', ['Disclosure content'])])],
			dialog: [
				node('button', ['Open dialog'], { id: 'open' }),
				node('dialog', [node('p', ['[[text]]']), node('button', ['Close'], { id: 'close' })], { id: 'sample' })
			],
			input: [node('label', ['Try the input', node('input', [], { type: '[[type]]', value: '[[text]]', id: 'sample' })])],
			textarea: [node('textarea', ['[[text]]'], { rows: 4, id: 'sample', 'aria-label': 'Try editing this text' })],
			select: [node('select', [node('option', ['One']), node('option', ['Two']), node('option', ['Three'])], { 'aria-label': 'Choose an option' })],
			option: [node('select', [node('option', ['[[text]]']), node('option', ['Another choice'])], { 'aria-label': 'Choose an option' })],
			optgroup: [
				node('select', [node('optgroup', [node('option', ['First']), node('option', ['Second'])], { label: '[[text]]' })], {
					'aria-label': 'Choose an option'
				})
			],
			progress: [node('progress', [], { value: '[[value]]', max: 100 }), node('p', ['[[value]] / 100'])],
			meter: [node('meter', [], { value: '[[value]]', min: 0, max: 100, low: 30, high: 70, optimum: 50 }), node('p', ['[[value]] / 100'])],
			datalist: [
				node('input', [], { list: 'options', placeholder: 'Start typing', 'aria-label': 'Autocomplete demo' }),
				node(
					'datalist',
					[node('option', [], { value: 'Apple' }), node('option', [], { value: 'Apricot' }), node('option', [], { value: 'Banana' })],
					{ id: 'options' }
				)
			],
			form: [
				node('form', [
					node('label', ['Required name ', node('input', [], { name: 'name', required: true })]),
					node('button', ['Validate'], { type: 'submit' })
				])
			],
			output: [node('output', ['[[text]]'])],
			table: [
				node('table', [
					node('caption', ['[[text]]']),
					node('thead', [node('tr', [node('th', ['Feature']), node('th', ['Value'])])]),
					node('tbody', [node('tr', [node('td', ['Editable']), node('td', ['Yes'])])])
				])
			],
			ul: [node('ul', [node('li', ['[[text]]']), node('li', ['Second item'])])],
			ol: [node('ol', [node('li', ['[[text]]']), node('li', ['Second item'])])],
			li: [node('ul', [node('li', ['[[text]]']), node('li', ['Another item'])])],
			dl: [node('dl', [node('dt', ['Thing']), node('dd', ['[[text]]'])])],
			dt: [node('dl', [node('dt', ['[[text]]']), node('dd', ['Definition'])])],
			dd: [node('dl', [node('dt', ['Term']), node('dd', ['[[text]]'])])],
			ruby: [node('ruby', ['漢', node('rp', ['(']), node('rt', ['kan']), node('rp', [')'])])],
			rt: [node('ruby', ['漢', node('rt', ['[[text]]'])])],
			rp: [node('ruby', ['漢', node('rp', ['(']), node('rt', ['kan']), node('rp', [')'])])],
			fieldset: [node('fieldset', [node('legend', ['[[text]]']), node('label', ['Name ', node('input')])])],
			legend: [node('fieldset', [node('legend', ['[[text]]']), node('input')])],
			figure: [node('figure', [node('div', ['◇'], { style: 'font-size:64px' }), node('figcaption', ['[[text]]'])])],
			figcaption: [node('figure', [node('div', ['◇'], { style: 'font-size:64px' }), node('figcaption', ['[[text]]'])])],
			a: [node('a', ['[[text]]'], { href: '#target' }), node('p', ['Anchor destination'], { id: 'target' })],
			img: [
				node('img', [], {
					alt: '[[text]]',
					src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
					width: 120,
					height: 80,
					style: 'background:linear-gradient(135deg,#dbeafe,#fce7f3)'
				})
			],
			button: [node('button', ['[[text]]'], { id: 'sample', type: 'button' })],
			abbr: [node('abbr', ['HTML'], { title: '[[text]]' })],
			time: [node('time', ['[[text]]'], { datetime: '2026-09-23' })],
			data: [node('data', ['[[text]]'], { value: '42' })],
			bdo: [node('bdo', ['[[text]]'], { dir: 'rtl' })],
			canvas: [node('canvas', ['Fallback: [[text]]'], { width: 280, height: 160, style: 'border:1px solid #ddd' })],
			template: [node('p', ['Template content is inert until cloned. Inspect the HTMLTemplateElement API.'])]
		};
		if (['html', 'head', 'title', 'base', 'link', 'meta', 'style', 'script', 'iframe', 'embed', 'object', 'noscript'].includes(tag))
			return recipe(
				{
					...p,
					document: [
						node('p', [
							`The ${tag} element changes document infrastructure. Its interface can be inspected here; using it needs the corresponding isolated document capability.`
						])
					],
					probe: {
						kind: 'interface',
						name: (
							{
								html: 'HTMLHtmlElement',
								head: 'HTMLHeadElement',
								title: 'HTMLTitleElement',
								base: 'HTMLBaseElement',
								link: 'HTMLLinkElement',
								meta: 'HTMLMetaElement',
								style: 'HTMLStyleElement',
								script: 'HTMLScriptElement',
								iframe: 'HTMLIFrameElement',
								embed: 'HTMLEmbedElement',
								object: 'HTMLObjectElement',
								noscript: 'HTMLElement'
							} as Record<string, string>
						)[tag]
					}
				},
				'requires-context',
				'Document, embedding and script capabilities are isolated from your account.'
			);
		p.document = special[tag] || [node(tag, ['[[text]]'], { id: 'sample' })];
		if (tag === 'form') p.allowFormEvents = true;
		if (['caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col'].includes(tag)) {
			p.document = [
				node('table', [
					node('caption', ['Table context']),
					...(tag === 'colgroup' || tag === 'col' ? [node('colgroup', [node('col', [], { style: 'background:lavender' })])] : []),
					node('tbody', [node('tr', [node('th', ['Header']), node('td', ['[[text]]'])])])
				])
			];
		}
		if (tag === 'input') p.parameters.push(parameter('type', 'Input type', 'text'));
		if (tag === 'meter' || tag === 'progress') p.parameters = [parameter('value', 'Value (0–100)', 60, 'number')];
		if (tag === 'dialog')
			p.dom = [
				{ target: '#sample', event: '#open|click', method: 'showModal' },
				{ target: '#sample', event: '#close|click', method: 'close' }
			];
		if (['audio', 'video', 'source', 'track', 'picture', 'canvas', 'template'].includes(tag))
			return recipe(p, 'requires-context', 'This element needs media, a rendering context or template cloning to demonstrate its full behavior.');
		return recipe(p);
	}
	if (f.kind === 'attribute') {
		const name = f.name;
		const tag = f.group.split(/[;, ]/).find((x) => /^[a-z]+$/.test(x) && !['HTML', 'elements', 'All', 'all'].includes(x)) || 'div';
		if (/^on/.test(name))
			return recipe(
				{ ...p, document: [node('button', ['Try this event'], { id: 'sample' })], probe: { kind: 'interface', name: 'Event' } },
				'requires-context',
				'Use declarative event bindings instead of executable attribute strings.'
			);
		if (
			[
				'src',
				'srcset',
				'href',
				'action',
				'formaction',
				'srcdoc',
				'is',
				'nonce',
				'ping',
				'poster',
				'data',
				'http-equiv',
				'autofocus',
				'pattern'
			].includes(name)
		)
			return recipe(
				{ ...p, probe: { kind: 'interface', name: 'HTMLElement' } },
				'requires-context',
				'This attribute needs a resource or browsing-context capability.'
			);
		p.parameters = [
			parameter(
				'value',
				'Attribute value',
				(
					{
						contenteditable: 'true',
						dir: 'rtl',
						lang: 'en',
						title: 'Hover to read this title',
						hidden: '',
						draggable: 'true',
						tabindex: '0',
						type: 'range',
						min: '0',
						max: '100',
						value: '50',
						placeholder: 'Type here',
						required: '',
						disabled: '',
						readonly: '',
						popover: 'auto',
						style: 'color:rebeccapurple',
						class: 'selected'
					} as Record<string, string>
				)[name] ?? 'example'
			)
		];
		p.document = [
			node(['script', 'iframe', 'link', 'meta', 'base', 'object', 'embed', 'style'].includes(tag) ? 'div' : tag, ['Example element'], {
				id: 'sample',
				[name]: '[[value]]'
			})
		];
		p.probe = { kind: 'attribute', name, target: '#sample' };
		if (name === 'popover') {
			p.document = [node('button', ['Toggle popover'], { id: 'open' }), node('div', ['A real popover'], { id: 'sample', popover: '[[value]]' })];
			p.dom = [{ target: '#sample', event: '#open|click', method: 'togglePopover' }];
		}
		return recipe(p);
	}
	return recipe(
		{ ...p, document: [node('button', ['Interact with this control'], { id: 'sample' })], probe: { kind: 'interface', name: 'Event' } },
		'inspection',
		'Inspect the event interface. An event-specific trigger is not yet configured.'
	);
}
function cssRecipe(f: Feature): Recipe {
	const p = base(f);
	p.document = fixture();
	p.styles = [...baseStyles];
	if (f.kind === 'property') {
		const candidate = cssDefaults[f.name] || f.initial || f.syntax?.split(/\s*\|\s*/).find((v) => /^[a-z][a-z-]*$/.test(v)) || 'initial';
		p.parameters = [parameter('value', `${f.name} value`, candidate)];
		p.styles.push({ selector: '#sample', declarations: { [f.name]: '[[value]]' } });
		p.probe = { kind: 'css', name: f.name, value: '[[value]]' };
		if (f.name.startsWith('grid-')) p.styles.push({ selector: '#sample', declarations: { display: 'grid' } });
		if (f.name.startsWith('flex') || ['align-items', 'justify-content'].includes(f.name))
			p.styles.push({ selector: '#sample', declarations: { display: 'flex' } });
		if (f.name === 'animation')
			p.styles.push({ rule: '@keyframes pulse { from { opacity: 0.3; transform:scale(0.95) } to { opacity:1; transform:scale(1) } }' });
		return recipe(
			p,
			'interactive',
			'Apply any value; compare browser syntax support with the computed result. Some properties require a specific layout, media or output context.'
		);
	}
	if (f.kind === 'selector') {
		const selector = f.name.includes('(') ? f.name.replace(/\([^)]*\)/, '(.item)') : f.name;
		p.parameters = [parameter('selector', 'Selector', selector.startsWith(':') ? `#sample ${selector}` : selector)];
		p.styles.push({ rule: '[[selector]] { color: rebeccapurple; outline: 2px solid rebeccapurple; }' });
		p.probe = { kind: 'selector', name: '[[selector]]' };
		return recipe(p);
	}
	const rules: Record<string, string> = {
		'@media': '@media (min-width: 300px) { #sample { background: lavender } }',
		'@supports': '@supports (display:grid) { .items { display:grid; grid-template-columns:1fr 1fr } }',
		'@container': '#sample {container-type:inline-size} @container (min-width:250px) { .items {display:grid;grid-template-columns:1fr 1fr} }',
		'@layer': '@layer foundation, overrides; @layer foundation {#sample {color:teal}} @layer overrides {#sample {color:rebeccapurple}}',
		'@keyframes': '@keyframes pulse {to {opacity:0.3}} #sample {animation:pulse 1s infinite alternate}',
		'@scope': '@scope (#sample) { p {color:rebeccapurple} }',
		'@property': '@property --accent { syntax:"<color>"; inherits:false; initial-value:teal; } #sample {--accent:rebeccapurple;color:var(--accent)}',
		'@starting-style': '#sample {transition:opacity 2s} @starting-style {#sample {opacity:0}}',
		'@counter-style': '@counter-style stars {system:cyclic; symbols:"★"; suffix:" ";} .items{display:list-item;list-style:stars}'
	};
	if (f.kind === 'at-rule' && rules[f.name]) {
		p.parameters = [parameter('rule', 'Rule', rules[f.name])];
		p.styles.push({ rule: '[[rule]]' });
		return recipe(p);
	}
	const values: Record<string, [string, string]> = {
		'calc()': ['width', 'calc(100% - 30px)'],
		'min()': ['width', 'min(90%, 350px)'],
		'max()': ['padding', 'max(8px, 2vw)'],
		'clamp()': ['font-size', 'clamp(14px, 5vw, 30px)'],
		'var()': ['color', 'var(--accent, rebeccapurple)'],
		'rgb()': ['color', 'rgb(100 50 200 / 0.8)'],
		'hsl()': ['color', 'hsl(270 70% 45%)'],
		'hwb()': ['color', 'hwb(270 20% 10%)'],
		'lab()': ['color', 'lab(50% 30 -40)'],
		'lch()': ['color', 'lch(50% 60 280)'],
		'oklab()': ['color', 'oklab(60% 0.1 -0.1)'],
		'oklch()': ['color', 'oklch(65% 0.2 300)'],
		'color()': ['color', 'color(display-p3 0.4 0.2 0.9)'],
		'color-mix()': ['color', 'color-mix(in oklch, rebeccapurple 60%, teal)'],
		'linear-gradient()': ['background', 'linear-gradient(120deg, lavender, pink)'],
		'radial-gradient()': ['background', 'radial-gradient(circle, lavender, pink)'],
		'conic-gradient()': ['background', 'conic-gradient(lavender, pink, lavender)'],
		'translate()': ['transform', 'translate(20px, 10px)'],
		'rotate()': ['transform', 'rotate(4deg)'],
		'scale()': ['transform', 'scale(0.9)'],
		'blur()': ['filter', 'blur(1px)'],
		'circle()': ['clip-path', 'circle(45%)'],
		'inset()': ['clip-path', 'inset(4% round 20px)'],
		'repeat()': ['grid-template-columns', 'repeat(3, 1fr)'],
		'minmax()': ['grid-template-columns', 'repeat(2, minmax(80px, 1fr))']
	};
	if (values[f.name]) {
		const [property, value] = values[f.name];
		p.parameters = [parameter('value', 'Value', value)];
		p.styles.push({ selector: '#sample', declarations: { [property]: '[[value]]', ...(property.startsWith('grid') ? { display: 'grid' } : {}) } });
		p.probe = { kind: 'css', name: property, value: '[[value]]' };
		return recipe(p);
	}
	p.parameters = [
		parameter('property', 'Property to test', 'color'),
		parameter('value', 'Value to test', f.initial || 'rebeccapurple'),
		parameter('rule', 'Stylesheet rule', f.kind === 'at-rule' ? `${f.name} { }` : '#sample { color: rebeccapurple; }')
	];
	p.styles.push({ rule: '[[rule]]' });
	return recipe(
		p,
		'inspection',
		'This grammar term is indexed. Supply a concrete rule/value in its required context; a feature-specific worked example is still needed.'
	);
}

function webApiRecipe(f: Feature): Recipe {
	const worked =
		webIdlRecipe(f) ||
		webIdlStreamRecipe(f) ||
		liveFormRecipe(f) ||
		htmlFormRecipe(f) ||
		domApiRecipe(f) ||
		eventApiRecipe(f) ||
		streamApiRecipe(f) ||
		controllerApiRecipe(f) ||
		workerApiRecipe(f);
	if (worked) return worked;
	const p = base(f),
		name = f.interface || f.name;
	return recipe(
		{ ...p, probe: { kind: 'interface', name: f.member && f.kind !== 'constructor' ? `${name}${f.static ? '' : '.prototype'}.${f.member}` : name } },
		'requires-context',
		'Inspect availability in an isolated document. A full demo of this API needs its receiver, lifecycle, resource or permission context; browser globals are not automatically called.'
	);
}

export function featureRecipe(feature: Feature): Recipe {
	if (feature.language === 'html') return htmlRecipe(feature);
	if (feature.language === 'css') return cssRecipe(feature);
	if (feature.language === 'javascript') return javascriptRecipe(feature);
	return webApiRecipe(feature);
}
