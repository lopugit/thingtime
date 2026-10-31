import { compositionAttachmentIds } from '../../api/utils/actions/compositionMediaCore';
import { rewriteComposition } from '../../api/utils/actions/forkCompositionCore';
import assert from 'node:assert/strict';
import test from 'node:test';
import { expandedComponentBlock, templateEachRows, templateEachRowScope, templateToBlocks, resolveBlockProps } from './templateBlocks';
import { copyBoundedJson } from '../../utils/boundedJson';
import { sanitizeWebpageBlocks } from '../../schemas/registry';
import { compositionReferences } from '../../api/utils/actions/sharedCompositionCore';
import { duplicateBlock, moveBlock, findBlock, requiresEditableIntrinsicContract } from './webpageBlocks';
let next = 0;
const id = (kind: string) => `${kind}-${++next}`;

test('expanded controls and repeated fields survive save with independent identities', () => {
 const children = templateToBlocks({tag:'section', children:[
  {tag:'h1',children:['Inventory']},
  {tag:'button',ttAction:'refresh-items',ttActionInputs:{id:'{item.id}'},children:['Refresh']},
  {tag:'tt-collection',props:{itemsPath:'result.items',size:'all',itemTemplate:{ttTemplate:{tag:'article',children:[{tag:'img',props:{src:'{item.iconDataUrl}',alt:'{item.program}'}},{tag:'span',children:['{item.name}']}]}}}}
 ]}, id);
 const tree = [{id:'scope',type:'container',args:{deviceId:'mac'},source:{action:'read-items'},children}];
 const saved = sanitizeWebpageBlocks(tree);
 assert.equal(saved.ok,true);
 if (!saved.ok) return;
 assert.deepEqual(saved.blocks[0].args,{deviceId:'mac'});
 const section:any=(saved.blocks[0].children as any[])[0];
 assert.equal(section.children[2].props.size,'all');
 assert.equal(section.children[2].children[0].children[0].tag,'img');
 assert.deepEqual(section.children[1].props['data-tt-action-inputs'],{id:'{item.id}'});
 assert.deepEqual(compositionReferences(['webpage'],{blocks:saved.blocks}).map(x=>x.ref).sort(),['read-items','refresh-items']);
 const title = section.children[0].id;
 const duplicated = duplicateBlock(children, title);
 assert.equal(duplicated[0].children?.length,4);
});

test('conditions retain both editable branches and unsupported executable operators fail closed',()=>{
 const blocks=templateToBlocks({ttIf:{arg:'result.ready',equals:true,then:{tag:'p',children:['Ready']},else:{tag:'p',children:['Waiting']}}},id);
 assert.equal(blocks.length,2);
 assert.equal(blocks[1].condition?.negate,true);
 assert.throws(()=>templateToBlocks({ttMerge:[{tag:'p'}]},id));
});

test('large authored trees validate without the old 120 block cap, cycles fail',()=>{
 const blocks=Array.from({length:300},(_,i)=>({id:`field-${i}`,type:'element',tag:'p',text:`Field ${i}`}));
 assert.equal(sanitizeWebpageBlocks(blocks).ok,true);
 const cycle:any={id:'cycle',type:'container',children:[]};cycle.children.push(cycle);
 assert.equal(sanitizeWebpageBlocks([cycle]).ok,false);
});

test('intrinsic exact bindings preserve false, zero and true DOM property types',()=>{
 const props=resolveBlockProps({disabled:'{result.busy}',checked:'{result.checked}',open:'{result.busy}',value:'{result.count}',title:'Count: {result.count}'},{result:{busy:false,checked:true,count:0}});
 assert.deepEqual(props,{disabled:false,checked:true,open:false,value:0,title:'Count: 0'});
 assert.equal(resolveBlockProps({disabled:'{result.busy}'},{result:{busy:true}}).disabled,true);
});

