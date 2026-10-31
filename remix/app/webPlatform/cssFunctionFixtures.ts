import { base, parameter, recipe } from './programBuilders';
import type { Feature, PlatformNode, PlatformProgram, Recipe } from './types';

type Example = {
	property: string;
	value: string;
	edited: string;
	context?: 'grid' | 'easing' | 'counter' | 'nested-counter' | 'list' | 'anchor' | 'image' | 'siblings';
	declarations?: Record<string, string>;
	pseudoElement?: string;
	note?: string;
};
const examples: Record<string, Example> = {};
function group(property: string, values: Record<string, [string, string]>, extra: Partial<Example> = {}) {
	for (const [name, [value, edited]] of Object.entries(values)) examples[name] = { property, value, edited, ...extra };
}
// Concrete declaration contexts, not function-name dispatch in the runtime.
// Each pair is also used by the native-browser regression fixtures.
group('width', {
	'calc()': ['calc(100px + 20px)', 'calc(100px + 60px)'],
	'min()': ['min(150px, 180px)', 'min(110px, 180px)'],
	'max()': ['max(90px, 130px)', 'max(150px, 130px)'],
	'clamp()': ['clamp(90px, 140px, 180px)', 'clamp(90px, 110px, 180px)'],
	'abs()': ['abs(-150px)', 'abs(-90px)'],
	'cos()': ['calc(180px * cos(30deg))', 'calc(180px * cos(60deg))'],
	'sin()': ['calc(180px * sin(60deg))', 'calc(180px * sin(30deg))'],
	'tan()': ['calc(120px * tan(45deg))', 'calc(120px * tan(30deg))'],
	'exp()': ['calc(50px * exp(1))', 'calc(50px * exp(0.5))'],
	'hypot()': ['hypot(90px, 120px)', 'hypot(60px, 80px)'],
	'log()': ['calc(50px * log(8, 2))', 'calc(50px * log(4, 2))'],
	'mod()': ['mod(450px, 160px)', 'mod(420px, 160px)'],
	'pow()': ['calc(20px * pow(2, 3))', 'calc(20px * pow(2, 2))'],
	'rem()': ['rem(450px, 160px)', 'rem(420px, 160px)'],
	'round()': ['round(nearest, 143px, 20px)', 'round(up, 143px, 20px)'],
	'sqrt()': ['calc(30px * sqrt(25))', 'calc(30px * sqrt(9))'],
	'calc-size()': ['calc-size(max-content, size + 40px)', 'calc-size(max-content, size + 80px)'],
	'progress()': ['calc(200px * progress(75, 0, 100))', 'calc(200px * progress(50, 0, 100))'],
	'attr()': ['attr(data-width px, 90px)', 'calc(attr(data-width px, 90px) + 30px)']
});
group('transform', {
	'acos()': ['rotate(acos(0.8))', 'rotate(acos(0.3))'],
	'asin()': ['rotate(asin(0.4))', 'rotate(asin(0.8))'],
	'atan()': ['rotate(atan(0.4))', 'rotate(atan(1))'],
	'atan2()': ['rotate(atan2(30px, 100px))', 'rotate(atan2(100px, 30px))'],
	'sign()': ['translateX(calc(25px * sign(-5)))', 'translateX(calc(25px * sign(5)))'],
	'translate()': ['translate(20px, 8px)', 'translate(-10px, 20px)'],
	'translateX()': ['translateX(25px)', 'translateX(-15px)'],
	'translateY()': ['translateY(20px)', 'translateY(-10px)'],
	'translateZ()': ['translateZ(50px)', 'translateZ(-50px)'],
	'translate3d()': ['translate3d(15px, 10px, 50px)', 'translate3d(-10px, 0, -50px)'],
	'rotate()': ['rotate(20deg)', 'rotate(-15deg)'],
	'rotateX()': ['rotateX(45deg)', 'rotateX(15deg)'],
	'rotateY()': ['rotateY(45deg)', 'rotateY(-20deg)'],
	'rotateZ()': ['rotateZ(25deg)', 'rotateZ(-15deg)'],
	'rotate3d()': ['rotate3d(1, 1, 0, 40deg)', 'rotate3d(1, 0, 1, -30deg)'],
	'scale()': ['scale(0.8)', 'scale(1.1)'],
	'scaleX()': ['scaleX(0.7)', 'scaleX(1.1)'],
	'scaleY()': ['scaleY(0.7)', 'scaleY(1.1)'],
	'scaleZ()': ['scaleZ(2) rotateY(40deg)', 'scaleZ(0.5) rotateY(40deg)'],
	'scale3d()': ['scale3d(0.8, 1.1, 2) rotateY(30deg)', 'scale3d(1.1, 0.7, 0.5) rotateY(30deg)'],
	'skew()': ['skew(15deg, 5deg)', 'skew(-15deg, -5deg)'],
	'skewX()': ['skewX(20deg)', 'skewX(-10deg)'],
	'skewY()': ['skewY(15deg)', 'skewY(-10deg)'],
	'matrix()': ['matrix(1, 0.2, 0, 1, 10, 0)', 'matrix(0.8, 0, 0.2, 1, 0, 10)'],
	'matrix3d()': ['matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 20,10,40,1)', 'matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, -10,0,-40,1)'],
	'perspective()': ['perspective(160px) rotateY(40deg)', 'perspective(500px) rotateY(40deg)']
});
group('filter', {
	'blur()': ['blur(2px)', 'blur(0.5px)'],
	'brightness()': ['brightness(1.5)', 'brightness(0.6)'],
	'contrast()': ['contrast(2)', 'contrast(0.5)'],
	'drop-shadow()': ['drop-shadow(5px 6px 3px #334155)', 'drop-shadow(-4px 2px 1px #e11d48)'],
	'grayscale()': ['grayscale(1)', 'grayscale(0.3)'],
	'hue-rotate()': ['hue-rotate(90deg)', 'hue-rotate(210deg)'],
	'invert()': ['invert(1)', 'invert(0.2)'],
	'opacity()': ['opacity(0.4)', 'opacity(0.85)'],
	'saturate()': ['saturate(3)', 'saturate(0.3)'],
	'sepia()': ['sepia(1)', 'sepia(0.2)']
});
group(
	'background-color',
	{
		'rgb()': ['rgb(20 150 220 / 0.8)', 'rgb(220 80 130 / 0.8)'],
		'rgba()': ['rgba(20, 150, 220, 0.8)', 'rgba(220, 80, 130, 0.8)'],
		'hsl()': ['hsl(200 70% 65%)', 'hsl(330 70% 65%)'],
		'hsla()': ['hsla(200, 70%, 65%, 0.8)', 'hsla(330, 70%, 65%, 0.8)'],
		'hwb()': ['hwb(200 30% 10%)', 'hwb(330 30% 10%)'],
		'lab()': ['lab(70% -20 -25)', 'lab(70% 35 10)'],
		'lch()': ['lch(70% 45 220)', 'lch(70% 45 330)'],
		'oklab()': ['oklab(75% -0.08 -0.1)', 'oklab(75% 0.1 0.02)'],
		'oklch()': ['oklch(75% 0.12 220)', 'oklch(75% 0.12 330)'],
		'color()': ['color(display-p3 0.2 0.7 0.9)', 'color(display-p3 0.9 0.4 0.6)'],
		'color-mix()': ['color-mix(in oklch, skyblue 70%, pink)', 'color-mix(in oklch, skyblue 20%, pink)'],
		'alpha()': ['alpha(from skyblue / 0.7)', 'alpha(from skyblue / 0.3)'],
		'device-cmyk()': ['device-cmyk(0.7 0.1 0 0)', 'device-cmyk(0 0.6 0.2 0)'],
		'light-dark()': ['light-dark(skyblue, plum)', 'light-dark(pink, lightgreen)'],
		'var()': ['var(--accent, skyblue)', 'var(--missing, pink)']
	},
	{ declarations: { 'background-image': 'none', 'color-scheme': 'light', '--accent': '#7dd3fc' } }
);
group(
	'background-image',
	{
		'linear-gradient()': ['linear-gradient(30deg, #38bdf8, #f472b6)', 'linear-gradient(150deg, #4ade80, #fbbf24)'],
		'radial-gradient()': ['radial-gradient(circle at 25% 25%, #38bdf8, #f472b6)', 'radial-gradient(circle at 75% 75%, #4ade80, #fbbf24)'],
		'conic-gradient()': ['conic-gradient(#38bdf8, #f472b6, #38bdf8)', 'conic-gradient(from 90deg, #4ade80, #fbbf24, #4ade80)'],
		'repeating-linear-gradient()': [
			'repeating-linear-gradient(45deg, #38bdf8 0 10px, #f472b6 10px 20px)',
			'repeating-linear-gradient(135deg, #4ade80 0 5px, #fbbf24 5px 10px)'
		],
		'repeating-radial-gradient()': [
			'repeating-radial-gradient(circle, #38bdf8 0 8px, #f472b6 8px 16px)',
			'repeating-radial-gradient(circle, #4ade80 0 4px, #fbbf24 4px 8px)'
		],
		'repeating-conic-gradient()': [
			'repeating-conic-gradient(#38bdf8 0deg 30deg, #f472b6 30deg 60deg)',
			'repeating-conic-gradient(#4ade80 0deg 15deg, #fbbf24 15deg 30deg)'
		],
		'image-set()': [
			'image-set(linear-gradient(skyblue, pink) 1x, linear-gradient(skyblue, pink) 2x)',
			'image-set(linear-gradient(plum, lightgreen) 1x, linear-gradient(plum, lightgreen) 2x)'
		],
		'-webkit-image-set()': ['-webkit-image-set(linear-gradient(skyblue, pink) 1x)', '-webkit-image-set(linear-gradient(plum, lightgreen) 1x)'],
		'cross-fade()': [
			'cross-fade(70% linear-gradient(skyblue, skyblue), 30% linear-gradient(pink, pink))',
			'cross-fade(20% linear-gradient(skyblue, skyblue), 80% linear-gradient(pink, pink))'
		],
		'filter()': ['filter(linear-gradient(skyblue, pink), grayscale(1))', 'filter(linear-gradient(skyblue, pink), hue-rotate(90deg))'],
		'image()': ['image(skyblue)', 'image(pink)'],
		'element()': ['element(#image-source)', 'element(#image-alternate)']
	},
	{ context: 'image' }
);
group('clip-path', {
	'circle()': ['circle(45%)', 'circle(30% at 30% 50%)'],
	'inset()': ['inset(10% round 16px)', 'inset(20% 5% round 8px)'],
	'ellipse()': ['ellipse(45% 30%)', 'ellipse(30% 45%)'],
	'polygon()': ['polygon(50% 0%, 100% 100%, 0% 100%)', 'polygon(0% 0%, 100% 0%, 75% 100%, 25% 100%)'],
	'path()': ['path("M 0 0 L 120 0 L 60 80 Z")', 'path("M 0 0 L 120 0 L 120 40 L 0 80 Z")'],
	'rect()': ['rect(5px 110px 75px 10px round 12px)', 'rect(15px 100px 65px 20px round 4px)'],
	'xywh()': ['xywh(10px 5px 100px 70px round 12px)', 'xywh(20px 15px 80px 50px round 4px)'],
	'shape()': ['shape(from 50% 0%, line to 100% 100%, line to 0% 100%, close)', 'shape(from 0% 0%, line to 100% 0%, line to 70% 100%, close)']
});
group(
	'grid-template-columns',
	{
		'repeat()': ['repeat(3, 1fr)', 'repeat(2, 1fr)'],
		'minmax()': ['minmax(20px, 1fr) 2fr', 'minmax(70px, 1fr) 1fr'],
		'fit-content()': ['fit-content(60px) 1fr', 'fit-content(100px) 1fr']
	},
	{ context: 'grid', declarations: { display: 'grid', width: '180px', height: 'auto', gap: '4px', 'align-content': 'start' } }
);
group(
	'animation-timing-function',
	{
		'cubic-bezier()': ['cubic-bezier(0.2, 0.8, 0.4, 1)', 'cubic-bezier(0.8, 0.1, 0.9, 0.4)'],
		'linear()': ['linear(0, 0.2 60%, 1)', 'linear(0, 0.8 40%, 1)'],
		'steps()': ['steps(4, jump-end)', 'steps(4, jump-start)']
	},
	{
		context: 'easing',
		note: 'The animation is paused at an editable negative delay. The marker position shows the timing function at that progress.'
	}
);
group(
	'content',
	{
		'counter()': ['counter(chapter, decimal)', 'counter(chapter, upper-roman)']
	},
	{
		context: 'counter',
		pseudoElement: '::before',
		note: 'The browser renders the generated counter. Computed content may retain functional notation rather than the painted glyphs.'
	}
);
group(
	'content',
	{
		'counters()': ['counters(chapter, ".", decimal)', 'counters(chapter, " / ", upper-roman)']
	},
	{
		context: 'nested-counter',
		pseudoElement: '::before',
		note: 'Nested counter scopes are rendered by the browser; computed content is not a glyph transcription.'
	}
);
group(
	'list-style-type',
	{
		'symbols()': ['symbols(cyclic "★" "◆")', 'symbols(cyclic "●" "◇")']
	},
	{ context: 'list' }
);
group(
	'padding-left',
	{
		'env()': ['env(safe-area-inset-left, 12px)', 'calc(env(safe-area-inset-left, 0px) + 24px)']
	},
	{ note: 'Safe-area values are device dependent and often zero on desktop. The fallback is used only when the variable is unavailable.' }
);
group(
	'offset-path',
	{
		'ray()': ['ray(45deg closest-side)', 'ray(135deg closest-side)']
	},
	{ declarations: { 'offset-distance': '50%', 'offset-rotate': '0deg', width: '60px', height: '40px' } }
);
group(
	'corner-shape',
	{
		'superellipse()': ['superellipse(0)', 'superellipse(2)']
	},
	{ declarations: { 'border-radius': '30px' } }
);
group(
	'width',
	{
		'sibling-count()': ['calc(35px * sibling-count())', 'calc(50px * sibling-count())'],
		'sibling-index()': ['calc(55px * sibling-index())', 'calc(75px * sibling-index())']
	},
	{ context: 'siblings' }
);
group(
	'left',
	{
		'anchor()': ['anchor(--demo left, 0px)', 'anchor(--demo right, 0px)']
	},
	{ context: 'anchor', declarations: { position: 'absolute', top: '80px', width: '70px', height: '45px' } }
);
group(
	'width',
	{
		'anchor-size()': ['anchor-size(--demo width, 60px)', 'calc(anchor-size(--demo width, 60px) + 30px)']
	},
	{ context: 'anchor', declarations: { position: 'absolute', top: '80px', left: '0', height: '45px' } }
);

