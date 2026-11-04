import type { PlatformProgram } from './types';
export function editAnimationProgram(source: PlatformProgram): PlatformProgram {
	const program = structuredClone(source);
	for (const parameter of program.parameters || []) {
		if (parameter.name === 'keyframes')
			parameter.default = [
				{ offset: 0, opacity: 0.8, transform: 'translateX(0px)' },
				{ offset: 1, opacity: 0.4, transform: 'translateX(200px)' }
			];
		if (parameter.name === 'timing') parameter.default = { ...(parameter.default as object), duration: 1500, easing: 'ease-in-out' };
		if (parameter.name === 'time') parameter.default = 900;
		if (parameter.name === 'id') parameter.default = 'Saved customized animation';
	}
	return program;
}
