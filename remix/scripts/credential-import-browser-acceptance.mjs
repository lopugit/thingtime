import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const approvalWorkspace = page => page.locator('[data-settings-document="provider-credential-handoff"]');
const importWorkspace = page => page.locator('[data-settings-document="provider-credential-import"]');
const formatLabel = { 'google-oauth': 'Google OAuth client', json: 'Provider JSON', text: 'Provider text' };

function assertLocalOrigin(origin) {
	const url = new URL(origin);
	assert.equal(url.origin, origin);
	assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Acceptance runs only on a disposable loopback origin.');
}

async function captureLayout(page, workspace, artifactDir, prefix) {
	if (artifactDir) await mkdir(artifactDir, { recursive: true });
	for (const [size, width] of [['desktop', 1440], ['mobile', 390]]) {
		await page.setViewportSize({ width, height: 844 });
		await page.evaluate(() => scrollTo(0, 0));
		for (let step = 0; step < 24; step++) {
			const bounds = await page.evaluate(() => ({
				x: innerWidth, scrollX: document.documentElement.scrollWidth,
				y: scrollY, height: innerHeight, scrollY: document.documentElement.scrollHeight
			}));
			assert.ok(bounds.scrollX <= bounds.x + 1, `Horizontal overflow at ${width}px`);
			if (bounds.y + bounds.height >= bounds.scrollY - 1) break;
			assert.ok(step < 23, 'Unable to reach the end of the page.');
			await page.evaluate(() => scrollBy(0, innerHeight * 0.8));
		}
		if (artifactDir) await workspace.screenshot({ path: join(artifactDir, `${prefix}-${size}.png`) });
	}
}

/** An authenticated task-owned page is supplied by the real API fixture. */
export async function approveCredentialHandoff({ page, origin, verificationUrl, target, accountId, artifactDir }) {
	assertLocalOrigin(origin);
	const url = new URL(verificationUrl);
	assert.equal(url.origin, origin);
	assert.equal(url.pathname, '/credentials/import');
	assert.equal(url.searchParams.getAll('requestId').length, 1);
	const requestId = url.searchParams.get('requestId');
	const document = await page.goto(url.href);
	assert.equal(document?.headers()['x-frame-options'], 'DENY');
	assert.match(document?.headers()['content-security-policy'] || '', /(?:^|;)\s*frame-ancestors 'none'(?:;|$)/);
	const workspace = approvalWorkspace(page);
	await workspace.getByRole('heading', { name: 'Credential handoff', exact: true }).waitFor();
	await workspace.getByText('Awaiting approval.', { exact: true }).waitFor();
	const exact = text => workspace.getByText(text, { exact: true }).waitFor();
	await Promise.all([
		exact(`Thingtime server: ${origin}`), exact(`Request: ${requestId}`),
		exact(`Destination: encrypted integration vault · ${target.environment}`),
		exact(`Credential format: ${formatLabel[target.format]}`), exact(`Vault label: ${target.label}`),
		exact(target.overwrite.mode === 'replace'
			? `Replace ${target.overwrite.expectedId} at revision ${target.overwrite.expectedUpdatedAt}`
			: 'Create a credential'),
		...(accountId ? [exact(`Account: ${accountId}`)] : []),
		...(target.callbackUrl ? [exact(`Callback: ${target.callbackUrl}`)] : [])
	]);
	await captureLayout(page, workspace, artifactDir, 'handoff-review');
	await workspace.getByRole('button', { name: 'Approve this handoff', exact: true }).click();
	await exact('Approved. The sender can now deliver the credential.');
}

export async function verifyCompleted(page, receipt) {
	const workspace = approvalWorkspace(page);
	await workspace.getByRole('button', { name: 'Refresh status', exact: true }).click();
	const complete = () => workspace.getByText('Credential saved in the encrypted integration vault.', { exact: true }).waitFor();
	await complete();
	await page.reload();
	await complete();
	if (receipt) {
		await workspace.getByText(`Credential ID: ${receipt.credentialId}`, { exact: true }).waitFor();
		await workspace.getByText(`Saved revision: ${receipt.updatedAt}`, { exact: true }).waitFor();
	}
}

export async function importCredentialFile({ page, origin, file, target, artifactDir }) {
	assertLocalOrigin(origin);
	const open = async () => {
		await page.goto(`${origin}/admin/external-integrations`);
		await page.locator('details[data-settings-section] > summary').filter({ hasText: 'Encrypted secrets' }).click();
	};
	await open();
	const workspace = importWorkspace(page);
	await workspace.getByRole('heading', { name: 'Import provider credentials', exact: true }).waitFor();
	await workspace.getByLabel('Credential format', { exact: true }).selectOption(target.format);
	if (target.format !== 'google-oauth') await workspace.getByLabel('Vault label', { exact: true }).fill(target.label);
	await workspace.getByLabel('Choose credential file', { exact: true }).setInputFiles(file);
	await workspace.getByRole('button', { name: 'Review import', exact: true }).click();
	if (target.overwrite.mode === 'replace') {
		await workspace.getByRole('checkbox', { name: 'Replace the existing vault credential' }).check();
		await workspace.getByRole('button', { name: 'Review import', exact: true }).click();
	}
	await workspace.getByRole('heading', { name: 'Review vault destination', exact: true }).waitFor();
	await workspace.getByText(`Vault label: ${target.label}`, { exact: true }).waitFor();
	await workspace.getByText(formatLabel[target.format], { exact: true }).waitFor();
	if (target.callbackUrl) await workspace.getByText(`Callback: ${target.callbackUrl}`, { exact: true }).waitFor();
	if (target.overwrite.mode === 'replace') await workspace.getByText(`Credential ID: ${target.overwrite.expectedId}`, { exact: true }).waitFor();
	await captureLayout(page, workspace, artifactDir, 'direct-review');
	await workspace.getByRole('button', { name: 'Save encrypted credential', exact: true }).click();
	await workspace.getByText('Credential saved in the encrypted integration vault.', { exact: true }).waitFor();
	await open();
	await page.locator('details[data-settings-section]').filter({ has: page.getByText('Encrypted secrets', { exact: true }) })
		.getByText(target.label, { exact: true }).waitFor();
}