const node = (tag: string, children: PlatformNode[] = [], attributes: Record<string, string | number | boolean> = {}): PlatformNode => ({
	tag,
	children,
	attributes
});
export const CSS_FUNCTION_EXAMPLES: Readonly<Record<string, Example>> = examples;
export function cssFunctionRecipe(feature: Feature): Recipe | undefined {
	if (feature.language !== 'css' || !['function', 'value'].includes(feature.kind)) return;
	// Published-value entries share these functions. The paged-media
	// element() is a different feature and needs a print context.
	if (feature.name === 'element()' && feature.group !== 'css-images-4') return;
	const example = examples[feature.name];
	if (!example) return;
	const p: PlatformProgram = base(feature);
	p.parameters = [parameter('value', `${example.property} value`, example.value)];
	if (feature.name === 'attr()') p.parameters.push(parameter('attribute', 'data-width (pixels)', 150, 'number'));
	if (feature.name === 'light-dark()') p.parameters.push(parameter('scheme', 'Colour scheme: light or dark', 'light'));
	if (example.context === 'easing') p.parameters.push(parameter('delay', 'Paused animation delay (−2s = halfway)', '-2s'));
	const sample = (id: string): PlatformNode =>
		node('div', example.context === 'grid' ? ['Alpha beta', 'Two', 'Three'].map((text) => node('span', [text])) : ['Thingtime'], {
			id,
			class: 'tile',
			'data-width': '[[attribute]]'
		});
	const contents = (id: string): PlatformNode[] => {
		if (example.context === 'list')
			return [node('ul', [node('li', ['First']), node('li', ['Second']), node('li', ['Third'])], { id, class: 'tile' })];
		if (example.context === 'nested-counter')
			return [node('div', [node('span', ['Outer scope']), node('div', [sample(id)], { class: 'nested' })], { class: 'counter-scope' })];
		if (example.context === 'counter') return [node('div', [sample(id)], { class: 'counter-scope' })];
		if (example.context === 'siblings')
			return [node('span', ['First sibling'], { class: 'sibling' }), sample(id), node('span', ['Third sibling'], { class: 'sibling' })];
		if (example.context === 'anchor') return [node('div', ['Anchor'], { class: id === 'sample' ? 'anchor' : 'anchor-control' }), sample(id)];
		return [sample(id)];
	};
	p.document = [
		node(
			'section',
			[
				node('div', [node('strong', ['Control']), node('div', contents('control'), { class: 'stage' })], { class: 'case' }),
				node('div', [node('strong', ['Your value']), node('div', contents('sample'), { class: 'stage' })], { class: 'case' })
			],
			{ class: 'comparison' }
		)
	];
	if (example.context === 'image')
		p.document.push(
			node('div', [node('span', ['Blue source'], { id: 'image-source' }), node('span', ['Pink source'], { id: 'image-alternate' })], {
				class: 'sources'
			})
		);
	p.styles = [
		{
			selector: '.comparison',
			declarations: {
				display: 'grid',
				'grid-template-columns': 'repeat(2,minmax(0,1fr))',
				gap: '8px',
				'font-family': 'system-ui',
				'font-size': '12px'
			}
		},
		{ selector: '.case', declarations: { 'min-width': '0', border: '1px solid #cbd5e1', 'border-radius': '12px', padding: '8px', overflow: 'auto' } },
		{ selector: '.stage', declarations: { position: 'relative', 'min-height': '180px', padding: '24px 0', perspective: '400px', color: '#172554' } },
		{
			selector: '.tile',
			declarations: {
				'box-sizing': 'border-box',
				width: '120px',
				height: '80px',
				padding: '8px',
				background: 'linear-gradient(120deg,#7dd3fc,#f9a8d4)',
				border: '2px solid #475569',
				'font-weight': '700',
				color: '#172554',
				...example.declarations
			}
		},
		{ selector: '.tile span', declarations: { padding: '4px', background: '#ffffff99', border: '1px solid #475569' } },
		{ selector: '.sources span', declarations: { display: 'inline-block', padding: '6px', background: 'skyblue', margin: '4px' } },
		{ selector: '#image-alternate', declarations: { background: 'pink' } },
		{ selector: '.counter-scope', declarations: { 'counter-reset': 'chapter 3' } },
		{ selector: '.nested', declarations: { 'counter-reset': 'chapter 7' } },
		{ selector: '.tile::before', declarations: { 'margin-right': '6px' } },
		{ selector: '.anchor,.anchor-control', declarations: { width: '90px', padding: '4px', background: '#bbf7d0', 'margin-left': '8px' } },
		{ selector: '.anchor', declarations: { 'anchor-name': '--demo' } },
		{ selector: '.sibling', declarations: { display: 'block', 'font-size': '10px' } }
	];
	if (example.pseudoElement) p.styles.push({ selector: '.tile::before', declarations: { content: '"Control"' } });
	if (example.context === 'easing')
		p.styles.push(
			{ rule: '@keyframes travel { from { transform:translateX(0px) } to { transform:translateX(70px) } }' },
			{
				selector: '.tile',
				declarations: { width: '70px', height: '50px', animation: 'travel 4s linear both paused', 'animation-delay': '[[delay]]' }
			}
		);
	if (feature.name === 'light-dark()') p.styles.push({ selector: '.tile', declarations: { 'color-scheme': '[[scheme]]' } });
	p.styles.push({ selector: `#sample${example.pseudoElement || ''}`, declarations: { [example.property]: '[[value]]' } });
	p.probe = {
		kind: 'css',
		name: example.property,
		value: '[[value]]',
		target: '#sample',
		compareTarget: '#control',
		...(example.pseudoElement ? { pseudoElement: example.pseudoElement } : {})
	};
	return recipe(
		p,
		'interactive',
		`${
			example.note || 'Edit the declaration and compare the rendered sample with its control.'
		} Syntax support and computed observations are reported separately. Draft features may be unsupported in this browser.`
	);
}