test('deep editable trees retain inherited stored media and remap nested Action bindings',()=>{
 const leaf:any={id:'leaf',type:'element',tag:'button',props:{'data-tt-action':'do-{target}'}};
 let child:any=leaf;
 for(let i=0;i<24;i++) child={id:`nested-${i}`,type:'element',tag:'div',children:[child]};
 const root:any={id:'root',type:'container',args:{target:'saved',image:'/api/v1/attachments/content?id=att_source',item:'private',pendingAction:'private'},children:[...Array.from({length:1800},(_,i)=>({id:`p-${i}`,type:'element',tag:'p'})),child,{id:'image',type:'element',tag:'img',props:{src:'{image}'}},{id:'runtime',type:'element',tag:'img',props:{src:'/api/v1/attachments/content?id={item}'}},{id:'pending',type:'element',tag:'img',props:{src:'/api/v1/attachments/content?id={pendingAction}'}}]};
 const crystal={blocks:[root]};
 assert.deepEqual([...compositionAttachmentIds(['webpage'],crystal)],['att_source']);
 assert.deepEqual(compositionReferences(['webpage'],crystal).map(x=>x.ref),['do-saved']);
 const copied=rewriteComposition(['webpage'],crystal,(_kind,ref)=>`copy-${ref}`);
 assert.deepEqual(compositionReferences(['webpage'],copied).map(x=>x.ref),['copy-do-saved']);
 let current=copied.blocks[0].children[1800];
 while(current.children) current=current.children[0];
 assert.equal(resolveBlockProps(current.props,{target:'saved'})['data-tt-action'],'copy-do-saved');
 assert.equal(current.props['data-tt-action'],'do-{target}');
 const twice=rewriteComposition(['webpage'],copied,(_kind,ref)=>`second-${ref}`);
 assert.deepEqual(compositionReferences(['webpage'],twice).map(x=>x.ref),['second-copy-do-saved']);
});

test('saved transient JSON inputs survive intrinsic binding without widening the closed scalar authority', () => {
 const original = { 'data-tt-action': '$transient', 'data-tt-action-inputs': JSON.stringify({ operation: 'scan', id: '{item.id}' }) };
 assert.deepEqual(resolveBlockProps(original, { item: { id: 'saved-id' } })['data-tt-action-inputs'], { operation: 'scan', id: 'saved-id' });
 assert.equal(typeof original['data-tt-action-inputs'], 'string');
 const invalid = { ...original, 'data-tt-action-inputs': '{"operation":"scan","nested":{"secret":"x"}}' };
 assert.notDeepEqual(resolveBlockProps(invalid, {})['data-tt-action-inputs'], { operation: 'scan', nested: { secret: 'x' } });
});

test('media adapters expand into selectable authored headings, inputs, controls and previews', async () => {
 const { mediaCompressorTemplate } = await import('../../../scripts/media-acceptance/authoredFixture');
 let id=0;
 const blocks=templateToBlocks(JSON.parse(JSON.stringify(mediaCompressorTemplate())), kind=>`${kind}-${++id}`);
 const flatten=(rows:any[]):any[]=>rows.flatMap(row=>[row,...flatten(row.children||[])]);
 const all=flatten(blocks);
 assert.equal(blocks[0].tag,'tt-media-pipeline');
 for(const tag of ['h2','label','input','button','img','video','details','select','a']) assert.ok(all.some(block=>block.tag===tag),tag);
 assert.equal(new Set(all.map(block=>block.id)).size,all.length);
 const saved=sanitizeWebpageBlocks(blocks);
 assert.equal(saved.ok,true,JSON.stringify(saved));
});

