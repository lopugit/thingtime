import React from 'react';
import { NativeControlsEnabled } from './NativeComponentControls';
import { componentScopeValue } from '../ComponentsLibrary/componentTemplate';

// Native controls can page a reference into already-authorized source data
// without expanding thousands of option nodes in the template resolver.
export const ComponentDataScope = React.createContext<Record<string, unknown>>({});
export function selectionOptions(data: unknown, valuePath = 'id', labelPath = 'title') {
	if (!Array.isArray(data)) return [];
	if (data.length > 10000) throw new Error('Filter or page the source to at most 10,000 choices.');
	const seen = new Set<string>();
	return data.flatMap((item) => {
		if (!item || typeof item !== 'object') return [];
		const id = componentScopeValue(item, valuePath),
			title = componentScopeValue(item, labelPath);
		if ((typeof id !== 'string' && typeof id !== 'number') || String(id).length > 500 || seen.has(String(id))) return [];
		seen.add(String(id));
		return [{ value: String(id), label: typeof title === 'string' || typeof title === 'number' ? String(title).slice(0, 200) : String(id) }];
	});
}
export function ComponentSelect({
	name,
	optionsPath,
	valuePath,
	labelPath,
	value,
	title,
	required
}: {
	name?: unknown;
	optionsPath?: unknown;
	valuePath?: unknown;
	labelPath?: unknown;
	value?: unknown;
	title?: unknown;
	required?: unknown;
}) {
	const enabled = React.useContext(NativeControlsEnabled),
		scope = React.useContext(ComponentDataScope);
	const [selected, setSelected] = React.useState(typeof value === 'string' ? value : '');
	const [query, setQuery] = React.useState(''),
		[page, setPage] = React.useState(0);
	const field = typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(name) ? name : undefined;
	const path = (input: unknown, fallback: string) => (typeof input === 'string' && /^[A-Za-z_][A-Za-z0-9_.-]{0,159}$/.test(input) ? input : fallback);
	const data = componentScopeValue(scope, path(optionsPath, ''));
	let options: ReturnType<typeof selectionOptions> = [],
		error = '';
	try {
		options = selectionOptions(data, path(valuePath, 'id'), path(labelPath, 'title'));
	} catch (failure) {
		error = (failure as Error).message;
	}
	const matches = options.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()));
	const current = Math.min(page, Math.max(0, Math.ceil(matches.length / 20) - 1));
	const visible = matches.slice(current * 20, current * 20 + 20);
	const chosen = options.find((option) => option.value === selected);
	const label = typeof title === 'string' ? title.slice(0, 120) : 'Choose a record';
	return (
		<div data-tt-native-control style={{ display: 'grid', gap: 8, minWidth: 0 }}>
			<input
				type="search"
				aria-label={`Search ${label}`}
				value={query}
				onChange={(event) => {
					setQuery(event.target.value);
					setPage(0);
				}}
				disabled={!enabled}
				placeholder={`Search ${label.toLowerCase()}`}
				style={{ width: '100%', minWidth: 0, padding: 8, boxSizing: 'border-box' }}
			/>
			<select
				name={field}
				aria-label={label}
				required={required === true}
				value={selected}
				onChange={(event) => setSelected(event.target.value)}
				disabled={!enabled}
				style={{ width: '100%', minWidth: 0, padding: 10, boxSizing: 'border-box' }}
			>
				<option value="">Choose…</option>
				{selected && !visible.some((option) => option.value === selected) ? (
					<option value={selected}>{chosen?.label || selected} (selected)</option>
				) : null}
				{visible.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
			{chosen ? <p style={{ margin: 0, overflowWrap: 'anywhere' }}>{chosen.label}</p> : null}
			<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
				<button type="button" disabled={!enabled || current === 0} onClick={() => setPage(current - 1)}>
					Previous choices
				</button>
				<span>
					{matches.length} choices · page {current + 1}
				</span>
				<button type="button" disabled={!enabled || (current + 1) * 20 >= matches.length} onClick={() => setPage(current + 1)}>
					More choices
				</button>
			</div>
			{error ? <p role="alert">{error}</p> : null}
		</div>
	);
}
