import type { PlatformProgram } from './types';
export function editLayoutProgram(program: PlatformProgram): PlatformProgram {
	const p = structuredClone(program);
	for (const param of p.parameters || []) {
		if (param.type === 'number') param.default = param.name === 'index' ? 1 : param.name === 'opacity' ? 1 : Number(param.default) * 1.4;
		else if (param.type === 'boolean') param.default = !param.default;
		else if (param.name === 'query') param.default = '(max-width: 1px)';
		else if (param.name === 'transform') param.default = 'translate(60px, 25px) scale(1.5)';
		else if (param.type === 'json') {
			const edit = (v: unknown): unknown =>
				typeof v === 'number'
					? v * 1.5 + 5
					: typeof v === 'boolean'
					? !v
					: typeof v === 'string'
					? ({ end: 'start', nearest: 'center', border: 'content', padding: 'margin' } as Record<string, string>)[v] || v
					: v && typeof v === 'object'
					? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'container' ? 'nearest' : edit(x)]))
					: v;
			param.default = edit(param.default);
		}
	}
	return p;
}
