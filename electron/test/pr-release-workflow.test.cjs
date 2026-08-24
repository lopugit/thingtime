'use strict';

const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const electronDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(electronDir, '..');

test('signed PR release workflow gates signing on a maintainer-approved same-repository PR and emits provenance SemVer', async () => {
	const workflow = await readFile(path.join(repoRoot, '.github', 'workflows', 'electron-pr-release.yml'), 'utf8');
	const productionBuilder = await readFile(path.join(electronDir, 'scripts', 'build-production-app.mjs'), 'utf8');
	assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/u);
	assert.match(workflow, /github\.event\.pull_request\.author_association == 'OWNER'/u);
	assert.match(workflow, /'desktop-release'/u);
	assert.match(workflow, /fetch-depth: 1/u);
	assert.doesNotMatch(workflow, /fetch-depth: 0/u);
	assert.match(workflow, /release_version="\$\{base_version\}-pr\.\$\{PR_NUMBER\}\.\$\{branch_slug\}\.g\$\{short_sha\}"/u);
	assert.match(workflow, /--prerelease/u);
	assert.match(workflow, /npm ci --prefix MCP/u);
	assert.doesNotMatch(workflow, /corepack pnpm --dir MCP install --frozen-lockfile/u);
	assert.match(workflow, /corepack pnpm --dir electron run dist/u);
	assert.match(workflow, /test "\$\{#zip_assets\[@\]\}" -gt 0/u);
	assert.match(workflow, /Remove ephemeral signing material/u);
	assert.doesNotMatch(workflow, /dist:unsigned/u);
	assert.match(productionBuilder, /THINGTIME_ELECTRON_RELEASE_VERSION/u);
	assert.match(productionBuilder, /--config\.extraMetadata\.version=\$\{releaseVersion\}/u);
});