test('route controls expand into separately editable fields and repeated rows without losing bindings', () => {
 let nextId = 0;
 const blocks = templateToBlocks({ tag: 'tt-style', props: { rules: [] }, children: [
  { tag: 'tt-form', props: { identityName: 'id' }, children: [
   { tag: 'label', children: ['Address', { tag: 'tt-change', props: { inputPath: 'query', 'data-tt-action': 'suggest', 'data-tt-action-inputs': { vaultId: '{vaultId}' } }, children: [{ tag: 'input', props: { name: 'query', value: '{query.value}' } }] }] },
   { tag: 'tt-select', props: { name: 'favoriteId', optionsPath: 'result.favorites', labelPath: 'crystal.title' } },
   { tag: 'button', ttAction: 'save-stop', children: ['Save stop'] }
  ] },
  { tag: 'tt-collection', props: { itemsPath: 'result.items', itemTemplate: { ttTemplate: { tag: 'article', children: [
   { tag: 'strong', children: ['{item.crystal.label}'] },
   { tag: 'button', ttAction: 'remove-stop', ttActionInputs: { id: '{item.id}' }, children: ['Remove'] }
  ] } } } },
  { ttEach: { arg: 'last.result.suggestions', max: 20, empty: 'No matches', node: { tag: 'button', ttAction: '$ui', ttActionInputs: { id: '{item.id}' }, children: ['{item.label}'] } } },
  { tag: 'tt-mapbox', props: { vaultId: { ttArg: 'vaultId' }, points: { ttArg: 'result.points' } } }
 ] }, kind => `${kind}-${++nextId}`);
 const flat = (rows: any[]): any[] => rows.flatMap(row => [row, ...flat(row.children || [])]);
 const all = flat(blocks);
 for (const tag of ['tt-style', 'tt-form', 'tt-change', 'input', 'tt-select', 'button', 'strong', 'tt-mapbox'])
  assert.ok(all.some(row => row.tag === tag), tag);
 assert.equal(new Set(all.map(row => row.id)).size, all.length);
 assert.equal(requiresEditableIntrinsicContract(blocks), true);
 assert.ok(all.some(row => row.type === 'collection' && row.props?.itemsPath === 'last.result.suggestions' && row.props?.maxItems === 20));
 assert.ok(all.some(row => row.props?.['data-tt-action'] === 'remove-stop' && row.props?.['data-tt-action-inputs']?.id === '{item.id}'));
 const saved = sanitizeWebpageBlocks([{ id: 'scope', type: 'container', source: { action: 'read-route', inputs: { routeId: '{query.routeId}' } }, args: { vaultId: 'vault-reference' }, children: blocks }]);
 assert.equal(saved.ok, true, JSON.stringify(saved));
 if (saved.ok) assert.deepEqual((saved.blocks[0] as any).source, { action: 'read-route', inputs: { routeId: '{query.routeId}' } });
});

test('expanded Component wrapper is valid Timeline JSON and preserves source and defaults', () => {
 const entry: any = { id: 'route-detail', type: 'component', component: 'route-detail' };
 const child: any = { id: 'title', type: 'element', tag: 'h2', text: '{result.route.crystal.name}' };
 const expanded = expandedComponentBlock(entry, { source: { action: 'read-route', inputs: { routeId: '{query.routeId}' } }, args: [{ name: 'vaultId', type: 'string', default: '' }, { name: 'optional', type: 'string' }] }, [child]);
 assert.deepEqual(copyBoundedJson(expanded, { maxBytes: 10000, maxDepth: 20, maxNodes: 100 }, 'Timeline event'), expanded);
 assert.equal(Object.prototype.hasOwnProperty.call(expanded, 'css'), false);
 assert.deepEqual(expanded.source, { action: 'read-route', inputs: { routeId: '{query.routeId}' } });
 assert.deepEqual(expanded.args, { vaultId: '' });
});

test('converted ttEach preserves primitive rows, object entries, aliases and empty fallback safety', () => {
 const primitives = templateEachRows(['first', 0, false], 2);
 assert.deepEqual(primitives, ['first', 0]);
 assert.deepEqual(templateEachRowScope({ parent: 'kept' }, primitives[1], 1, primitives.length), {
  parent: 'kept', item: 0, index: 1, n: 2, count: 2, first: false, last: true, collection: { index: 1, count: 2 }
 });
 assert.deepEqual(templateEachRows({ alpha: 'A', beta: 2 }, undefined), [{ key: 'alpha', value: 'A' }, { key: 'beta', value: 2 }]);
 assert.equal(templateEachRows(Array.from({ length: 200 }, (_, i) => i), -1).length, 160);
 const converted = templateToBlocks({ ttEach: { arg: 'result.items', empty: 'None for {query.name}', node: { tag: 'span', children: ['{n}/{count}: {item}'] } } }, id);
 assert.equal(converted[0].props?.templateEach, true);
 assert.equal(converted[0].props?.empty, 'None for {query.name}');
 assert.throws(() => templateToBlocks({ ttEach: { arg: 'result.items', empty: { tag: 'p', children: ['No rows'] }, node: { tag: 'span' } } }, id), /empty branch/);
});
