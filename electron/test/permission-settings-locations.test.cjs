const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
// Execute the actual main-process handlers with OS boundaries mocked: neither
// permission button may bypass the shared folder preparation/opening flow.
const source = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
const handlers = source.slice(source.indexOf('async function openAppLocations('), source.indexOf('async function nodeConnectorCommand('));
for (const kind of ['accessibility', 'screenRecording']) {
 test(`${kind} settings opens the shared app directory before its privacy pane`, async () => {
  const calls = [];
  const context = vm.createContext({
   appLocationsOperation: null, permissionRecoveryPending: false,
   requireMacNode: () => {}, app: { isPackaged: true, getPath: (key) => `/test/${key}` }, path,
   thingtimeNode: { paths: () => ({outerApp:'/test/Thingtime.app',helperApp:'/test/Thingtime.app/Contents/Helpers/Thingtime Node.app'}), verify: async () => {}, request: async () => ({permissions: []}) },
   prepareAppLocations: async (options) => {calls.push(['prepare',options.root]);return {directory:options.root,count:6};},
   armPermissionRecovery: () => {}, crypto: {randomUUID: () => 'test'}, normalizePermissions: (value) => value,
   NODE_PERMISSION_SETTINGS: { [kind]: {url:`settings:${kind}`} }, ThingtimeNodeBridgeError: Error,
   shell: {openPath: async (directory) => {calls.push(['folder',directory]);return '';},openExternal: async (url) => calls.push(['settings',url])},
  });
  vm.runInContext(handlers, context);
  await context.nodeOpenPermissionSettings({}, {kind});
  assert.deepEqual(calls,[['prepare','/test/userData/App Locations'],['folder','/test/userData/App Locations'],['settings',`settings:${kind}`]]);
 });
}
