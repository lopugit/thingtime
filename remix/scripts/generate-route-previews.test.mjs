import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { extractRoutePreviews, generateRoutePreviews } from './generate-route-previews.mjs';

const fixture = (run) => {
  const root = mkdtempSync(join(tmpdir(), 'thingtime-route-preview-'));
  mkdirSync(join(root, 'app/routes'), { recursive: true });
  mkdirSync(join(root, 'app/utils'), { recursive: true });
  const write = (file, content) => writeFileSync(join(root, 'app', file), content);
  try { run(root, write); } finally { rmSync(root, { recursive: true, force: true }); }
};

test('actual eager/lazy route syntax discovers nested, index, alias and optional routes without executing modules', () => fixture((root, write) => {
  write('routes.tsx', `
    import { createBrowserRouter as makeRouter } from 'react-router';
    import Eager from './routes/eager';
    import { Named } from './routes/named';
    export const router = makeRouter([{path:'/', children:[
      {index:true,element:<Eager/>},
      {path:'alpha',element:<Eager/>},
      {path:'alias',element:<Eager/>},
      {path:'named',element:<Named/>},
      {path:'docs',children:[{index:true,lazy:()=>import('./routes/docs')},{path:':section?',lazy:()=>import('./routes/docs')}]},
      {path:'redirect',loader:()=>redirect('/alpha')},
      {path:'*',element:<Eager/>}
    ]}]);`);
  write('routes/eager.tsx', `throw new Error('Browser module must never execute');
    export const socialPreview = { title:'A public override', description:'Optional public copy', badges:['One'], variant:'docs', pageTitle:'Alpha' } as const;
    export default () => <h1>Not scraped</h1>;`);
  write('routes/named.tsx', `export const socialPreview = {title:'Named module'}; export function Named(){ return null; }`);
  write('routes/docs.tsx', `export const socialPreview = {description:'Docs copy'} satisfies Record<string, unknown>;`);
  const { entries } = extractRoutePreviews({ root });
  assert.deepEqual(entries.map((entry) => entry.pattern), ['/', '/', '/alias', '/alpha', '/docs', '/docs', '/docs/:section?', '/named', '/redirect']);
  assert.equal(entries.find((entry) => entry.pattern === '/alpha').preview.title, 'A public override');
  assert.deepEqual(entries.find((entry) => entry.pattern === '/alias').preview, entries.find((entry) => entry.pattern === '/alpha').preview);
  assert.equal(entries.find((entry) => entry.pattern === '/named').preview.title, 'Named module');
  assert.equal(entries.find((entry) => entry.pattern === '/docs/:section?').label, 'Docs');
  assert.equal(JSON.stringify(entries).includes('Not scraped'), false);
}));

test('override extraction allows only safe literal display fields and cannot publish ACL or indexing grants', () => fixture((root, write) => {
  write('routes.tsx', `import {createBrowserRouter} from 'react-router';import Page from './routes/page';createBrowserRouter([{path:'safe',element:<Page/>}]);`);
  write('routes/page.tsx', `export const socialPreview = {
    title: evaluateSecret(), description: 'private ' + account.email,
    get eyebrow(){ return 'hidden'; }, ...privateData,
    variant:'not-a-card', badges:['One', getSecret()], publicContent:true,indexable:true,
    images:[{url:'http://private.invalid'}],url:'https://other.invalid',
    pageTitle:'Safe page', revision:'safe-revision'
  };`);
  assert.deepEqual(extractRoutePreviews({ root }).entries[0].preview, { pageTitle:'Safe page', revision:'safe-revision' });
}));

test('generation is deterministic and picks up newly added routes and route-local changes', () => fixture((root, write) => {
  const router = (extra = '') => `import {createBrowserRouter} from 'react-router';createBrowserRouter([{path:'first',lazy:()=>import('./routes/first')}${extra}]);`;
  write('routes.tsx', router());
  write('routes/first.tsx', `export const socialPreview={title:'First'};`);
  const first = generateRoutePreviews({ root });
  assert.equal(first.changed, true);
  const content = readFileSync(first.target, 'utf8');
  assert.equal(generateRoutePreviews({ root }).changed, false);
  assert.equal(content.includes(root), false, 'portable output contains no local paths');
  write('routes.tsx', router(`,{path:'new/:token',lazy:()=>import('./routes/new')}`));
  const pending = generateRoutePreviews({ root });
  assert.ok(pending.files.includes(join(root, 'app/routes/new.tsx')), 'watch unresolved route modules');
  write('routes/new.tsx', `export const socialPreview={description:'New public page'};`);
  const next = generateRoutePreviews({ root });
  assert.equal(next.entries.find((entry) => entry.pattern === '/new/:token').preview.description, 'New public page');
  write('routes/new.tsx', `export const socialPreview={description:'Changed public page'};`);
  assert.equal(generateRoutePreviews({ root }).entries.find((entry) => entry.pattern === '/new/:token').preview.description, 'Changed public page');
}));
