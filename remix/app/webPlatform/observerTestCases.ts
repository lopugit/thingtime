import type { PlatformProgram } from './types';
export function editObserverProgram(program: PlatformProgram): PlatformProgram {
	const p = structuredClone(program);
	for (const parameter of p.parameters || []) {
		if (parameter.name === 'size') parameter.default = 130;
		else if (parameter.name === 'value') parameter.default = 'Edited database program';
		else if (parameter.name === 'ownedRoot') parameter.default = false;
		else if (parameter.name === 'entry') {
			const value = parameter.default as Record<string, any>;
			value.time = 84;
			value.intersectionRatio = 0.75;
			value.isIntersecting = false;
			value.isVisible = false;
			for (const key of ['rootBounds', 'boundingClientRect', 'intersectionRect']) {
				value[key].x += 10;
				value[key].width += 30;
			}
		} else if (parameter.name === 'options') {
			const value = parameter.default as Record<string, any>;
			if ('box' in value) value.box = 'border-box';
			else if ('threshold' in value) {
				value.threshold = [0, 0.25, 0.75];
				value.rootMargin = '20px';
				if ('scrollMargin' in value) value.scrollMargin = '30px';
				if ('delay' in value) value.delay = 200;
				if ('trackVisibility' in value) value.trackVisibility = false;
			} else {
				value.attributeOldValue = false;
				value.characterDataOldValue = false;
				if (p.title.startsWith('MutationObserverInit.')) {
					const field = p.title.split('.')[1];
					if (field === 'attributeFilter') value.attributeFilter = ['data-x'];
					else value[field] = false;
				}
			}
		}
	}
	return p;
}
