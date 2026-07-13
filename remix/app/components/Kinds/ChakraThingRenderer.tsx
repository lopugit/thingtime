import React from 'react';
import {
	Alert,
	AlertDescription,
	AlertIcon,
	AlertTitle,
	AspectRatio,
	Avatar,
	AvatarGroup,
	Badge,
	Box,
	Button,
	Card,
	CardBody,
	CardFooter,
	CardHeader,
	Center,
	Circle,
	Code,
	Container,
	Divider,
	Flex,
	Grid,
	GridItem,
	HStack,
	Heading,
	Image,
	Kbd,
	Link,
	List,
	ListItem,
	OrderedList,
	Progress,
	SimpleGrid,
	Spacer,
	Spinner,
	Square,
	Stack,
	Stat,
	StatArrow,
	StatGroup,
	StatHelpText,
	StatLabel,
	StatNumber,
	Table,
	TableContainer,
	Tag,
	TagLabel,
	Tbody,
	Td,
	Text,
	Th,
	Thead,
	Tr,
	UnorderedList,
	VStack,
	Wrap,
	WrapItem
} from '@chakra-ui/react';

import { isSafeUrl } from './safeUrl';

// JSON → Chakra renderer: the serialised-component half of "everything is a
// thing". A node is either a string/number (text) or:
//   { type: 'chakra', chakra: 'Box', props: {…}, rawChildren: ['hi'], children: [node, …] }
// — the same shape the legacy Thingtime chakra templates use, but rendered
// through a sanitising gate (the HtmlThingRenderer treatment): only the
// component allowlist below resolves, event handlers / dangerouslySetInnerHTML
// / element-swapping props never pass through, URL props are checked, and
// string values are screened for css escape hatches. Safe for untrusted JSON.

const ALLOWED_COMPONENTS: Record<string, React.ElementType> = {
	Alert,
	AlertDescription,
	AlertIcon,
	AlertTitle,
	AspectRatio,
	Avatar,
	AvatarGroup,
	Badge,
	Box,
	Button,
	Card,
	CardBody,
	CardFooter,
	CardHeader,
	Center,
	Circle,
	Code,
	Container,
	Divider,
	Flex,
	Grid,
	GridItem,
	HStack,
	Heading,
	Image,
	Kbd,
	Link,
	List,
	ListItem,
	OrderedList,
	Progress,
	SimpleGrid,
	Spacer,
	Spinner,
	Square,
	Stack,
	Stat,
	StatArrow,
	StatGroup,
	StatHelpText,
	StatLabel,
	StatNumber,
	Table,
	TableContainer,
	Tag,
	TagLabel,
	Tbody,
	Td,
	Text,
	Th,
	Thead,
	Tr,
	UnorderedList,
	VStack,
	Wrap,
	WrapItem
};

// components that never take children
const CHILDLESS_COMPONENTS = new Set(['Image', 'Divider', 'Spinner', 'Progress', 'StatArrow', 'Spacer', 'AlertIcon']);

// props that reach into React/Chakra internals or swap the rendered element
const BLOCKED_PROPS = new Set(['as', 'ref', 'key', 'children', 'dangerouslySetInnerHTML', '__css', 'apply']);

const URL_PROPS = new Set(['href', 'src', 'poster', 'fallbackSrc']);

const MAX_NODES = 600;
const MAX_DEPTH = 24;
const MAX_PROP_DEPTH = 4;

// block css escape hatches anywhere a string value lands (bg can carry
// url(…), sx carries whole style blocks)
const safeCssText = (value: string): boolean => {
	const text = value.toLowerCase();
	return !text.includes('javascript:') && !text.includes('expression(') && !text.includes('@import');
};

const sanitizeValue = (value: unknown, depth: number): unknown => {
	if (typeof value === 'string') return safeCssText(value) ? value : undefined;
	if (typeof value === 'number' || typeof value === 'boolean') return value;
	if (Array.isArray(value)) {
		if (depth >= MAX_PROP_DEPTH) return undefined;
		const out = value.map((entry) => sanitizeValue(entry, depth + 1)).filter((entry) => entry !== undefined);
		return out.length ? out : undefined;
	}
	if (value && typeof value === 'object') {
		// responsive values ({ base, md }), sx blocks, pseudo props (_hover)
		if (depth >= MAX_PROP_DEPTH) return undefined;
		const out: Record<string, unknown> = {};
		Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
			if (/^on/i.test(key) || BLOCKED_PROPS.has(key)) return;
			const sanitized = sanitizeValue(entry, depth + 1);
			if (sanitized !== undefined) out[key] = sanitized;
		});
		return Object.keys(out).length ? out : undefined;
	}
	return undefined;
};

const sanitizeProps = (props: unknown): Record<string, unknown> => {
	if (!props || typeof props !== 'object' || Array.isArray(props)) return {};

	const out: Record<string, unknown> = {};
	Object.entries(props as Record<string, unknown>).forEach(([key, value]) => {
		// no event handlers, no internals, no element swapping
		if (/^on/i.test(key) || BLOCKED_PROPS.has(key)) return;
		if (URL_PROPS.has(key)) {
			if (typeof value === 'string' && isSafeUrl(value)) out[key] = value;
			return;
		}
		const sanitized = sanitizeValue(value, 0);
		if (sanitized !== undefined) out[key] = sanitized;
	});

	// external links never keep the opener
	if (out.target === '_blank') {
		out.rel = 'noopener noreferrer';
	}

	return out;
};

export type ChakraThingNode =
	| string
	| number
	| {
			type?: string;
			chakra?: string;
			props?: Record<string, unknown>;
			rawChildren?: ChakraThingNode[] | ChakraThingNode;
			children?: ChakraThingNode[] | ChakraThingNode;
	  };

export const isChakraThingNode = (value: unknown): value is ChakraThingNode =>
	!!value &&
	typeof value === 'object' &&
	!Array.isArray(value) &&
	(typeof (value as { chakra?: unknown }).chakra === 'string' || (value as { type?: unknown }).type === 'chakra');

type RenderState = { count: number };

const renderNode = (node: ChakraThingNode, key: number, depth: number, state: RenderState): React.ReactNode => {
	if (state.count >= MAX_NODES || depth > MAX_DEPTH) return null;
	state.count++;

	if (typeof node === 'string' || typeof node === 'number') {
		return node;
	}

	if (!node || typeof node !== 'object' || Array.isArray(node)) return null;

	const name = typeof node.chakra === 'string' ? node.chakra : 'Box';
	const Component = ALLOWED_COMPONENTS[name];
	if (!Component) {
		// unknown component: render children in a plain span so content shows
		return (
			<span key={key}>
				{renderChildren(node.rawChildren, depth + 1, state)}
				{renderChildren(node.children, depth + 1, state)}
			</span>
		);
	}

	const props = sanitizeProps(node.props);

	if (CHILDLESS_COMPONENTS.has(name)) {
		return <Component {...props} key={key} />;
	}

	return (
		<Component {...props} key={key}>
			{renderChildren(node.rawChildren, depth + 1, state)}
			{renderChildren(node.children, depth + 1, state)}
		</Component>
	);
};

const renderChildren = (
	children: ChakraThingNode[] | ChakraThingNode | undefined,
	depth: number,
	state: RenderState
): React.ReactNode => {
	if (children === undefined || children === null) return null;
	const list = Array.isArray(children) ? children : [children];
	return list.map((child, idx) => renderNode(child, idx, depth, state));
};

export const ChakraThingRenderer = ({ node }: { node: ChakraThingNode }) => {
	const state: RenderState = { count: 0 };
	return <>{renderNode(node, 0, 0, state)}</>;
};
