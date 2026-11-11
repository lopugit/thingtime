// Runs in the isolated Electron runtime, never the installed stable app.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!config.name.startsWith('native-bundle-qa-auto-')) throw Error('Require an automatic-update QA workspace');
const { LocalRuntime } = require(path.join(config.source, 'lib/local-runtime.cjs'));
const { DesktopSettingsStore } = require(path.join(config.source, 'lib/desktop-settings.cjs'));
app.setName(`Thingtime Dev ${config.name}`); app.setPath('userData', config.profile);
app.whenReady().then(async () => {
 const runtime = new LocalRuntime({ userData: config.profile, safeStorage, parallelDev: true });
 await runtime.initialize(); await runtime.configure({ enabled: false, databaseMode: 'managed', apiPort: config.apiPort, databasePort: config.databasePort });
 const settings = new DesktopSettingsStore({ filePath: path.join(config.profile, 'desktop-settings.json'), metadata: {} }); await settings.initialize();
 const added = await settings.addEndpoint({ label: 'Synthetic native release QA', url: config.origin });
 const endpoint = added.endpointProfiles.find(endpoint => endpoint.url === config.origin + '/'); if (!endpoint) throw Error('Synthetic endpoint missing');
 await settings.selectEndpoint(endpoint.id); await settings.setAutoStartNodeOnLaunch(false);
 fs.writeFileSync(config.receipt, JSON.stringify({ configured: true, enabled: runtime.snapshot().enabled, origin: settings.snapshot().selectedEndpoint.url }));
 app.quit();
}).catch(() => { console.error('Isolated remote QA configuration failed'); app.exit(1); });
