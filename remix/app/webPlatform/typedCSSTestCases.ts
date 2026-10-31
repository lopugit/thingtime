import type { PlatformProgram } from './types';
/** A second meaningful input set for the browser/persistence acceptance audit. */
export function editTypedCSSProgram(program: PlatformProgram): PlatformProgram {
	const edited = structuredClone(program),
		ps = edited.parameters!;
	const p =
		ps.find((p) => p.name === 'replacement') ||
		ps.find((p) => p.name === 'edited') ||
		ps.find((p) => p.name === 'text') ||
		ps.find((p) => p.name === 'right') ||
		ps[0];
	if (program.title === 'CSSNumericValue.equals') ps.find((p) => p.name === 'right')!.default = '24px';
	else if (p.name === 'right') p.default = '48px';
	else if (p.type === 'number') p.default = Number(p.default) * 1.5;
	else if (p.type === 'boolean') p.default = !p.default;
	else if (p.type === 'json')
		p.default = p.name === 'matrix' || p.label.toLowerCase().includes('matrix') ? [1, 0.2, 0.1, 1, 36, 18] : [0.7, 0.4, 0.2];
	else {
		const text = String(p.default);
		p.default = text.startsWith('url(')
			? text.replace('")', '#edited")')
			: text === 'grid'
			? 'flex'
			: text === 'srgb'
			? 'display-p3'
			: text === 'display-p3'
			? 'srgb'
			: text.startsWith('--')
			? '--edited-width'
			: text.startsWith('oklch')
			? 'oklch(45% .12 150)'
			: text === '4'
			? '8'
			: text.replace(/\d+(?:\.\d+)?/, (n) => String(Number(n) * 1.5));
	}
	return edited;
}
