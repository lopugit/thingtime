'use strict';

const { readFileSync } = require('node:fs');
const path = require('node:path');

function requireTokens(source, tokens, label) {
	for (const token of tokens) {
		if (!source.includes(token)) throw new Error(`${label} is missing required contract token: ${token}`);
	}
}

function requireOrder(source, orderedTokens, label) {
	let previousIndex = -1;
	for (const token of orderedTokens) {
		const index = source.indexOf(token);
		if (index < 0 || index <= previousIndex) throw new Error(`${label} has an invalid step order near: ${token}`);
		previousIndex = index;
	}
}

function validateEntryShim(source) {
	requireTokens(
		source,
		[
			'electron/**',
			'MCP/**',
			'macos/**',
			'uses: lopugit/thingtime/.github/workflows/electron-release.yml@github-actions',
			'secrets: inherit'
		],
		'Electron release entry shim'
	);
	for (const forbidden of [/^\s*run:/mu, /actions\/checkout/iu, /gh release create/iu, /dist:unsigned/iu]) {
		if (forbidden.test(source)) throw new Error(`Electron release entry shim contains executable release behavior: ${forbidden}`);
	}
	return true;
}

function validateControlPlane(source) {
	requireTokens(
		source,
		[
			'workflow_call:',
			'corepack pnpm --dir MCP install --frozen-lockfile',
			'corepack pnpm --dir MCP run typecheck',
			'corepack pnpm --dir MCP test',
			'corepack pnpm --dir MCP run build:desktop',
			'swift test --package-path macos/ThingtimeNode',
			'swift build --package-path macos/ThingtimeNode --configuration release --product ThingtimeNode',
			'swift build --package-path macos/ThingtimeNode --configuration release --product ThingtimeNodeBridge',
			'corepack pnpm --dir electron test',
			'MAC_CSC_LINK',
			'Developer ID Application:',
			'security import',
			'APPLE_API_KEY',
			'Select release distribution',
			'Incomplete signing configuration',
			'corepack pnpm --dir electron run dist',
			'corepack pnpm --dir electron run dist:unsigned',
			'build-unsigned-release.sh',
			'.unsigned',
			'Thingtime-Electron-App-UNSIGNED-Release',
			'Thingtime-Recovery-App-UNSIGNED-Release',
			'Open Anyway',
			'security delete-keychain',
			'if: always()',
			'gh release create'
		],
		'Electron release control plane'
	);
	for (const forbidden of [
		/identity\s*=\s*null/iu,
		/continue-on-error\s*:\s*true/iu,
		/^\s*push:/mu
	]) {
		if (forbidden.test(source)) throw new Error(`Electron release control plane contains forbidden behavior: ${forbidden}`);
	}
	requireOrder(
		source,
		[
			'corepack pnpm --dir MCP run typecheck',
			'Select release distribution',
			'security import',
			'corepack pnpm --dir electron run dist',
			'corepack pnpm --dir electron run dist:unsigned',
			'gh release create'
		],
		'Electron release control plane'
	);
	return true;
}

module.exports = { validateControlPlane, validateEntryShim };

if (require.main === module) {
	const [kind, workflowPath] = process.argv.slice(2);
	if (!['control-plane', 'shim'].includes(kind) || !workflowPath) {
		console.error('Usage: release-workflow-contract.cjs <shim|control-plane> <workflow.yml>');
		process.exitCode = 2;
	} else {
		try {
			const source = readFileSync(path.resolve(process.cwd(), workflowPath), 'utf8');
			if (kind === 'shim') validateEntryShim(source);
			else validateControlPlane(source);
			console.log(`Verified Electron release ${kind} contract: ${workflowPath}`);
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		}
	}
}
