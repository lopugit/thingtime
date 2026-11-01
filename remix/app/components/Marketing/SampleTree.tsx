import React from 'react';

import { RAINBOW_TEXT_STYLE } from '~/components/Marketing/marketingTheme';

// A pure-React (no Chakra) renderer for the "shape" of a use case: a
// JSON-like value drawn in Thingtime's tree idiom (rainbow depth guides, emoji
// type chips, mono keys, count pills, Yes/No booleans). It reads only --mk-*
// variables so it re-cuts with the page's trend, and it stays Chakra-free so
// node --test can render it with renderToStaticMarkup without a provider.

/** The five brand rainbow stops (docs/design/DESIGN_LANGUAGE.md). */
export const RAINBOW = ['#f34a4a', '#ffbc48', '#58ca70', '#47b5e6', '#a555e8'] as const;

/** Rows deeper than this render collapsed (a count pill, no children). */
export const MAX_TREE_DEPTH = 6;
/** Children rendered per node before a "… n more" row. */
export const MAX_TREE_CHILDREN = 24;

export type ValueKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export const KIND_CHIPS: Record<ValueKind, string> = {
	object: '📦',
	array: '📚',
	string: '💬',
	number: '💯',
	boolean: '🌗',
	null: '❓'
};

export const kindOf = (value: unknown): ValueKind => {
	if (value === null || value === undefined) return 'null';
	if (Array.isArray(value)) return 'array';
	switch (typeof value) {
		case 'string':
			return 'string';
		case 'number':
		case 'bigint':
			return 'number';
		case 'boolean':
			return 'boolean';
		case 'object':
			return 'object';
		default:
			return 'string';
	}
};

const MONO = 'var(--tt-font-mono, "JetBrains Mono", ui-monospace, Menlo, monospace)';

