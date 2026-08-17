#!/usr/bin/env node

// Source inventory for direct application AI clients. GitHub Actions has its
// own protected control-plane contract; this catches new app runtimes that
// would otherwise choose a model independently of Thingtime Admin settings.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const remixRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const appRoot = join(remixRoot, 'app');

const sourceFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.isFile() || !['.ts', '.tsx'].includes(extname(entry.name)) || /\.test\.[^.]+$/.test(entry.name)) {
      return [];
    }
    return [path];
  });

const directClientPattern = /\bnew\s+(?:Anthropic|OpenAI)\s*\(/;
const directClientFiles = sourceFiles(appRoot)
  .filter((path) => directClientPattern.test(readFileSync(path, 'utf8')))
  .map((path) => relative(remixRoot, path))
  .sort();

assert.deepEqual(
  directClientFiles,
  ['app/api/utils/lopu/musing.ts'],
  'new direct AI clients must be added to the Thingtime Admin model-routing contract'
);

const musing = readFileSync(join(remixRoot, directClientFiles[0]), 'utf8');
assert.match(musing, /getAiPreferredModelWaterfall/);
assert.match(musing, /resolveAiPreferredClaudeModel/);
assert.match(musing, /streamClaude\(SYSTEM_PROMPT, user, await getLopuClaudeModel\(\)\)/);
assert.doesNotMatch(musing, /model:\s*process\.env\.LOPU_CLAUDE_MODEL/);

// This developer-only helper intentionally targets the local Codex proxy. It
// is not a Thingtime runtime and cannot consume Claude model aliases; pin the
// exception so it cannot silently become an ungoverned production entrypoint.
const localGraphify = readFileSync(resolve(remixRoot, '..', 'graphifyExtract.sh'), 'utf8');
assert.match(localGraphify, /OPENAI_BASE_URL=http:\/\/127\.0\.0\.1:4768\/v1/);
assert.match(localGraphify, /GRAPHIFY_OPENAI_MODEL=codex-default/);

console.log('application AI model routing contract: self-test OK');
