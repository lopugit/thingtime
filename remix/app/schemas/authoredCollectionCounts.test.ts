import assert from 'node:assert/strict';
import test from 'node:test';
import { validateThingtimeCrystal, validateValueAgainstFields } from './registry';
import { usesExpandedAuthoredCollections } from '../utils/authoredCollectionCapabilities';
import { defaultsFromArgs, sanitizeArgSpecs } from '../components/ComponentsLibrary/componentTemplate';

test('saved schemas keep more than80 top-level and nested definitions',()=>{
  const children=Array.from({length:101},(_,i)=>({name:`child_${i}`,type:'string'}));
  const fields=[...Array.from({length:101},(_,i)=>({name:`field_${i}`,type:'string'})),{name:'nested',type:'object',children}];
  assert.equal(usesExpandedAuthoredCollections(['schema'],{fields}),true);
  const result=validateThingtimeCrystal(['schema'],{name:'Large authored schema',fields});
  assert.equal(result.ok,true);
  if(result.ok)assert.deepEqual(result.crystal.fields,fields);
  assert.equal(validateThingtimeCrystal(['schema'],{name:'Unsafe',fields:[{name:'__proto__',type:'string'}]}).ok,false);
});
test('author-defined10001 item bounds survive and are enforced without a platform1000 ceiling',()=>{
  const result=validateThingtimeCrystal(['schema'],{name:'Explicit bounds',fields:[{name:'items',type:'array',minItems:10001,maxItems:10001,items:{type:'number'}}]});
  assert.equal(result.ok,true);
  if(!result.ok)return;
  const fields=result.crystal.fields as any;
  assert.equal(fields[0].minItems,10001);assert.equal(fields[0].maxItems,10001);
  assert.equal(validateValueAgainstFields(fields,{items:Array(10001).fill(1)}).ok,true);
  assert.equal(validateValueAgainstFields(fields,{items:Array(10000).fill(1)}).ok,false);
  assert.equal(validateValueAgainstFields(fields,{items:Array(10002).fill(1)}).ok,false);
  for(const maxItems of [-1,1.5,Number.MAX_SAFE_INTEGER+1,Infinity])assert.equal(validateThingtimeCrystal(['schema'],{name:'Invalid count',fields:[{name:'items',type:'string[]',maxItems}]}).ok,false);
});
test('component descriptor and saved-value lists remain complete above16/24 across client and server',()=>{
  const args=Array.from({length:41},(_,i)=>({name:`arg_${i}`,type:'string',default:`default-${i}`}));
  const savedArgs=Object.fromEntries(args.map((arg,i)=>[arg.name,`saved-${i}`]));
  assert.equal(usesExpandedAuthoredCollections(['component'],{args,savedArgs}),true);
  assert.equal(usesExpandedAuthoredCollections(['data'],{args,savedArgs}),false);
  const result=validateThingtimeCrystal(['component'],{name:'Large authored component',args,savedArgs,render:{tag:'div',children:'{arg_40}'}});
  assert.equal(result.ok,true);
  if(!result.ok)return;
  assert.deepEqual(result.crystal.args,args);assert.deepEqual(result.crystal.savedArgs,savedArgs);
  const clientArgs=sanitizeArgSpecs(result.crystal.args);
  assert.equal(clientArgs.length,41);assert.equal(defaultsFromArgs(clientArgs).arg_40,'default-40');
  const page=validateThingtimeCrystal(['webpage'],{name:'Bound large component',blocks:[{id:'large',type:'component',component:'large-component',args:savedArgs,argBindings:savedArgs}]});
  assert.equal(page.ok,true);
  if(page.ok){assert.deepEqual((page.crystal.blocks as any)[0].args,savedArgs);assert.deepEqual((page.crystal.blocks as any)[0].argBindings,savedArgs);}
});