/** rainbow[index % 5] as an rgba() string at the given alpha. */
export const rainbowAlpha = (index: number, alpha: number) => {
	const hex = RAINBOW[((index % RAINBOW.length) + RAINBOW.length) % RAINBOW.length].slice(1);
	const r = parseInt(hex.slice(0, 2), 16);
	const g = parseInt(hex.slice(2, 4), 16);
	const b = parseInt(hex.slice(4, 6), 16);
	return `rgba(${r},${g},${b},${alpha})`;
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Wraps the first whole-word, case-insensitive occurrence of `highlight`
 * inside `title` in an animated rainbow span. Returns the plain title when
 * there is nothing to highlight, so callers can drop the result straight
 * into a heading.
 */
export const highlightTitle = (title: string, highlight?: string): React.ReactNode => {
	const needle = (highlight ?? '').trim();
	if (!title || !needle) return title;
	const body = escapeRegExp(needle).replace(/\s+/g, '\\s+');
	// A "word" boundary that also works next to emoji and curly punctuation:
	// the match must not be glued to a letter or digit on either side.
	const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${body})(?![\\p{L}\\p{N}])`, 'iu');
	const match = pattern.exec(title);
	if (!match) return title;
	const start = match.index + match[1].length;
	const end = start + match[2].length;
	return (
		<>
			{start > 0 ? title.slice(0, start) : null}
			<span className="mk-highlight" data-testid="marketing-highlight" style={RAINBOW_TEXT_STYLE}>
				{title.slice(start, end)}
			</span>
			{end < title.length ? title.slice(end) : null}
		</>
	);
};

const entriesOf = (value: unknown): [string, unknown][] => {
	if (Array.isArray(value)) return value.map((item, index) => [String(index), item]);
	if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>);
	return [];
};

export const countLabel = (value: unknown): string | null => {
	const kind = kindOf(value);
	if (kind === 'array') {
		const size = (value as unknown[]).length;
		return size === 1 ? '1 item' : `${size} items`;
	}
	if (kind === 'object') {
		const size = Object.keys(value as Record<string, unknown>).length;
		return size === 1 ? '1 key' : `${size} keys`;
	}
	return null;
};

export const formatLeaf = (value: unknown): string => {
	switch (kindOf(value)) {
		case 'string':
			return `“${String(value)}”`;
		case 'number':
			return String(value);
		case 'boolean':
			return value ? 'Yes' : 'No';
		case 'null':
			return 'empty';
		default:
			return '';
	}
};

const chipStyle: React.CSSProperties = {
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	width: 22,
	height: 22,
	flex: 'none',
	borderRadius: 6,
	background: 'var(--mk-tint)',
	fontSize: 12,
	lineHeight: 1
};

const keyStyle: React.CSSProperties = {
	fontFamily: MONO,
	fontSize: 13,
	color: 'var(--mk-muted)',
	overflowWrap: 'anywhere'
};

const pillStyle: React.CSSProperties = {
	fontFamily: MONO,
	fontSize: 11,
	lineHeight: 1,
	padding: '4px 7px',
	borderRadius: 'var(--mk-radius-sm)',
	background: 'var(--mk-tint)',
	color: 'var(--mk-muted)',
	whiteSpace: 'nowrap'
};

const leafStyle: React.CSSProperties = {
	fontSize: 14,
	lineHeight: 1.5,
	color: 'var(--mk-ink)',
	overflowWrap: 'anywhere',
	minWidth: 0
};

const TreeRow = ({ name, value, depth }: { name: string | null; value: unknown; depth: number }) => {
	const kind = kindOf(value);
	const branch = kind === 'object' || kind === 'array';
	const count = countLabel(value);
	const children = branch ? entriesOf(value) : [];
	const collapsed = branch && depth >= MAX_TREE_DEPTH;
	const shown = collapsed ? [] : children.slice(0, MAX_TREE_CHILDREN);
	const hidden = collapsed ? 0 : children.length - shown.length;
	const guide = rainbowAlpha(depth, 0.34);
	return (
		<li
			className="mk-tree-row"
			data-depth={depth}
			data-kind={kind}
			style={{ listStyle: 'none', margin: 0, padding: 0, borderLeft: `2px solid ${guide}`, paddingLeft: 10 }}
		>
			<div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 30, flexWrap: 'wrap' }}>
				<span className="mk-tree-chip" role="img" aria-label={kind} title={kind} style={chipStyle}>
					{KIND_CHIPS[kind]}
				</span>
				{name !== null ? (
					<span className="mk-tree-key" style={keyStyle}>
						{name}
					</span>
				) : null}
				{count ? (
					<span className="mk-tree-count" style={pillStyle}>
						{count}
					</span>
				) : null}
				{collapsed ? (
					<span className="mk-tree-collapsed" style={{ ...pillStyle, background: 'transparent' }}>
						…
					</span>
				) : null}
				{!branch ? (
					<span className="mk-tree-value" style={leafStyle}>
						{formatLeaf(value)}
					</span>
				) : null}
			</div>
			{shown.length ? (
				<ul className="mk-tree-children" style={{ listStyle: 'none', margin: 0, padding: 0, paddingLeft: 18 }}>
					{shown.map(([childName, childValue], childIndex) => (
						<TreeRow key={`${childName}-${childIndex}`} name={childName} value={childValue} depth={depth + 1} />
					))}
					{hidden > 0 ? (
						<li
							className="mk-tree-more"
							data-testid="marketing-sample-more"
							data-depth={depth + 1}
							style={{ listStyle: 'none', margin: 0, padding: '4px 0 4px 10px', borderLeft: `2px solid ${rainbowAlpha(depth + 1, 0.34)}` }}
						>
							<span style={{ ...keyStyle, fontSize: 12 }}>… {hidden} more</span>
						</li>
					) : null}
				</ul>
			) : null}
		</li>
	);
};

/**
 * Renders a JSON-like value as a Thingtime thing tree. The root's own entries
 * are the first rows; a primitive root renders as a single unkeyed row.
 */
export const SampleTree = ({ value, depth = 0 }: { value: unknown; depth?: number }) => {
	const kind = kindOf(value);
	const branch = kind === 'object' || kind === 'array';
	const entries = branch ? entriesOf(value) : [];
	const shown = entries.slice(0, MAX_TREE_CHILDREN);
	const hidden = entries.length - shown.length;
	return (
		<ul
			className="mk-sample-tree"
			data-testid="marketing-sample-tree"
			style={{ listStyle: 'none', margin: 0, padding: 0, fontFamily: 'var(--mk-font)' }}
		>
			{branch ? (
				shown.map(([name, child], index) => <TreeRow key={`${name}-${index}`} name={name} value={child} depth={depth} />)
			) : (
				<TreeRow name={null} value={value} depth={depth} />
			)}
			{branch && !shown.length ? (
				<li
					className="mk-tree-empty"
					style={{ listStyle: 'none', margin: 0, padding: '4px 0 4px 10px', borderLeft: `2px solid ${rainbowAlpha(depth, 0.34)}` }}
				>
					<span style={keyStyle}>{kind === 'array' ? 'empty list' : 'nothing here yet'}</span>
				</li>
			) : null}
			{hidden > 0 ? (
				<li
					className="mk-tree-more"
					data-testid="marketing-sample-more"
					data-depth={depth}
					style={{ listStyle: 'none', margin: 0, padding: '4px 0 4px 10px', borderLeft: `2px solid ${rainbowAlpha(depth, 0.34)}` }}
				>
					<span style={{ ...keyStyle, fontSize: 12 }}>… {hidden} more</span>
				</li>
			) : null}
		</ul>
	);
};
