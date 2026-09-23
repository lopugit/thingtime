import React from 'react';
import { COLLECTION_SIZES, type CollectionSize } from '../Collections/collectionWindow';
import { CollectionList } from '../Collections/CollectionList';
import { componentScopeValue, createTemplateResolver } from '../ComponentsLibrary/componentTemplate';
import { HtmlThingRenderer } from '../Kinds/HtmlThingRenderer';
import { ComponentDataScope } from './ComponentSelect';

// Stack collections using a shared branch allowance rather than limiting apps
// to two levels. Visible siblings split their parent's allowance; pagination
// gets a fresh pass and cannot accumulate mutable resolver state.
const Nesting = React.createContext({ depth: 0, rows: 1000 });
export function ComponentCollection({
	itemsPath,
	itemTemplate,
	label,
	empty,
	className,
	filters,
	hideSearch,
	hideSize,
	size
}: Record<string, unknown>) {
	const scope = React.useContext(ComponentDataScope),
		budget = React.useContext(Nesting);
	const data = typeof itemsPath === 'string' ? componentScopeValue(scope, itemsPath) : undefined;
	if (Array.isArray(data) && data.length > 10000) return <p role="alert">Filter or page the source to at most 10,000 records.</p>;
	const items: Record<string, any>[] = Array.isArray(data) ? data.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) : [];
	const positions = new Map(items.map((item, index) => [item, index]));
	if (budget.depth >= 32) return <p role="alert">This collection exceeds the nested rendering budget.</p>;
	const specs = Array.isArray(filters)
		? filters
				.slice(0, 10)
				.filter((filter) => filter && typeof filter === 'object' && typeof filter.path === 'string' && typeof filter.label === 'string')
		: [];
	return (
		<>
			<CollectionList<Record<string, any>>
				label={typeof label === 'string' ? label : 'Records'}
				items={items}
				searchText={(item) => JSON.stringify(item)}
				empty={typeof empty === 'string' ? empty : 'Nothing here yet.'}
				hideSearch={hideSearch === true}
				hideSize={hideSize === true}
				size={
					size === 'infinite' ? 'infinite' : COLLECTION_SIZES.includes(Number(size) as CollectionSize) ? (Number(size) as CollectionSize) : undefined
				}
				filters={specs
					.filter((spec) => items.some((item) => componentScopeValue(item, spec.path)))
					.map((spec) => ({
						key: spec.path,
						label: spec.label,
						value: (item) => String(componentScopeValue(item, spec.path) ?? ''),
						...(Array.isArray(spec.options)
							? {
									options: spec.options
										.filter(
											(option: unknown): option is { value: string; label: string } =>
												!!option &&
												typeof option === 'object' &&
												typeof (option as any).value === 'string' &&
												typeof (option as any).label === 'string'
										)
										.slice(0, 200)
										.map((option: { value: string; label: string }) => ({ value: option.value.slice(0, 500), label: option.label.slice(0, 200) }))
							  }
							: {})
					}))}
			>
				{(visible) => {
					if (visible.length > budget.rows) return <p role="alert">Reduce the page size to fit the nested rendering budget.</p>;
					const resolveRow = createTemplateResolver();
					const nextBudget = { depth: budget.depth + 1, rows: Math.floor((budget.rows - visible.length) / Math.max(1, visible.length)) };
					return (
						<div className={typeof className === 'string' ? className : undefined}>
							{visible.map((item, index) => {
								const position = positions.get(item) ?? index;
								const rowScope = {
									...scope,
									item,
									index,
									collection: {
										index: position,
										previous: items[position - 1],
										next: items[position + 1],
										afterNext: items[position + 2],
										count: items.length
									}
								};
								return (
									<Nesting.Provider key={String(item?.id ?? index)} value={nextBudget}>
										<ComponentDataScope.Provider value={rowScope}>
											<HtmlThingRenderer node={resolveRow(itemTemplate, rowScope) as any} />
										</ComponentDataScope.Provider>
									</Nesting.Provider>
								);
							})}
						</div>
					);
				}}
			</CollectionList>
		</>
	);
}
