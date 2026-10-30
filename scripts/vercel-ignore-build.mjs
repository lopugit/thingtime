#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);

export function getVercelIgnoreDecision() {
	return { skip: true, reason: 'GitHub Actions builds every deployment; Vercel accepts prebuilt output only' };
}

export function runVercelIgnoreCommand(environment = process.env) {
	const decision = getVercelIgnoreDecision(environment);
	console.log(`[vercel-ignore] ${decision.skip ? 'skip' : 'build'}: ${decision.reason}`);
	return decision.skip ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
	process.exitCode = runVercelIgnoreCommand();
}
