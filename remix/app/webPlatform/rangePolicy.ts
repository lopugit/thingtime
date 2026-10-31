import type { Arg, Policy } from './domBridge';
export type RangeArg = 'range-node' | 'range-relative-node' | 'range-receiver' | 'range-init' | 'range-html';
const call = (args: Arg[] = [], min = args.length) => ({ args, min });
const mutate = (args: Arg[] = []) => ({ ...call(args), mutates: true });
export const RANGE_CONSTRUCTORS = { Range: call(), StaticRange: call(['range-init']) };
export const RANGE_INITIALIZERS = new Set([
	'setStart',
	'setEnd',
	'setStartBefore',
	'setStartAfter',
	'setEndBefore',
	'setEndAfter',
	'selectNode',
	'selectNodeContents'
]);
const boundaries = 'startContainer startOffset endContainer endOffset collapsed';
export const RANGE_RECEIVER_POLICY: Record<string, Policy> = {
	Range: {
		reads: boundaries + ' commonAncestorContainer START_TO_START START_TO_END END_TO_END END_TO_START',
		calls: {
			setStart: call(['range-node', 'number']),
			setEnd: call(['range-node', 'number']),
			setStartBefore: call(['range-relative-node']),
			setStartAfter: call(['range-relative-node']),
			setEndBefore: call(['range-relative-node']),
			setEndAfter: call(['range-relative-node']),
			selectNode: call(['range-relative-node']),
			selectNodeContents: call(['range-node']),
			collapse: call(['boolean'], 0),
			compareBoundaryPoints: call(['number', 'range-receiver']),
			comparePoint: call(['range-node', 'number']),
			isPointInRange: call(['range-node', 'number']),
			intersectsNode: call(['range-node']),
			cloneRange: call(),
			cloneContents: call(),
			extractContents: mutate(),
			deleteContents: mutate(),
			insertNode: mutate(['range-node']),
			surroundContents: mutate(['range-node']),
			createContextualFragment: call(['range-html']),
			detach: call(),
			toString: call(),
			getBoundingClientRect: call(),
			getClientRects: call()
		}
	},
	StaticRange: { reads: boundaries },
	AbstractRange: { reads: boundaries }
};
