import React from 'react';
import { COLLECTION_SIZES, collectionWindow, type CollectionSize } from './collectionWindow';

export type CollectionFilter<T> = { key: string; label: string; value: (item: T) => string; options?: { value: string; label: string }[] };
export function CollectionSizeSelect({
	label,
	value,
	onChange
}: {
	label: string;
	value: CollectionSize;
	onChange: (value: CollectionSize) => void;
}) {
	return (
		<label className="tt-collection-field">
			Show
			<select
				aria-label={`Show ${label}`}
				value={value}
				onChange={(event) => onChange(event.target.value === 'infinite' ? 'infinite' : (Number(event.target.value) as CollectionSize))}
			>
				{COLLECTION_SIZES.map((size) => (
					<option key={size} value={size}>
						{size === 'infinite' ? 'Infinite scrolling' : size}
					</option>
				))}
			</select>
		</label>
	);
}

/** One window over the filtered collection, with optional cursor-backed loading. */
export function CollectionList<T>({
	label,
	items,
	searchText,
	filters = [],
	children,
	empty = 'No results.',
	query: externalQuery,
	onQueryChange,
	hideSearch = false,
	size: externalSize,
	onSizeChange,
	hideSize = false,
	hasMore = false,
	loadMore,
	loading = false,
	error = '',
	resetKey = ''
}: {
	label: string;
	items: T[];
	searchText: (item: T) => string;
	filters?: CollectionFilter<T>[];
	children: (items: T[]) => React.ReactNode;
	empty?: string;
	query?: string;
	onQueryChange?: (query: string) => void;
	hideSearch?: boolean;
	size?: CollectionSize;
	onSizeChange?: (size: CollectionSize) => void;
	hideSize?: boolean;
	hasMore?: boolean;
	loadMore?: () => Promise<unknown>;
	loading?: boolean;
	error?: string;
	resetKey?: string;
}) {
	const [localQuery, setLocalQuery] = React.useState('');
	const query = externalQuery ?? localQuery;
	const [selection, setSelection] = React.useState<Record<string, string>>({});
	const [localSize, setLocalSize] = React.useState<CollectionSize>(10);
	const size = externalSize ?? localSize;
	const [page, setPage] = React.useState(1);
	const [visible, setVisible] = React.useState(10);
	const root = React.useRef<HTMLDivElement>(null);
	const sentinel = React.useRef<HTMLDivElement>(null);
	const requesting = React.useRef(false);
	const normalized = query.trim().toLocaleLowerCase();
	const filtered = items.filter(
		(item) =>
			(!normalized || searchText(item).toLocaleLowerCase().includes(normalized)) &&
			filters.every((filter) => !selection[filter.key] || filter.value(item) === selection[filter.key])
	);
	const window = collectionWindow(filtered.length, size, page, visible);
	const filtering = !!normalized || Object.values(selection).some(Boolean);
	const filterKey = JSON.stringify(selection);
	React.useEffect(() => {
		setPage(1);
		setVisible(10);
	}, [query, filterKey, size, resetKey]);
	const requestMore = React.useCallback(async () => {
		if (!loadMore || !hasMore || loading || requesting.current) return;
		requesting.current = true;
		try {
			await loadMore();
		} finally {
			requesting.current = false;
		}
	}, [hasMore, loadMore, loading]);
	// Filtering traverses all remaining authorized cursor pages. Empty intermediate
	// pages must not hide a match in older comments/media. A failed page stops here.
	React.useEffect(() => {
		const needed = size === 'infinite' ? visible : page * window.pageSize;
		if (hasMore && !loading && !error && (filtering || filtered.length < needed)) void requestMore();
	}, [hasMore, loading, error, filtering, filtered.length, size, visible, page, window.pageSize, requestMore]);
	const more = window.end < filtered.length || hasMore;
	const goToPage = (next: number) => {
		setPage(next);
		root.current?.scrollIntoView({ block: 'start' });
	};
	const revealMore = React.useCallback(() => setVisible((value) => value + 10), []);
	React.useEffect(() => {
		if (size !== 'infinite' || !more || loading || error || !sentinel.current || typeof IntersectionObserver === 'undefined') return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					observer.disconnect();
					revealMore();
				}
			},
			{ rootMargin: '100px' }
		);
		observer.observe(sentinel.current);
		return () => observer.disconnect();
	}, [size, more, loading, error, window.end, revealMore]);
	return (
		<div ref={root} className="tt-collection" role="region" aria-label={`${label} results`}>
			<div className="tt-collection-controls">
				{!hideSearch && (
					<label className="tt-collection-search">
						<span className="tt-collection-sr">Search {label}</span>
						<input
							type="search"
							aria-label={`Search ${label}`}
							placeholder={`Search ${label.toLowerCase()}…`}
							value={query}
							onChange={(event) => {
								(onQueryChange || setLocalQuery)(event.target.value);
								setPage(1);
								setVisible(10);
							}}
						/>
					</label>
				)}
				{filters.map((filter) => {
					const options = filter.options || [...new Set(items.map(filter.value).filter(Boolean))].sort().map((value) => ({ value, label: value }));
					return (
						<label className="tt-collection-field" key={filter.key}>
							{filter.label}
							<select
								aria-label={`${label} ${filter.label}`}
								value={selection[filter.key] || ''}
								onChange={(event) => {
									setSelection((previous) => ({ ...previous, [filter.key]: event.target.value }));
									setPage(1);
									setVisible(10);
								}}
							>
								<option value="">All</option>
								{options.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</label>
					);
				})}
				{!hideSize && (
					<CollectionSizeSelect
						label={label}
						value={size}
						onChange={(next) => {
							(onSizeChange || setLocalSize)(next);
							setPage(1);
							setVisible(10);
						}}
					/>
				)}
				{filtering && (
					<button
						aria-label={`Clear filters for ${label}`}
						onClick={() => {
							(onQueryChange || setLocalQuery)('');
							setSelection({});
							setPage(1);
							setVisible(10);
						}}
					>
						Clear filters
					</button>
				)}
			</div>
			<div className="tt-collection-count" role="status" aria-live="polite">
				{filtered.length
					? `${window.start + 1}–${window.end} of ${filtered.length}${hasMore ? '+' : ''} results`
					: loading || hasMore
					? 'Looking for results…'
					: '0 results'}
				{filtering && hasMore && !error ? ' · Searching older records…' : ''}
			</div>
			{filtered.length ? (
				children(filtered.slice(window.start, window.end))
			) : (
				<p className="tt-collection-empty">
					{loading || hasMore ? 'More records are available below.' : filtering ? 'No results match these filters.' : empty}
				</p>
			)}
			{size === 'infinite' ? (
				<div ref={sentinel} className="tt-collection-more">
					{more ? (
						<button
							disabled={loading}
							onClick={() => {
								if (error) void requestMore();
								else revealMore();
							}}
						>
							{loading ? 'Loading more…' : 'Load more'}
						</button>
					) : (
						filtered.length > 0 && <span>All {filtered.length} results shown</span>
					)}
				</div>
			) : (
				(window.pages > 1 || hasMore) && (
					<nav className="tt-collection-pagination" aria-label={`${label} pagination`}>
						<button aria-label={`Previous page of ${label}`} disabled={window.page === 1} onClick={() => goToPage(window.page - 1)}>
							Previous
						</button>
						<label>
							Page{' '}
							<select aria-label={`Page of ${label}`} value={window.page} onChange={(event) => goToPage(Number(event.target.value))}>
								{Array.from({ length: window.pages }, (_, index) => (
									<option key={index} value={index + 1}>
										{index + 1}
									</option>
								))}
							</select>{' '}
							of {window.pages}
							{hasMore ? '+' : ''}
						</label>
						<button
							aria-label={`Next page of ${label}`}
							disabled={loading || (window.page === window.pages && !hasMore)}
							onClick={() => {
								if (window.page === window.pages && hasMore) {
									goToPage(window.page + 1);
									void requestMore();
								} else goToPage(window.page + 1);
							}}
						>
							Next
						</button>
					</nav>
				)
			)}
			{error && hasMore && (
				<button disabled={loading} onClick={() => void requestMore()}>
					Retry loading {label.toLowerCase()}
				</button>
			)}
		</div>
	);
}
