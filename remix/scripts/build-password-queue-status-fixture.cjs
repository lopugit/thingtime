// Build only into ignored temporary output; use the repository's existing esbuild.
const path = require('node:path'), fs = require('node:fs');
const root = path.resolve(__dirname, '../..');
const esbuild = require(path.join(root, 'MCP/node_modules/esbuild'));
const out = path.resolve(process.argv[2] || path.join(root, 'tmp/continuation/vault-status'));
fs.mkdirSync(out, { recursive: true });
const mocks = {
 'runtime.client': `export const LOCAL_WORKSPACE_CHANGED='fixture-local-queue-changed'; export const accountWorkspaceLease=()=>({assertCurrent(){}}); export const canSyncAccountWorkspace=()=>true; export const subscribeWorkspaceBinding=()=>()=>{}; export const announceLocalWorkspaceChange=()=>{};`,
 'passwordTransport.client': `export function accountPasswordTransport(){return new Proxy({}, {get(){throw Error('Network transport must not run in queue fixture')}})}`,
 'passwordFileTransport.client': `export function accountPasswordFileTransport(){return new Proxy({}, {get(){throw Error('File transport must not run in queue fixture')}})}`
};
esbuild.buildSync({ absWorkingDir: root, entryPoints: ['remix/app/local-workspace/passwordQueueStatus.browser.test.ts'], outfile: path.join(out, 'queue-status.test.mjs'), bundle: true, platform: 'node', format: 'esm' });
esbuild.build({ absWorkingDir: root, entryPoints: ['remix/app/local-workspace/passwordQueueStatus.browser.fixture.tsx'], outfile: path.join(out, 'queue-status.fixture.js'), bundle: true, platform: 'browser', format: 'iife', globalName: 'queueStatusFixture', define: { 'process.env.NODE_ENV': '"production"' }, alias: { '~': path.join(root, 'remix/app') }, plugins: [{ name: 'local-queue-only', setup(build) {
 build.onResolve({ filter: /local-workspace\/(runtime\.client|passwordTransport\.client|passwordFileTransport\.client)$/ }, args => ({ path: path.basename(args.path), namespace: 'queue-fixture' }));
 build.onLoad({ filter: /.*/, namespace: 'queue-fixture' }, args => ({ contents: mocks[args.path], loader: 'js' }));
} }] }).then(() => console.log(`Built queue status component fixture and test in ${out}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
