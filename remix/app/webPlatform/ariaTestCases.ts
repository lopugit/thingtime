import type { PlatformProgram } from './types';
export function editARIAProgram(source: PlatformProgram): PlatformProgram {
	const program = structuredClone(source);
	for (const p of program.parameters || []) {
		if (p.name === 'value') {
			const alternate: Record<string, string> = {
				true: 'false',
				group: 'region',
				mixed: 'true',
				list: 'both',
				page: 'step',
				menu: 'dialog',
				grammar: 'spelling',
				polite: 'assertive',
				horizontal: 'vertical',
				ascending: 'descending',
				'additions text': 'removals',
				'Alt+S': 'Alt+D'
			};
			const value = String(p.default);
			p.default = alternate[value] || (/^\d+$/.test(value) ? String(Number(value) + 1) : 'Customized ' + value);
		}
		if (p.name === 'selector') p.default = '#second';
	}
	return program;
}
