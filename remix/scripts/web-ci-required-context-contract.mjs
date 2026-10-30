import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const remixRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(remixRoot, '..');
const workflowPath = resolve(repositoryRoot, '.github', 'workflows', 'web-ci.yml');
const source = readFileSync(workflowPath, 'utf8');

const pullRequestStart = source.indexOf('\n  pull_request:');
assert.notEqual(pullRequestStart, -1, 'Web CI must listen for pull requests');

const afterPullRequest = source.slice(pullRequestStart + 1);
const nextEventOffsets = ['\n  push:', '\n  workflow_dispatch:'].map((event) => afterPullRequest.indexOf(event)).filter((offset) => offset >= 0);
const pullRequestEnd = nextEventOffsets.length ? Math.min(...nextEventOffsets) : afterPullRequest.length;
const pullRequestBlock = afterPullRequest.slice(0, pullRequestEnd);

assert.doesNotMatch(pullRequestBlock, /^\s+paths(?:-ignore)?:/m, 'required Web CI contexts must not be hidden behind pull-request path filters');

const protectedCall = 'uses: lopugit/thingtime/.github/workflows/web-ci.yml@github-actions';

if (source.includes(protectedCall)) {
	assert.match(
		source,
		/^  control-plane:\n    uses: lopugit\/thingtime\/\.github\/workflows\/web-ci\.yml@github-actions$/m,
		'the product-branch listener must delegate to the protected Web CI implementation'
	);
	console.log('web-ci required-context contract: path-free protected listener');
	process.exit(0);
}

const requiredFragments = [
	'pull-requests: read',
	'uses: actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0',
	"filename.startsWith('remix/')",
	"filename === '.github/workflows/web-ci.yml'",
	'catch (error) {',
	'Could not inspect pull-request files',
	'const truncated = expectedChangedFiles > files.length;',
	"core.setOutput('full_web_ci', String(fullWebCi));",
	'required-build-context:',
	'required-api-context:'
];

for (const fragment of requiredFragments) {
	assert.ok(source.includes(fragment), `Web CI is missing required contract fragment: ${fragment}`);
}

const count = (needle) => source.split(needle).length - 1;
assert.equal(count("'Build + typecheck ratchet + unit tests'"), 2, 'exactly one full job and one companion must be able to report the build context');
assert.equal(count("'API suite (headless /tests runner)'"), 2, 'exactly one full job and one companion must be able to report the API context');
assert.equal(
	(source.match(/^    if: needs\.scope\.outputs\.full_web_ci == 'true'$/gm) ?? []).length,
	2,
	'both full jobs must run only for Web CI changes'
);
assert.equal(
	(source.match(/^    if: needs\.scope\.outputs\.full_web_ci == 'false'$/gm) ?? []).length,
	2,
	'both required-context companions must run only for non-Web changes'
);

console.log('web-ci required-context contract: complementary full and no-op jobs');
