import type { PlatformProgram } from './types';
export function editRangeProgram(program: PlatformProgram): PlatformProgram {
	const p = structuredClone(program);
	const defaults: Record<string, unknown> = {
		text: 'Custom database objects',
		start: 7,
		end: 15,
		prefix: 'More ',
		how: 2,
		point: 0,
		html: '<em>Database</em> objects',
		offset: 11,
		tag: 'strong',
		insert: '[saved]',
		toStart: false
	};
	for (const parameter of p.parameters || [])
		if (Object.prototype.hasOwnProperty.call(defaults, parameter.name)) parameter.default = defaults[parameter.name];
	return p;
}
