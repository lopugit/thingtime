import assert from 'node:assert/strict';
import test from 'node:test';
import {readPinnedFirstPage} from './pinPaging';
const pins=Array.from({length:12},(_,i)=>({shareId:`pin-${i}`,createdAt:new Date(1000-i)}));
const ordinary=Array.from({length:7},(_,i)=>({shareId:`post-${i}`,createdAt:new Date(2000-i)}));
const parse=(value:string)=>{const at=value.indexOf('_');return at>0?{time:Number(value.slice(0,at)),id:value.slice(at+1)}:null;};
const read=async(pinned:boolean,cursor:ReturnType<typeof parse>,count:number)=>(pinned?pins:ordinary).filter(row=>!cursor||row.createdAt.getTime()<cursor.time||(row.createdAt.getTime()===cursor.time&&row.shareId>cursor.id)).slice(0,count);
test('all pins beyond former5 cap and ordinary posts remain reachable once across pages',async()=>{
  let cursor='',found:string[]=[],pages=0;
  do{const result=await readPinnedFirstPage(read,parse,cursor,3);assert.ok(result);found.push(...result.page.map(row=>row.shareId));cursor=result.nextCursor||'';assert.ok(++pages<10);}while(cursor);
  assert.deepEqual(found,[...pins,...ordinary].map(row=>row.shareId));
  assert.equal(new Set(found).size,19);
});
test('legacy chronological cursors continue ordinary posts without replaying pins',async()=>{
  const result=await readPinnedFirstPage(read,parse,'1998_post-2',3);
  assert.deepEqual(result?.page.map(row=>row.shareId),['post-3','post-4','post-5']);
  assert.equal(await readPinnedFirstPage(read,parse,'pin:invalid',3),null);
});
