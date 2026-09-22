#!/usr/bin/env node
import { packageClaudeOAuthArtifacts } from './claude-oauth-artifacts.mjs';

// Native runtime selection is dynamic, so Nitro and Workflow cannot trace it.
// Package every independent function that references it, then verify isolation.
for (const item of await packageClaudeOAuthArtifacts()) {
	console.log(`[claude-oauth] Packaged ${item.nativeName}@${item.version} in ${item.function}; ${(item.bytes / 1024 / 1024).toFixed(1)} MiB`);
}
