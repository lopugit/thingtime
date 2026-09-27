import type { PlatformProgram } from './types';
const document: PlatformProgram['document'] = [
	{ tag: 'div', attributes: { id: 'sample' } },
	{ tag: 'div', attributes: { id: 'control' } }
];
const base: PlatformProgram = {
	version: 1,
	title: 'CSS observation',
	document,
	styles: [{ selector: '#sample,#control', declarations: { width: '120px', color: 'rgb(1, 2, 3)' } }],
	probe: { kind: 'css', name: 'width', value: '120px' }
};
export const CSS_PROBE_BOUNDARY_FIXTURES: { name: string; program: PlatformProgram; expected?: Record<string, unknown>; error?: string }[] = [
	{
		name: 'CSS computed arithmetic',
		program: {
			...base,
			styles: [{ selector: '#sample', declarations: { width: 'hypot(30px, 40px)' } }],
			probe: { kind: 'css', name: 'width', value: 'hypot(30px, 40px)' }
		},
		expected: { supported: true, computed: '50px' }
	},
	{
		name: 'CSS property and target parameter substitution',
		program: {
			...base,
			parameters: [
				{ name: 'property', label: 'Property', type: 'text', default: 'width' },
				{ name: 'target', label: 'Target', type: 'text', default: '#control' }
			],
			probe: { kind: 'css', name: '[[property]]', value: '120px', target: '[[target]]' }
		},
		expected: { property: 'width', target: '#control', computed: '120px' }
	},
	{
		name: 'CSS syntactically valid missing variable is not proof of effect',
		program: {
			...base,
			styles: [...base.styles!, { selector: '#sample', declarations: { color: 'var(--missing)' } }],
			probe: { kind: 'css', name: 'color', value: 'var(--missing)', compareTarget: '#control' }
		},
		expected: { supported: true, status: 'syntax-accepted', sameComputedValue: false }
	},
	{
		name: 'CSS rejected value leaves actual control style visible',
		program: {
			...base,
			styles: [...base.styles!, { selector: '#sample', declarations: { width: 'not-a-width' } }],
			probe: { kind: 'css', name: 'width', value: 'not-a-width', compareTarget: '#control' }
		},
		expected: { status: 'unsupported', supported: false, computed: '120px', sameComputedValue: true }
	},
	{
		name: 'CSS pseudo-element reads generated content rather than element style',
		program: {
			...base,
			styles: [
				{ selector: '#sample::before', declarations: { content: '"Hello"' } },
				{ selector: '#control::before', declarations: { content: '"Control"' } }
			],
			probe: { kind: 'css', name: 'content', value: '"Hello"', pseudoElement: '::before', compareTarget: '#control' }
		},
		expected: { computed: '"Hello"', pseudoElement: '::before', sameComputedValue: false }
	},
	{
		name: 'CSS comparison is scoped to the rendered surface',
		program: { ...base, probe: { kind: 'css', name: 'width', compareTarget: 'body' } },
		error: 'No CSS probe element matches body'
	},
	{
		name: 'CSS missing target is explicit',
		program: { ...base, probe: { kind: 'css', name: 'width', target: '#missing' } },
		error: 'No CSS probe element matches #missing'
	},
	{
		name: 'CSS pseudo-element vocabulary is closed',
		program: { ...base, probe: { kind: 'css', name: 'color', pseudoElement: '::part(secret)' } },
		error: 'Unsupported CSS probe pseudo-element'
	},
	{
		name: 'CSS overlong probe input is rejected before execution',
		program: { ...base, probe: { kind: 'css', name: 'width', value: 'x'.repeat(2049) } },
		error: 'CSS probe fields must be bounded text'
	},
	{
		name: 'CSS substituted probe input remains bounded',
		program: {
			...base,
			parameters: [{ name: 'value', label: 'Value', type: 'text', default: 'x'.repeat(2049) }],
			probe: { kind: 'css', name: 'width', value: '[[value]]' }
		},
		error: 'CSS probe fields must be bounded text'
	}
];
