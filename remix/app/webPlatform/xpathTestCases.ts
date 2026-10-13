import type { PlatformProgram } from './types';
export function editXPathProgram(source: PlatformProgram): PlatformProgram {
	const program = structuredClone(source);
	const type = Number(program.parameters?.find((p) => p.name === 'type')?.default);
	for (const p of program.parameters || []) {
		if (p.name === 'expression')
			p.default =
				type === 1
					? "count(.//li[@data-kind='veg'])"
					: type === 2
					? 'string(.//li[2])'
					: type === 3
					? 'boolean(.//missing)'
					: ".//li[@data-kind='veg']";
		if (p.name === 'mutate' && p.default === true) p.default = false;
		if (p.name === 'prefix') p.default = null;
		if (p.name === 'mode') p.default = p.default === 'compiled' ? 'constructed' : 'compiled';
	}
	return program;
}
