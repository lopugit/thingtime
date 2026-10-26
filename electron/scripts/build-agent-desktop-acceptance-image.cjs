'use strict';
// Reuse the shipped immutable image builder; never copy profiles or env files.
const path = require('node:path');
const { saveAcceptanceFailure, reportAcceptanceFailure } = require('./acceptance-diagnostics.cjs');
const { DockerEngine } = require('../lib/agent-browsers/containers.cjs');
const { BrowserImages } = require('../lib/agent-browsers/images.cjs');
async function main() {
  const [stateRoot, applicationRoot] = process.argv.slice(2);
  if (process.argv.length !== 4 || ![stateRoot, applicationRoot].every(value => value && path.isAbsolute(value))) throw new Error('Supply absolute private build state and current packaged .output directory.');
  const engine = await new DockerEngine({ executable: process.arch === 'arm64' ? '/opt/homebrew/bin/docker' : '/usr/local/bin/docker', socketPath: path.join(require('node:os').homedir(), '.colima/thingtime-agents/docker.sock'), stateRoot }).initialize();
  const images = await new BrowserImages({ engine, stateRoot: path.join(stateRoot, 'images'), applicationRoot }).initialize();
  try {
    const pending = await images.install({ taskId: 'desktop-acceptance-build' });
    const result = await images.jobs.get(pending.id).completion;
    const image = images.records.get(pending.id);
    if (result.state !== 'installed' || !image?.includesApplication) {
      const failure = images.jobs.get(pending.id).error || new Error('The full application image did not build.');
      failure.diagnosticPath = await saveAcceptanceFailure(stateRoot, 'Acceptance image build', failure);
      throw failure;
    }
    console.log(JSON.stringify({ ready: true, imageId: image.imageId, includesApplication: true }));
  } finally { await images.close(); }
}
if (require.main === module) main().catch(error => reportAcceptanceFailure(process.argv[2], 'Acceptance image build', error));
