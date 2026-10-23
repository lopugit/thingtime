import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';

import {
	AddChildButton,
	ConceptCrumbs,
	DeleteButton,
	KindFlip,
	LeafValueEditor,
	useConceptLayout,
	useContainerWidth
} from './conceptBits';
import type { ConceptViewerProps } from './conceptBits';
import {
	childCountLabel,
	childKeysOf,
	getAtPath,
	humanizeKey,
	isBranch,
	keyEmoji,
	summarizeThing,
	useThingMutations
} from './conceptData';
import type { ThingPath } from './conceptData';

// Concept 01 — Columns. Finder-style Miller columns: every level of nesting is
// a column, the selection trail reads left → right, and the last column is a
// detail pane for the selected value. On narrow containers it collapses to a
// single column with push navigation (the iOS Settings pattern), so the same
// data walk works on a phone.

const COLUMN_WIDTH = 220;

const ColumnRow = (props: {
	active: boolean;
	branch: boolean;
	label: string;
	emoji: string;
	preview: string;
	onSelect: () => void;
	onDelete?: () => void;
}) => (
	<Flex
		as="button"
		type="button"
		alignItems="center"
		background={props.active ? 'var(--tt-surface-alt, #f5f5f7)' : 'transparent'}
		borderRadius="var(--tt-radius-sm, 9px)"
		columnGap={2}
		cursor="pointer"
		paddingX={2.5}
		paddingY={2}
		textAlign="left"
		transition="background 120ms ease"
		width="100%"
		onClick={props.onSelect}
		_hover={{ background: props.active ? 'var(--tt-surface-alt, #f5f5f7)' : 'var(--tt-surface-hover, #ececee)' }}
		role="group"
	>
		<Text fontSize="15px" flexShrink={0} aria-hidden>
			{props.emoji}
		</Text>
		<Box flex="1" minWidth={0}>
			<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={650} noOfLines={1}>
				{props.label}
			</Text>
			<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" noOfLines={1}>
				{props.preview}
			</Text>
		</Box>
		{props.onDelete ? <DeleteButton onClick={props.onDelete} /> : null}
		{props.branch ? (
			<Text color="var(--tt-faint, #b6b6c0)" fontSize="xs" flexShrink={0}>
				›
			</Text>
		) : null}
	</Flex>
);

