import React from 'react';
import { NativeControlsEnabled, ComponentLocalControl } from './NativeComponentControls';
import { componentScopeValue } from '../ComponentsLibrary/componentTemplate';

// Native controls can page a reference into already-authorized source data
// without expanding thousands of option nodes in the template resolver.
export const ComponentDataScope = React.createContext<Record<string, unknown>>({});
export function selectionPatch(fills: unknown, item: unknown): Record<string, string | number | boolean> {
	const values: Record<string, string | number | boolean> = {};
	if (!Array.isArray(fills) || !item || typeof item !== 'object' || Array.isArray(item)) return values;
	for (const fill of fills.slice(0, 16)) {
		if (!fill || typeof fill !== 'object' || typeof fill.key !== 'string' || typeof fill.path !== 'string') continue;
		if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(fill.key) || ['__proto__', 'constructor', 'prototype'].includes(fill.key)) continue;
		if (fill.whenEmpty === true && fill.current !== undefined && fill.current !== null && fill.current !== '') continue;
		const value = componentScopeValue(item as Record<string, unknown>, fill.path);
		if ((typeof value === 'string' && value.length <= 2000) || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean')
			values[fill.key] = value;
	}
	return values;
}
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
	required,
	stateKey,
	compact,
	filterPath,
	filterValue,
	clear,
	fills
}: {
	name?: unknown;
	optionsPath?: unknown;
	valuePath?: unknown;
	labelPath?: unknown;
	value?: unknown;
	title?: unknown;
	required?: unknown;
	stateKey?: unknown;
	compact?: unknown;
	filterPath?: unknown;
	filterValue?: unknown;
	clear?: unknown;
	fills?: unknown;
}) {
	const enabled = React.useContext(NativeControlsEnabled),
		scope = React.useContext(ComponentDataScope);
	const onLocal = React.useContext(ComponentLocalControl);
	const [selected, setSelected] = React.useState(typeof value === 'string' ? value : '');
	const [query, setQuery] = React.useState(''),
		[page, setPage] = React.useState(0);
	const field = typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(name) ? name : undefined;
	const local = typeof stateKey === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(stateKey) ? stateKey : '';
	const selection = local ? (typeof value === 'string' ? value : '') : selected;
	const path = (input: unknown, fallback: string) => (typeof input === 'string' && /^[A-Za-z_][A-Za-z0-9_.-]{0,159}$/.test(input) ? input : fallback);
	const data = componentScopeValue(scope, path(optionsPath, ''));
	let options: ReturnType<typeof selectionOptions> = [],
		error = '';
	try {
		const filtered =
			typeof filterPath === 'string' && filterValue !== undefined && Array.isArray(data)
				? data.filter((item) => componentScopeValue(item, path(filterPath, '')) === filterValue)
				: data;
		options = selectionOptions(filtered, path(valuePath, 'id'), path(labelPath, 'title'));
	} catch (failure) {
		error = (failure as Error).message;
	}
	const matches = options.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()));
	const current = Math.min(page, Math.max(0, Math.ceil(matches.length / 20) - 1));
	const visible = matches.slice(current * 20, current * 20 + 20);
	const chosen = options.find((option) => option.value === selection);
	const label = typeof title === 'string' ? title.slice(0, 120) : 'Choose a record';
	const change = (event: React.ChangeEvent<HTMLSelectElement>) => {
		const next = event.target.value;
		setSelected(next);
		if (!enabled || !next || !Array.isArray(data)) return;
		const item = data.find((entry) => String(componentScopeValue(entry, path(valuePath, 'id'))) === next);
		const values = selectionPatch(fills, item);
		if (Object.keys(values).length) onLocal?.({ op: 'patch', values });
	};
	if (compact === true && options.length <= 160)
		return (
			<select
				name={field}
				aria-label={label}
				required={required === true}
				value={selection}
				data-tt-action={local ? '$ui' : undefined}
				data-tt-action-inputs={local ? JSON.stringify({ op: 'set', key: local, ...(Array.isArray(clear) ? { clear } : {}) }) : undefined}
				onChange={change}
				disabled={!enabled}
			>
				<option value="">Choose…</option>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		);
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
				value={selection}
				data-tt-action={local ? '$ui' : undefined}
				data-tt-action-inputs={local ? JSON.stringify({ op: 'set', key: local, ...(Array.isArray(clear) ? { clear } : {}) }) : undefined}
				onChange={change}
				disabled={!enabled}
				style={{ width: '100%', minWidth: 0, padding: 10, boxSizing: 'border-box' }}
			>
				<option value="">Choose…</option>
				{selection && !visible.some((option) => option.value === selection) ? (
					<option value={selection}>{chosen?.label || selection} (selected)</option>
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
