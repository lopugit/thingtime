/** Detect saved Collection/Map features that require the newer server contract. */
export function requiresCollectionPagingContract(value: unknown): boolean {
 const seen = new WeakSet<object>();
 const visit = (node: unknown): boolean => {
  if (!node || typeof node !== 'object' || seen.has(node)) return false;
  seen.add(node);
  if (Array.isArray(node)) return node.some(visit);
  const record = node as Record<string, unknown>;
  const props = record.props && typeof record.props === 'object' && !Array.isArray(record.props) ? record.props as Record<string, unknown> : {};
  const collection = record.type === 'collection' || record.tag === 'tt-collection' || record.chakra === 'Collection';
  const map = record.tag === 'tt-mapbox' || record.chakra === 'Mapbox';
  if (collection && ['total', 'totalPath', 'selectedKey', 'itemKey', 'revealSelected'].some(key => key in props)) return true;
  const source = props.source;
  if (collection && source && typeof source === 'object' && !Array.isArray(source) && ['offsetInput', 'limitInput', 'totalPath'].some(key => key in source)) return true;
  if (map && ['onSelectQueryParams', 'onRouteSelectQueryParams'].some(key => key in props)) return true;
  return Object.values(record).some(visit);
 };
 return visit(value);
}
