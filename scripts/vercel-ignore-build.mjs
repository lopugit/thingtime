#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);

export function getVercelIgnoreDecision(environment = process.env) {
	const branch = environment.VERCEL_GIT_COMMIT_REF?.trim();
	const targetEnvironment = environment.VERCEL_TARGET_ENV?.trim();
	const commitSha = environment.VERCEL_GIT_COMMIT_SHA?.trim();
	const previousSha = environment.VERCEL_GIT_PREVIOUS_SHA?.trim();

	if (branch === 'github-actions') {
		return { skip: true, reason: 'the github-actions control plane does not deploy' };
	}

	if (targetEnvironment === 'develop') {
		return { skip: false, reason: 'the develop custom environment requires an isolated build' };
	}

	if (commitSha && previousSha && commitSha === previousSha) {
		return { skip: true, reason: 'the selected commit was already considered' };
	}

	return { skip: false, reason: 'this product commit requires a build' };
}

export function runVercelIgnoreCommand(environment = process.env) {
	const decision = getVercelIgnoreDecision(environment);
	console.log(`[vercel-ignore] ${decision.skip ? 'skip' : 'build'}: ${decision.reason}`);
	return decision.skip ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
	process.exitCode = runVercelIgnoreCommand();
}
