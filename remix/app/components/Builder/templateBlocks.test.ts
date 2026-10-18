import assert from 'node:assert/strict';
import test from 'node:test';
import { templateToBlocks, resolveBlockProps } from './templateBlocks';
import { sanitizeWebpageBlocks } from '../../schemas/registry';
import { compositionReferences } from '../../api/utils/actions/sharedCompositionCore';
import { duplicateBlock, moveBlock, findBlock } from './webpageBlocks';
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