export const MillerColumnsViewer = (props: ConceptViewerProps & { height?: string }) => {
	const { thing, onThingChange, edit } = props;
	const mutations = useThingMutations(thing, onThingChange);
	const [containerRef, width] = useContainerWidth<HTMLDivElement>();
	const layout = useConceptLayout(props.variant, width);

	const [selectedPath, setSelectedPath] = React.useState<ThingPath>([]);
	const scrollRef = React.useRef<HTMLDivElement>(null);

	// selection can go stale after deletes — trim to the deepest valid prefix
	const path = React.useMemo(() => {
		const valid: ThingPath = [];
		let current: unknown = thing;
		for (const segment of selectedPath) {
			if (!isBranch(current) || !(childKeysOf(current) as Array<string | number>).some((key) => String(key) === String(segment))) break;
			valid.push(segment);
			current = (current as Record<string, unknown>)[segment as string];
		}
		return valid;
	}, [thing, selectedPath]);

	React.useEffect(() => {
		// keep the newest column in view
		scrollRef.current?.scrollTo({ left: scrollRef.current.scrollWidth, behavior: 'smooth' });
	}, [path.length]);

	const selectAt = (depth: number, key: string | number) => {
		setSelectedPath([...path.slice(0, depth), key]);
	};

	const renderColumnList = (branchPath: ThingPath, depth: number) => {
		const branch = getAtPath(thing, branchPath);
		const keys = childKeysOf(branch);

		return (
			<Flex flexDirection="column" rowGap={0.5} padding={2}>
				{keys.map((key) => {
					const childPath = [...branchPath, key];
					const child = getAtPath(thing, childPath);
					const active = String(path[depth]) === String(key) && path.length > depth;

					return (
						<ColumnRow
							key={String(key)}
							active={active}
							branch={isBranch(child)}
							emoji={keyEmoji(key, child)}
							label={humanizeKey(key)}
							preview={isBranch(child) ? childCountLabel(child) : summarizeThing(child, 34)}
							onSelect={() => selectAt(depth, key)}
							onDelete={edit ? () => mutations.deleteValue(childPath) : undefined}
						/>
					);
				})}
				{!keys.length ? (
					<Text color="var(--tt-faint, #b6b6c0)" fontSize="sm" paddingX={2.5} paddingY={2}>
						Nothing here yet
					</Text>
				) : null}
				{edit ? (
					<Box paddingX={2.5} paddingY={2}>
						<AddChildButton onClick={() => mutations.addChild(branchPath)} label="Grow" />
					</Box>
				) : null}
			</Flex>
		);
	};

	const renderDetail = (detailPath: ThingPath) => {
		const value = getAtPath(thing, detailPath);
		const key = detailPath[detailPath.length - 1];

		return (
			<Flex flexDirection="column" padding={4} rowGap={3} minWidth={0}>
				<Flex alignItems="center" columnGap={2}>
					<Text fontSize="22px" aria-hidden>
						{keyEmoji(key ?? 'thing', value)}
					</Text>
					<Text color="var(--tt-ink, #16161a)" fontSize="md" fontWeight={750} noOfLines={2}>
						{key !== undefined ? humanizeKey(key) : 'Everything'}
					</Text>
				</Flex>
				<LeafValueEditor value={value} edit={edit} onValueChange={(next) => mutations.setValue(detailPath, next)} />
				<Text color="var(--tt-faint, #b6b6c0)" fontFamily="var(--tt-font-mono, monospace)" fontSize="11px" wordBreak="break-all">
					{['thing', ...detailPath].join('.')}
				</Text>
			</Flex>
		);
	};

	// columns: root + one per branch segment; a trailing leaf gets a detail pane
	const columns: Array<{ id: string; node: React.ReactNode }> = [];
	const branchDepths: ThingPath[] = [[]];
	for (let i = 0; i < path.length; i++) {
		const prefix = path.slice(0, i + 1);
		if (isBranch(getAtPath(thing, prefix))) {
			branchDepths.push(prefix);
		}
	}

	branchDepths.forEach((branchPath, depth) => {
		const branchValue = getAtPath(thing, branchPath);
		columns.push({
			id: `col-${branchPath.join('.') || 'root'}`,
			node: (
				<KindFlip key={`flip-${branchPath.join('.')}`} thing={branchValue} defaultRendered={false}>
					{renderColumnList(branchPath, depth)}
				</KindFlip>
			)
		});
	});

	const selectedValue = getAtPath(thing, path);
	const selectionIsLeaf = path.length > 0 && !isBranch(selectedValue);
	if (selectionIsLeaf) {
		columns.push({ id: `detail-${path.join('.')}`, node: renderDetail(path) });
	}

	if (layout === 'mobile') {
		// push navigation: only the deepest pane is visible + breadcrumbs
		const last = columns[columns.length - 1];

		return (
			<Box ref={containerRef} width="100%">
				<Flex alignItems="center" columnGap={2} marginBottom={3}>
					{path.length ? (
						<Box
							as="button"
							type="button"
							background="var(--tt-surface-alt, #f5f5f7)"
							borderRadius="999px"
							color="var(--tt-ink, #16161a)"
							cursor="pointer"
							fontSize="13px"
							fontWeight={800}
							paddingX="10px"
							paddingY="4px"
							onClick={() => setSelectedPath(path.slice(0, -1))}
						>
							← Back
						</Box>
					) : null}
					<ConceptCrumbs path={path} onNavigate={setSelectedPath} />
				</Flex>
				<Box
					background="var(--tt-card, #ffffff)"
					border="1px solid var(--tt-border, #ececef)"
					borderRadius="var(--tt-radius-lg, 16px)"
					boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0,0,0,0.05))"
					padding={selectionIsLeaf ? 0 : 1}
				>
					{last.node}
				</Box>
			</Box>
		);
	}

	return (
		<Box ref={containerRef} width="100%">
			<Box marginBottom={3}>
				<ConceptCrumbs path={path} onNavigate={setSelectedPath} />
			</Box>
			<Flex
				ref={scrollRef}
				border="1px solid var(--tt-border, #ececef)"
				borderRadius="var(--tt-radius-lg, 16px)"
				background="var(--tt-card, #ffffff)"
				boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0,0,0,0.05))"
				overflowX="auto"
				minHeight={props.height || '300px'}
			>
				{columns.map((column, idx) => (
					<Box
						key={column.id}
						borderRight={idx === columns.length - 1 ? 'none' : '1px solid var(--tt-border-light, #f0f0f2)'}
						flexShrink={0}
						width={idx === columns.length - 1 && selectionIsLeaf ? `${COLUMN_WIDTH + 60}px` : `${COLUMN_WIDTH}px`}
						maxHeight="420px"
						overflowY="auto"
					>
						{column.node}
					</Box>
				))}
			</Flex>
		</Box>
	);
};
