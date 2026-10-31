import type { Arg, Policy } from './domBridge';

export type XPathArg = 'xpath-expression' | 'xpath-node' | 'xpath-resolver' | 'xpath-result' | 'xpath-type';
const call = (args: Arg[] = [], min = args.length) => ({ args, min });
export const XPATH_CONSTANTS = [
	'ANY_TYPE',
	'NUMBER_TYPE',
	'STRING_TYPE',
	'BOOLEAN_TYPE',
	'UNORDERED_NODE_ITERATOR_TYPE',
	'ORDERED_NODE_ITERATOR_TYPE',
	'UNORDERED_NODE_SNAPSHOT_TYPE',
	'ORDERED_NODE_SNAPSHOT_TYPE',
	'ANY_UNORDERED_NODE_TYPE',
	'FIRST_ORDERED_NODE_TYPE'
];
export const XPATH_CALLS = {
	createExpression: call(['xpath-expression', 'xpath-resolver'], 1),
	createNSResolver: call(['xpath-node']),
	evaluate: call(['xpath-expression', 'xpath-node', 'xpath-resolver', 'xpath-type', 'xpath-result'], 2)
};
export const XPATH_CONSTRUCTORS = { XPathEvaluator: call() };
export const XPATH_RECEIVER_POLICY: Record<string, Policy> = {
	XPathEvaluator: { reads: '', calls: XPATH_CALLS },
	XPathExpression: { reads: '', calls: { evaluate: call(['xpath-node', 'xpath-type', 'xpath-result'], 1) } },
	XPathResult: {
		reads: 'resultType numberValue stringValue booleanValue singleNodeValue invalidIteratorState snapshotLength ' + XPATH_CONSTANTS.join(' '),
		calls: { iterateNext: call(), snapshotItem: call(['number']) }
	}
};
