import type { WebpageBlock } from '../Builder/webpageBlocks';
const stack = { display: 'grid', gap: '12px', 'min-width': '0' };
const row = { display: 'flex', 'flex-wrap': 'wrap', gap: '12px', 'align-items': 'center', 'min-width': '0' };
const input = { 'min-height': '44px', padding: '8px 12px', 'min-width': '0', 'max-width': '100%', 'box-sizing': 'border-box', border: '1px solid var(--tt-border, #ddd)', 'border-radius': 'var(--tt-radius-sm, 9px)', background: 'var(--tt-card, white)', color: 'var(--tt-ink, #16161a)', font: 'inherit' };
const el = (id: string, tag: string, text = '', props: Record<string, unknown> = {}, children?: WebpageBlock[], css: Record<string, string> = {}): WebpageBlock => ({ id: `mongo-${id}`, type: 'element', tag, ...(text ? { text } : {}), props, ...(children ? { children } : {}), css: { 'overflow-wrap': 'anywhere', ...css } });
const text = (id: string, value: string, tag = 'p') => el(id, tag, value, {}, undefined, { margin: '0', 'line-height': '1.6', ...(tag === 'h2' ? { 'font-size': '20px', 'font-weight': '600' } : tag === 'h3' ? { 'font-size': '15px', 'font-weight': '600' } : tag === 'dt' ? { 'font-size': '12px', color: 'var(--tt-text, #5a5a66)' } : {}) });
const when = (id: string, arg: string, children: WebpageBlock[]): WebpageBlock => ({ id: `mongo-${id}`, type: 'condition', condition: { arg }, children });
const repeat = (id: string, path: string, children: WebpageBlock[]): WebpageBlock => ({ id: `mongo-${id}`, type: 'collection', props: { itemsPath: path, size: 'all', transparent: true }, children });
const action = (operation: string) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation } });
const button = (id: string, label: string, operation: string) => el(id, 'button', label, { type: 'button', disabled: '{inventory.busy}', ...action(operation) }, undefined, { ...input, cursor: 'pointer' });
const field = (id: string, label: string, binding: string) => el(id, 'div', '', {}, [text(`${id}-label`, label, 'dt'), text(`${id}-value`, binding, 'dd')], stack);
/** Authored layout and repeated templates only; runtime inventory never enters a saved Thing. */
export const MONGO_CONNECTION_INVENTORY_BLOCKS: WebpageBlock[] = [el('root', 'section', '', { 'aria-label': 'MongoDB connections' }, [
 text('heading', 'MongoDB connections', 'h2'),
 text('scope', 'Home database environment · {inventory.origin}'),
 text('intro', 'Understand which Thingtime runtimes opened database pools, why they exist, and where they were deployed.'),
 el('toolbar', 'div', '', {}, [
  el('search-label', 'label', '', {}, [text('search-copy', 'Search loaded sources', 'span'), el('search', 'input', '', { type: 'search', value: '{inventory.query}', placeholder: 'Branch, deployment, purpose or host', 'aria-label': 'Search loaded connection sources', ...action('inventory.search') }, undefined, input)], { ...stack, flex: '1 1 240px' }),
  el('freshness-label', 'label', '', {}, [text('freshness-copy', 'Snapshot freshness', 'span'), el('freshness', 'select', '', { value: '{inventory.freshness}', 'aria-label': 'Filter snapshot freshness', ...action('inventory.filter') }, [el('all', 'option', 'All snapshots', { value: 'all' }), el('current', 'option', 'Current runtime', { value: 'current' }), el('recent', 'option', 'Recent', { value: 'recent' }), el('stale', 'option', 'Stale', { value: 'stale' })], input)], stack),
  button('refresh', '{inventory.refreshLabel}', 'inventory.refresh')
 ], { ...row, 'align-items': 'flex-end' }),
 el('freshness-status', 'p', '{inventory.status}', { role: 'status', 'aria-live': 'polite' }, undefined, { margin: '0', color: 'var(--tt-muted, #777783)' }),
 when('error', 'inventory.error', [el('error-copy', 'p', '{inventory.error}', { role: 'alert' }, undefined, { color: 'var(--tt-error, #b83232)', margin: '0' })]),
 when('ready', 'inventory.ready', [
  el('totals', 'div', '', {}, [
   el('server-card', 'div', '', {}, [text('server-heading', 'Database-reported aggregate', 'h3'), text('server-total', '{inventory.serverSummary}'), text('server-note', '{inventory.serverNote}')], { ...stack, flex: '1 1 250px', padding: '16px', background: 'var(--tt-surface-alt, #f5f5f7)', 'border-radius': 'var(--tt-radius-md, 12px)' }),
   el('observed-card', 'div', '', {}, [text('observed-heading', 'Instrumented Thingtime pool snapshots', 'h3'), text('observed-total', '{inventory.observedSummary}'), text('observed-note', 'Driver pool counters exclude monitoring sockets. Historical snapshots are observations, not proof that sockets remain open.')], { ...stack, flex: '1 1 250px', padding: '16px', background: 'var(--tt-surface-alt, #f5f5f7)', 'border-radius': 'var(--tt-radius-md, 12px)' })
  ], { ...row, 'align-items': 'stretch' }),
  el('coverage', 'div', '', {}, [text('coverage-heading', 'Coverage is partial', 'h3'), repeat('coverage-notes', 'inventory.notes', [text('coverage-note', '{item.text}')])], stack),
  text('results', '{inventory.resultsLabel}'),
  when('empty', 'inventory.empty', [text('empty-copy', 'No loaded sources match these filters. Refresh to check for new observations, or load more sources if available.')]),
  repeat('sources', 'inventory.rows', [el('source-card', 'article', '', {}, [
   el('source-top', 'div', '', {}, [text('source-title', '{item.title}', 'h3'), text('source-state', '{item.state}', 'span')], { ...row, 'justify-content': 'space-between' }),
   text('source-reason', '{item.reason}'),
   text('source-counts', '{item.counts}'),
   text('source-observed', '{item.observed}'),
   when('source-url-present', 'item.hasUrl', [el('source-url', 'a', '{item.url}', { href: '{item.url}', target: '_blank', rel: 'noopener noreferrer' }, undefined, { color: 'var(--tt-accent, #805ad5)' })]),
   el('source-details', 'details', '', {}, [el('source-summary', 'summary', 'Source and pool details', {}, undefined, { cursor: 'pointer', 'min-height': '44px', 'line-height': '44px' }),
    el('source-fields', 'dl', '', {}, [field('creator', 'Created by', '{item.createdBy}'), field('purpose', 'Purpose', '{item.purpose}'), field('deployment', 'Environment / region', '{item.environment}'), field('deployment-id', 'Deployment ID', '{item.deploymentId}'), field('branch', 'Branch', '{item.branch}'), field('commit', 'Commit', '{item.commit}'), field('runtime', 'Runtime', '{item.runtimeId}'), field('started', 'Started', '{item.startedAt}')], { ...stack, margin: '0' }),
    repeat('pools', 'item.poolRows', [el('pool-card', 'div', '', {}, [text('pool-host', '{item.address}', 'strong'), text('pool-state', '{item.state}'), text('pool-counts', '{item.counts}'), text('pool-lifecycle', '{item.lifecycle}')], { ...stack, 'margin-top': '12px', padding: '12px', background: 'var(--tt-surface-alt, #f5f5f7)', 'border-radius': 'var(--tt-radius-sm, 9px)' })])
   ])
  ], { ...stack, padding: '20px', border: '1px solid var(--tt-border, #ececef)', 'border-radius': 'var(--tt-radius-lg, 16px)', background: 'var(--tt-card, white)' })]),
  when('more', 'inventory.hasMore', [button('load-more', 'Load more sources', 'inventory.more')])
 ])
], stack)];
