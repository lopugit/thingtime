import fs from 'node:fs';
const report = {
  node: process.version, mobile: process.versions.mobile,
  platform: process.platform, arch: process.arch,
  attempted: 'canonical .output/server/index.mjs',
  sourceSha256: '__ENTRY_SHA256__', imported: false, apiStarted: false
};
try {
  const { default: bcrypt } = await import('./.output/server/node_modules/bcrypt/bcrypt.js');
  const hash = await bcrypt.hash('disposable-node-ios-fixture', 10);
  report.bcrypt = {
    rounds: bcrypt.getRounds(hash),
    valid: await bcrypt.compare('disposable-node-ios-fixture', hash),
    invalid: await bcrypt.compare('different-fixture', hash)
  };
  const application = await import('./.output/server/index.mjs');
  report.imported = true;
  report.middleware = typeof application.middleware;
} catch (error) {
  report.error = { name: error.name, code: error.code || null, message: error.message, stack: error.stack };
}
fs.writeFileSync(process.env.PROBE_REPORT, JSON.stringify(report, null, 2));
