import type { DemoBlock } from './webpageDemos';

// Installed pages point to their owner's concrete controls, so a platform
// component with the same key cannot hide a customized installed version.
export const bindSuiteComponentRefs = (blocks: DemoBlock[], ids: Record<string, string>): DemoBlock[] =>
	blocks.map((block) => ({
		...block,
		...(block.type === 'component' && block.component && Object.prototype.hasOwnProperty.call(ids, block.component)
			? { component: ids[block.component] }
			: {}),
		...(block.children ? { children: bindSuiteComponentRefs(block.children, ids) } : {})
	}));
