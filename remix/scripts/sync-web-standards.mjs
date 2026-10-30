/** Rebuild the standards inventory from normative indexes and W3C Webref.
 * npm install --prefix /tmp/tt-standards-tools --ignore-scripts @webref/css@8.7.5 @webref/elements@2.9.0 @webref/idl@3.84.0
 * node remix/scripts/sync-web-standards.mjs --tools=/tmp/tt-standards-tools/node_modules
 * No browser compatibility database is treated as a standards authority.
 */
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse } from '../node_modules/parse5/dist/index.js';
const tools = process.argv.find(x => x.startsWith('--tools='))?.slice(8);
if (!tools) throw new Error('Pass --tools=<directory containing the pinned @webref packages>.');
const require = createRequire(`${tools}/package.json`);
const expected = { css: '8.7.5', elements: '2.9.0', idl: '3.84.0' };
for (const [p, version] of Object.entries(expected)) if (require(`@webref/${p}/package.json`).version !== version) throw new Error(`Use @webref/${p}@${version}`);
const idl = require('@webref/idl');
const text = n => n.nodeName === '#text' ? n.value : (n.childNodes || []).map(text).join('');
const attr = (n, k) => n.attrs?.find(a => a.name === k)?.value;
const descendants = (n, predicate) => [ ...(predicate(n) ? [n] : []), ...(n.childNodes || []).flatMap(c => descendants(c, predicate)) ];
const entries = new Map(), sources = [];
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
function add(entry) {
 const signature = `${entry.language}:${entry.kind}:${entry.name}`;
 const existing = entries.get(signature);
 if (existing) { if (!existing.references.includes(entry.spec)) existing.references.push(entry.spec); return; }
 const id = `${entry.language}-${slug(entry.kind)}-${slug(entry.name)}-${createHash('sha256').update(signature).digest('hex').slice(0,8)}`;
 entries.set(signature, { id, ...entry, references: [entry.spec] });
}
async function source(name, url) {
 const res = await fetch(url); if (!res.ok) throw new Error(`${url}: ${res.status}`);
 const body = await res.text(); sources.push({ name, url, sha256: createHash('sha256').update(body).digest('hex') }); return body;
}
const urls = {
 html: 'https://html.spec.whatwg.org/multipage/indices.html',
 css: 'https://www.w3.org/TR/css-2026/',
 ecma262: 'https://tc39.es/ecma262/2026/',
 ecma402: 'https://tc39.es/ecma402/2026/'
};
const documents = {};
for (const [key, url] of Object.entries(urls)) documents[key] = parse(await source(key, url));
const refCommit = (await (await fetch('https://api.github.com/repos/w3c/webref/commits/main')).json()).sha;
if (!/^[a-f0-9]{40}$/.test(refCommit)) throw new Error('Cannot pin Webref source');
const webrefBase = `https://raw.githubusercontent.com/w3c/webref/${refCommit}`;
const ed = JSON.parse(await source('webref-editor-index', `${webrefBase}/ed/index.json`));
const tr = JSON.parse(await source('webref-published-index', `${webrefBase}/tr/index.json`));
// HTML's own index defines the conforming author-facing elements, attributes,
// and events. Obsolete features belong to an explicitly separate category.
const tables = descendants(documents.html, n => n.tagName === 'table');
for (const table of tables) {
 const header = text(descendants(table, n => n.tagName === 'thead')[0] || {}).replace(/\s+/g,' ').trim();
 const kind = header.startsWith('Element ') ? 'element' : header.startsWith('Attribute ') ? 'attribute' : header.startsWith('Event ') ? 'event' : null;
 if (!kind) continue;
 for (const row of descendants(table, n => n.tagName === 'tr')) {
  const cells = (row.childNodes || []).filter(n => ['td','th'].includes(n.tagName));
  const a = descendants(cells[kind === 'attribute' ? 1 : 0] || {}, n => n.tagName === 'a')[0];
  if (!a || cells.length < 2) continue;
  const names = descendants(cells[0], n => n.tagName === 'code').map(text);
  for (const name of names.length ? names : [text(a).trim()]) {
   const spec = new URL(attr(a,'href'), urls.html).href;
   add({ language:'html', kind, name, group: kind === 'element' ? spec.split('/').at(-1).split('.')[0] : kind === 'attribute' ? text(cells[1]).replace(/\s+/g,' ').trim().slice(0,180) : 'Events', spec, status:'Living Standard', description: text(cells[kind === 'element' ? 1 : 2] || cells[1]).replace(/\s+/g,' ').trim().slice(0,450) });
  }
 }
}
// Latest *published* CSS modules, including clearly identified Working Drafts.
const cssSpecs = tr.results.filter(s => s.css && s.standing !== 'retired').sort((a,b)=>a.shortname.localeCompare(b.shortname));
for (let offset=0;offset<cssSpecs.length;offset+=8) {
 const batch = await Promise.all(cssSpecs.slice(offset,offset+8).map(async spec => ({spec, css: JSON.parse(await source(`css:${spec.shortname}`,`${webrefBase}/tr/${spec.css}`))})));
 for (const {spec, css} of batch) {
  for (const [key, kind] of Object.entries({properties:'property',atrules:'at-rule',selectors:'selector',values:'value',functions:'function'})) {
   for (const v of css[key] || []) {
    add({language:'css',kind,name:v.name,group:spec.shortname,spec:v.href || spec.crawled,status:spec.release?.status || 'Published specification',description:(v.prose || '').slice(0,450),syntax:v.value || v.syntax || '',initial:v.initial || ''});
    for (const descriptor of v.descriptors || []) add({language:'css',kind:'descriptor',name:`${v.name} / ${descriptor.name}`,group:spec.shortname,spec:descriptor.href || v.href,status:spec.release?.status || 'Published specification',syntax:descriptor.value || descriptor.syntax || '',initial:descriptor.initial || ''});
   }
  }
 }
}
// Current grammar vocabulary supplies value types/functions not emitted by older
// TR extracts. They are labelled editor draft rather than promoted to standards.
const currentCss = require('@webref/css/css.json');
for (const [key, kind] of Object.entries({properties:'property',atrules:'at-rule',selectors:'selector',functions:'function',types:'type'})) for (const v of currentCss[key] || []) add({language:'css',kind,name:v.name,group:new URL(v.href).pathname.split('/')[1],spec:v.href,status:'Editor draft / Webref current',syntax:v.syntax || '',initial:v.initial || '',description:(v.prose || '').slice(0,450)});
// ECMAScript's normative clauses include every language feature, built-in and
// abstract algorithm. Keep algorithms labelled: they are not public callable APIs.
for (const key of ['ecma262','ecma402']) for (const node of descendants(documents[key], n => n.tagName === 'emu-clause')) {
 const h = (node.childNodes || []).find(n => n.tagName === 'h1');
 const title = text(h || {}).replace(/\s+/g,' ').trim();
 const match = title.match(/^(\d+(?:\.\d+)*)\s+(.*)$/);
 const id = attr(node,'id'); if (!match || !id) continue;
 const chapter = Number(match[1].split('.')[0]), name=match[2];
 if (chapter<12 && key==='ecma262') continue;
 const api = /^(?:get |set )?(?:[A-Z][A-Za-z0-9]*\.|(?:decodeURI|encodeURI|isFinite|isNaN|parseFloat|parseInt)\s*\()/.test(name) && !name.includes(' [[');
 const grammar = chapter < 19 && key === 'ecma262';
 add({ language:'javascript',kind:api?'built-in':grammar?'language':'specification',name,group:key==='ecma402'?'Internationalization':api?name.replace(/^(get|set) /,'').split('.')[0]:`ECMA-262 §${chapter}`,spec:`${urls[key]}#${id}`,status:key==='ecma262'?'ECMAScript 2026':'ECMA-402 2026',section:match[1] });
}
// Web APIs are a distinct language family: DOM, Fetch, media, workers etc. do
// not belong to ECMAScript. Preserve interface/member signatures and provenance.
for (const file of Object.values(await idl.listAll())) {
 const raw = await file.text();
 const original = raw.match(/\/\/ Source: (.+) \((https:[^\n]+)\)/);
 if (!original) continue;
 const meta = ed.results.find(s => s.shortname === file.shortname || s.series?.shortname === file.shortname);
 const status = meta?.nightly?.status || 'Editor draft / Webref current';
 let definitions; try { definitions = await file.parse(); } catch { throw new Error(`Invalid IDL: ${file.shortname}`); }
 for (const def of definitions) {
  if (!def.name || def.type === 'includes') continue;
  const common={language:'webapi',group:original[1],spec:original[2],status,interface:def.name};
  add({...common,kind:def.type,name:def.name,inheritance:def.inheritance || '',exposure:(def.extAttrs || []).find(a=>a.name==='Exposed')?.rhs || null});
  for (const member of def.members || []) {
   if (!member.name && !['constructor','iterable','maplike','setlike'].includes(member.type)) continue;
   const name=member.name || member.type;
   const type=t=>typeof t?.idlType==='string'?t.idlType:t?.union?t.idlType.map(type).join(' | '):t?.generic?`${t.generic}<${(t.idlType||[]).map(type).join(', ')}>`:'';
   add({...common,kind:member.type,name:`${def.name}.${name}`,member:name,static:member.special==='static',readonly:!!member.readonly,returns:type(member.idlType),arguments:(member.arguments || []).map(a=>({name:a.name,type:type(a.idlType),optional:a.optional,variadic:a.variadic}))});
  }
 }
}
const features = [...entries.values()].sort((a,b)=>a.language.localeCompare(b.language)||a.kind.localeCompare(b.kind)||a.name.localeCompare(b.name));
const counts=Object.create(null);for(const f of features){counts[f.language]??=Object.create(null);counts[f.language][f.kind]=(counts[f.language][f.kind]||0)+1;}
const out=new URL('../app/webPlatform/generated/',import.meta.url);await mkdir(out,{recursive:true});
await writeFile(new URL('inventory.json',out),JSON.stringify({features}));
await writeFile(new URL('manifest.json',out),JSON.stringify({schemaVersion:1,generatedAt:new Date().toISOString(),webrefCommit:refCommit,packages:expected,total:features.length,counts,sources:sources.sort((a,b)=>a.name.localeCompare(b.name))},null,2)+'\n');
console.log(JSON.stringify({total:features.length,counts},null,2));
