import type { Feature, PlatformNode, PlatformProgram, Recipe } from './types';
const node = (tag: string, children: PlatformNode[] = [], attributes: Record<string, string | number | boolean> = {}): PlatformNode => ({
	tag,
	attributes,
	children
});
const parameter = (name: string, label: string, value: unknown, type: 'text' | 'number' | 'boolean' | 'json' = 'text') => ({
	name,
	label,
	type,
	default: value
});
const global = (name: string) => ({ op: 'global', name });
const input = (name: string) => ({ op: 'input', name });
const literal = (value: unknown) => ({ op: 'literal', value });
const get = (target: unknown, key: string) => ({ op: 'get', target, key });
const method = (target: unknown, key: string, args: unknown[] = []) => ({ op: 'method', target, key, args });
const make = (name: string, args: unknown[] = []) => ({ op: 'new', target: global(name), args });
const returns = (value: unknown) => [{ op: 'return', value }];
const base = (f: Feature): PlatformProgram => ({
	version: 1,
	title: f.name.slice(0, 200),
	description: f.description || `${f.kind} from ${f.group}.`
});
const recipe = (
	program: PlatformProgram,
	coverage: Recipe['coverage'] = 'interactive',
	note = 'Edit the inputs and run the real browser implementation.'
): Recipe => ({ program, coverage, note });
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
function javascriptRecipe(f: Feature): Recipe {
	const p = base(f),
		name = f.name
			.replace(/^get |^set /, '')
			.split(' (')[0]
			.trim();
	const parts = name.split('.');
	if (
		f.kind === 'built-in' &&
		parts.length >= 2 &&
		!['[', ']', '%', ' '].some((char) => name.includes(char)) &&
		parts.every((v) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(v))
	) {
		const root = parts[0],
			member = parts.at(-1)!;
		if (['constructor', '__proto__'].includes(member) || ['Function', 'AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction'].includes(root))
			return recipe(
				{
					...p,
					steps: returns({ op: 'unary', operator: 'typeof', value: { op: 'function', params: ['value'], value: { op: 'variable', name: 'value' } } })
				},
				'inspection',
				'Functions are reusable declarative function nodes. Executable source strings are not accepted.'
			);
		let target: any = global(root);
		const prototype = parts[1] === 'prototype';
		const receivers: Record<string, unknown> = {
			Array: [3, 1, 4, 1, 5],
			String: 'Hello Thingtime 🌈',
			Number: 123.456,
			Boolean: true,
			Object: { hello: 'world', count: 3 },
			BigInt: '123',
			Date: '2026-09-23T12:00:00Z',
			RegExp: '[a-z]+',
			Map: [
				['one', 1],
				['two', 2]
			],
			Set: [1, 2, 3],
			Uint8Array: [1, 2, 3, 255],
			Int8Array: [1, 2, 3],
			Int16Array: [1, 2, 3],
			Uint16Array: [1, 2, 3],
			Int32Array: [1, 2, 3],
			Uint32Array: [1, 2, 3],
			Float32Array: [1, 2, 3],
			Float64Array: [1, 2, 3],
			ArrayBuffer: 8,
			SharedArrayBuffer: 8
		};
		p.parameters = [];
		if (prototype) {
			if (!(root in receivers))
				return recipe(
					{ ...p, steps: returns({ op: 'unary', operator: 'typeof', value: get(get(global(root), 'prototype'), member) }) },
					'requires-context',
					'This method needs a suitable receiver. Edit the declarative program to construct one.'
				);
			p.parameters.push(
				parameter(
					'receiver',
					'Receiver',
					receivers[root],
					['String', 'Date', 'RegExp', 'BigInt'].includes(root) ? 'text' : typeof receivers[root] === 'number' ? 'number' : 'json'
				)
			);
			if (['Array', 'String', 'Number', 'Boolean', 'Object'].includes(root)) target = input('receiver');
			else if (root === 'BigInt') target = { op: 'call', target: global('BigInt'), args: [input('receiver')] };
			else target = make(root, [input('receiver')]);
		} else for (const part of parts.slice(1, -1)) target = get(target, part);
		const callable = /\(/.test(f.name);
		if (!callable) {
			p.steps = returns(get(target, member));
			return recipe(p);
		}
		let args: unknown[] = [];
		let values: unknown[] = [];
		const callbackMethods = [
			'map',
			'filter',
			'find',
			'findIndex',
			'findLast',
			'findLastIndex',
			'some',
			'every',
			'forEach',
			'flatMap',
			'reduce',
			'reduceRight',
			'sort',
			'toSorted'
		];
		if (prototype && root === 'Array' && callbackMethods.includes(member)) {
			const reduce = member.startsWith('reduce');
			const compare = ['sort', 'toSorted'].includes(member);
			const fn = {
				op: 'function',
				params: reduce || compare ? ['a', 'b'] : ['value'],
				value: {
					op: 'binary',
					operator: reduce
						? '+'
						: compare
						? '-'
						: ['filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'some', 'every'].includes(member)
						? '>'
						: '*',
					left: { op: 'variable', name: reduce || compare ? 'a' : 'value' },
					right: reduce || compare ? { op: 'variable', name: 'b' } : 2
				}
			};
			args = reduce ? [fn, 0] : [fn];
		} else {
			const samples: Record<string, unknown[]> = {
				at: [1],
				concat: [[6, 7]],
				copyWithin: [0, 2],
				fill: [9, 1, 3],
				flat: [1],
				includes: [root === 'String' ? 'Thingtime' : 3],
				indexOf: [root === 'String' ? 'Thingtime' : 1],
				lastIndexOf: [1],
				join: [' · '],
				slice: [1, 4],
				splice: [1, 1, 9],
				toSpliced: [1, 1, 9],
				with: [1, 9],
				push: [9],
				unshift: [9],
				split: [' '],
				replace: ['Thingtime', 'Builder'],
				replaceAll: ['l', 'L'],
				startsWith: ['Hello'],
				endsWith: ['🌈'],
				padStart: [24, '·'],
				padEnd: [24, '·'],
				repeat: [2],
				substring: [0, 5],
				charAt: [1],
				charCodeAt: [1],
				codePointAt: [16],
				normalize: ['NFC'],
				match: ['[A-Z][a-z]+'],
				matchAll: ['[a-z]+'],
				search: ['Thingtime'],
				localeCompare: ['Hello'],
				toFixed: [2],
				toPrecision: [4],
				toExponential: [2],
				toString: root === 'Number' ? [16] : [],
				test: ['hello'],
				exec: ['hello'],
				get: ['one'],
				set: ['three', 3],
				has: [root === 'Map' ? 'one' : 2],
				add: [4],
				delete: [root === 'Map' ? 'one' : 2],
				from: [[1, 2, 3]],
				of: [1, 2, 3],
				isArray: [[1, 2]],
				keys: [{ one: 1, two: 2 }],
				values: [{ one: 1, two: 2 }],
				entries: [{ one: 1, two: 2 }],
				fromEntries: [
					[
						['one', 1],
						['two', 2]
					]
				],
				assign: [{ one: 1 }, { two: 2 }],
				groupBy: [[1, 2, 3]],
				parse: ['{"hello":"Thingtime"}'],
				stringify: [{ hello: 'Thingtime', count: 3 }],
				parseInt: ['42', 10],
				parseFloat: ['3.14'],
				isFinite: [42],
				isNaN: [42],
				isInteger: [42],
				isSafeInteger: [42],
				abs: [-42],
				ceil: [3.14],
				floor: [3.14],
				round: [3.6],
				trunc: [3.14],
				sign: [-42],
				sqrt: [16],
				cbrt: [27],
				pow: [2, 8],
				max: [1, 5, 3],
				min: [1, 5, 3],
				hypot: [3, 4],
				imul: [3, 4],
				atan2: [1, 1],
				clz32: [1],
				fround: [1.337]
			};
			values = Object.prototype.hasOwnProperty.call(samples, member)
				? samples[member]
				: /^(sin|cos|tan|a?cos|a?sin|a?tan|log|exp|sinh|cosh|tanh)/.test(member)
				? [0.5]
				: [];
			if (prototype && ['keys', 'values', 'entries'].includes(member)) values = [];
			p.parameters.push(parameter('arguments', 'Arguments (JSON array)', values, 'json'));
			args = [{ op: 'spread', value: input('arguments') }];
		}
		let result: any = method(target, member, args);
		if (['entries', 'keys', 'values', 'matchAll'].includes(member) && prototype) result = method(global('Array'), 'from', [result]);
		p.steps = returns(result);
		return recipe(
			p,
			'interactive',
			'Runs this built-in with an editable receiver and arguments. Unsupported methods and invalid argument combinations return the browser error.'
		);
	}
	const byName: Record<string, unknown> = {
		Addition: { op: 'binary', operator: '+', left: input('a'), right: input('b') },
		Multiplicative: { op: 'binary', operator: '*', left: input('a'), right: input('b') },
		Exponentiation: { op: 'binary', operator: '**', left: input('a'), right: input('b') },
		Equality: { op: 'binary', operator: '===', left: input('a'), right: input('b') },
		Relational: { op: 'binary', operator: '<', left: input('a'), right: input('b') },
		Conditional: { op: 'conditional', test: input('a'), then: 'truthy', else: 'falsy' },
		Logical: { op: 'binary', operator: '&&', left: input('a'), right: input('b') },
		Bitwise: { op: 'binary', operator: '|', left: input('a'), right: input('b') }
	};
	for (const [term, expression] of Object.entries(byName))
		if (f.kind === 'language' && f.name.includes(term))
			return recipe({
				...p,
				parameters: [parameter('a', 'Left operand', 3, 'json'), parameter('b', 'Right operand', 2, 'json')],
				steps: returns(expression)
			});
	return recipe(
		{
			...p,
			parameters: [parameter('value', 'Value to inspect', { hello: 'Thingtime', values: [1, 2, 3] }, 'json')],
			steps: returns({
				op: 'object',
				entries: [
					['value', input('value')],
					['type', { op: 'unary', operator: 'typeof', value: input('value') }]
				]
			})
		},
		'inspection',
		'This specification clause is indexed. This value inspector is not a worked example of the complete clause.'
	);
}
function webApiRecipe(f: Feature): Recipe {
	const p = base(f),
		name = f.interface || f.name;
	const examples: Record<string, PlatformProgram> = {
		URL: {
			...p,
			parameters: [parameter('url', 'URL', 'https://example.com/path?name=Thingtime#hello')],
			steps: returns(method(make('URL', [input('url')]), 'toJSON'))
		},
		URLSearchParams: {
			...p,
			parameters: [parameter('query', 'Query', 'name=Thingtime&color=purple&color=teal')],
			steps: returns(method(global('Array'), 'from', [method(make('URLSearchParams', [input('query')]), 'entries')]))
		},
		TextEncoder: {
			...p,
			parameters: [parameter('text', 'Text', 'Hello 🌈')],
			steps: returns(method(make('TextEncoder'), 'encode', [input('text')]))
		},
		TextDecoder: {
			...p,
			parameters: [parameter('bytes', 'UTF-8 bytes', [72, 101, 108, 108, 111], 'json')],
			steps: returns(method(make('TextDecoder'), 'decode', [make('Uint8Array', [input('bytes')])]))
		},
		Blob: {
			...p,
			parameters: [parameter('text', 'Contents', 'Hello Thingtime')],
			steps: returns({ op: 'await', value: method(make('Blob', [{ op: 'array', items: [input('text')] }]), 'text') })
		},
		Event: { ...p, parameters: [parameter('type', 'Event name', 'thingtime')], steps: returns(get(make('Event', [input('type')]), 'type')) },
		DOMException: {
			...p,
			parameters: [parameter('message', 'Message', 'A demonstration error')],
			steps: returns(make('DOMException', [input('message'), 'InvalidStateError']))
		},
		AbortController: {
			...p,
			steps: [
				{ op: 'let', name: 'controller', value: make('AbortController') },
				{ op: 'expression', value: method({ op: 'variable', name: 'controller' }, 'abort', ['Stopped by the demo']) },
				...returns(get(get({ op: 'variable', name: 'controller' }, 'signal'), 'aborted'))
			]
		},
		Headers: {
			...p,
			parameters: [parameter('headers', 'Headers', { Accept: 'application/json', 'Content-Type': 'text/plain' }, 'json')],
			steps: returns(method(global('Array'), 'from', [method(make('Headers', [input('headers')]), 'entries')]))
		},
		Request: {
			...p,
			parameters: [parameter('url', 'URL (no request is sent)', 'https://example.com/demo')],
			steps: returns(get(make('Request', [input('url')]), 'url'))
		},
		Response: {
			...p,
			parameters: [parameter('text', 'Response body', 'Hello from a local Response')],
			steps: returns({ op: 'await', value: method(make('Response', [input('text')]), 'text') })
		},
		FormData: {
			...p,
			steps: [
				{ op: 'let', name: 'form', value: make('FormData') },
				{ op: 'expression', value: method({ op: 'variable', name: 'form' }, 'append', ['name', 'Thingtime']) },
				...returns(method(global('Array'), 'from', [method({ op: 'variable', name: 'form' }, 'entries')]))
			]
		}
	};
	if (examples[name] && ['interface', 'constructor'].includes(f.kind)) return recipe(examples[name]);
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
