import assert from 'node:assert/strict';
import test from 'node:test';
import { copyReviewedPlainComment, plainCommentLegacySources, restorePlainComment, reviewPlainComment } from './plainCommentDraft';
import { DRAFT_MAX_BYTES } from './draftCore';
const account = { kind: 'account', origin: 'https://thingtime.example', ownerId: 'owner', dataPlane: 'home' } as const;
const source = { key: 'fixture', store: 'text' as const, label: 'Earlier text' };
function guard() { let active = true; return { assertCurrent() { if (!active) throw Error('Retired workspace'); }, retire() { active = false; } }; }

test('plain comment source keys stay within the selected owner, target, origin and known partition', async () => {
 const sources = await plainCommentLegacySources(account.origin, 'owner', 'target', account);
 assert.equal(sources.length, 4); assert.equal(new Set(sources.map(s=>s.key)).size, 4);
 assert.equal(sources[0].key, 'tt-draft:owner:target');
 const other = await plainCommentLegacySources(account.origin, 'other', 'target', { ...account, ownerId: 'other' });
 assert.ok(sources.every(s => !other.some(o=>o.key===s.key)));
 const plane = await plainCommentLegacySources(account.origin, 'owner', 'target', { ...account, dataPlane: 'second' });
 assert.notEqual(sources[2].key, plane[2].key); assert.notEqual(sources[3].key, plane[3].key);
});
test('review never mutates source bytes; explicit copy appends to the latest editor text', async () => {
 const lease=guard(); let raw='Earlier text\nwith exact breaks', editor='Current text';
 const read=async()=>raw; const review=await reviewPlainComment(source,read,lease);
 editor='Newer current text'; await copyReviewedPlainComment(review,read,lease,()=>editor,text=>{editor=text;});
 assert.equal(editor,'Newer current text\n\nEarlier text\nwith exact breaks'); assert.equal(raw,review.raw);
 raw='Changed source'; await assert.rejects(copyReviewedPlainComment(review,read,lease,()=>editor,()=>assert.fail()),/changed/);
});
test('retired asynchronous reads and copies cannot restore into another editor', async () => {
 const lease=guard();let release!:(v:string)=>void;
 const reading=reviewPlainComment(source,()=>new Promise(resolve=>{release=resolve;}),lease);
 lease.retire();release('private text');await assert.rejects(reading,/Retired/);
});
test('plain recovery rejects rich content, pending media and malformed or oversized snapshots without changing originals', async () => {
 assert.throws(()=>restorePlainComment(JSON.stringify({text:'hello',pendingSubmission:{id:'old'}})),/not a plain-text/);
 assert.throws(()=>restorePlainComment(JSON.stringify({text:'x'.repeat(DRAFT_MAX_BYTES)})),/too large/);
 const legacy={key:'old',store:'draft' as const,label:'Earlier account',context:'comment:plain:target'};
 const value={id:'draft-one',revision:1,content:{name:'Earlier',surface:'comment',context:legacy.context,snapshot:JSON.stringify({text:'kept'}),attachmentIds:[]}};
 const read=async()=>JSON.stringify(value);assert.equal((await reviewPlainComment(legacy,read,guard())).text,'kept');
 value.content.context='comment:plain:other';await assert.rejects(reviewPlainComment(legacy,read,guard()),/different editor/);
 value.content.context=legacy.context; (value.content.attachmentIds as string[]).push('file-one');await assert.rejects(reviewPlainComment(legacy,read,guard()),/different editor/);
 await assert.rejects(reviewPlainComment(legacy,async()=>'{broken',guard()),/JSON/);
});

test('pending draft operations are inspected but their identity and older payload are not copied', async () => {
 const source={key:'old',store:'draft' as const,label:'Earlier workspace',context:'comment:plain:target'};
 const content={name:'Draft',surface:'comment',context:source.context,snapshot:JSON.stringify({text:'Latest authored text'}),attachmentIds:[]};
 const value={id:'old-id',revision:2,content,pending:{writeId:'old-write',revision:1,content:{...content,snapshot:JSON.stringify({text:'Older uncertain save'})}}};
 const raw=JSON.stringify(value),read=async()=>raw,lease=guard();let copied='';
 await copyReviewedPlainComment(await reviewPlainComment(source,read,lease),read,lease,()=>'',text=>{copied=text;});
 assert.equal(copied,'Latest authored text');assert.equal(await read(),raw);
 value.pending.content.snapshot=JSON.stringify({text:'Old text',pendingSubmission:{id:'post-id'}});
 await assert.rejects(reviewPlainComment(source,async()=>JSON.stringify(value),lease),/could not be restored/);
});
test('append refuses combined overflow and rechecks identity after a delayed copy read', async () => {
 const lease=guard(),text='x'.repeat(300*1024),review=await reviewPlainComment(source,async()=>text,lease);
 await assert.rejects(copyReviewedPlainComment(review,async()=>text,lease,()=>text,()=>assert.fail()),/too large/);
 let release!:(value:string)=>void;
 const copying=copyReviewedPlainComment(review,()=>new Promise(resolve=>{release=resolve;}),lease,()=>'',()=>assert.fail());
 lease.retire();release(text);await assert.rejects(copying,/Retired/);
});
