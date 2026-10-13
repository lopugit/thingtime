import type { PlatformProgram } from './types';
export function editCSSOMProgram(program: PlatformProgram): PlatformProgram {
	const p = structuredClone(program),
		ps = p.parameters!;
	const preferred =
		(p.title === 'CSSStyleDeclaration.getPropertyPriority' ? ps.find((p) => p.name === 'priority') : undefined) ||
		ps.find((p) => p.name === 'value') ||
		ps.find((p) => p.name === 'replacement') ||
		ps[0];
	if (preferred.type === 'boolean') preferred.default = !preferred.default;
	else if (preferred.type === 'number') preferred.default = Number(preferred.default) + 1;
	else if (preferred.type === 'json') preferred.default = { media: 'print', disabled: true };
	else {
		const text = String(preferred.default);
		preferred.default =
			text === 'demo:1'
				? 'demo 2'
				: text === 'screen'
				? 'screen, (min-width: 1px)'
				: text === 'print'
				? 'screen and (min-width: 1px)'
				: text === 'important'
				? ''
				: text === 'a4'
				? 'letter'
				: text === 'crop'
				? 'cross'
				: text === 'rotate-left'
				? 'rotate-right'
				: text === 'right'
				? 'left'
				: text.includes('/a/')
				? text.replace('/a/', '/b/')
				: text.includes('urn:thingtime:demo')
				? text.replace('urn:thingtime:demo', 'urn:thingtime:edited')
				: text.startsWith('@import')
				? text.replace('blue', 'red').replace('layer(demo)', 'layer(edited)')
				: text.replace(/\d+(?:\.\d+)?/, (n) => String(Number(n) * 1.5));
	}
	if (p.title === 'CSSRule.cssText') ps.find((p) => p.name === 'css')!.default = '#sample {width:144px; color:red}';
	if (['CSSGroupingRule.deleteRule', 'CSSStyleSheet.deleteRule', 'CSSStyleSheet.removeRule'].includes(p.title))
		ps.find((p) => p.name === 'css')!.default = String(ps.find((p) => p.name === 'css')!.default).replace(
			/\}\s*$/,
			'} .edited {height:48px}' + (p.title.startsWith('CSSGrouping') ? '}' : '')
		);
	return p;
}
