#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const COMMENT_MARKER = '<!-- thingtime-admin-pr-previews -->';
const CONTROLLER_DISPATCH_TYPE = 'develop-pr-preview-controller';
const ADMIN_DISPATCH_MARKER = '1';
const EXPECTED_DISPATCHER_LOGIN = 'thingtime-ci-control[bot]';
const ENVIRONMENTS = ['develop', 'production'];
const ACTIVE_STATES = new Set(['QUEUED', 'INITIALIZING', 'BUILDING']);
const FAILURE_STATES = new Set(['BLOCKED', 'CANCELED', 'ERROR']);
const MAX_GITHUB_PAGES = 10;
const MAX_VERCEL_PAGES = 10;
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_EXPECTED_BUILD_MINUTES = 5;
const execFileAsync = promisify(execFile);

class HttpError extends Error {
	constructor(status, code) {
		super(`Request failed with HTTP ${status} (${code})`);
		this.status = status;
		this.code = code;
	}
}

const requiredEnv = (name) => {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Missing required workflow setting: ${name}`);
	return value;
};

const optionalEnv = (name, fallback) => process.env[name]?.trim() || fallback;

const boundedInteger = (value, name) => {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
	return parsed;
};

const exactId = (value, name, prefix) => {
	const normalized = String(value ?? '').trim();
	if (!new RegExp(`^${prefix}[A-Za-z0-9]+$`).test(normalized)) throw new Error(`${name} must be an exact ${prefix} identifier`);
	return normalized;
};

const safeRepository = (value) => {
	const repository = String(value ?? '').trim();
	if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('GitHub repository is invalid');
	return repository;
};

const safeHeadRef = (value) =>
	typeof value === 'string' && value.length >= 1 && value.length <= 255 && !/[\u0000-\u001f\u007f]/.test(value);

const safeHostname = (value, name) => {
	const hostname = String(value ?? '').trim().toLowerCase();
	const labels = hostname.split('.');
	if (
		hostname.length > 253 ||
		labels.length < 2 ||
		labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
	) {
		throw new Error(`${name} is invalid`);
	}
	return hostname;
};

const normalizeBotLogin = (value) => {
	const login = String(value ?? '').trim().toLowerCase();
	if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?\[bot\]$/.test(login)) throw new Error('GitHub App bot login is invalid');
	return login;
};

const normalizeEnvironments = (value) => {
	if (!Array.isArray(value) || value.length > ENVIRONMENTS.length) throw new Error('Admin preview environments are invalid');
	const environments = value.map((item) => String(item ?? '').trim().toLowerCase());
	if (environments.some((environment) => !ENVIRONMENTS.includes(environment))) {
		throw new Error('Admin preview environments are invalid');
	}
	return ENVIRONMENTS.filter((environment) => environments.includes(environment));
};

const expectedBuildMinutes = () => {
	const minutes = Number(optionalEnv('PREVIEW_EXPECTED_BUILD_MINUTES', String(DEFAULT_EXPECTED_BUILD_MINUTES)));
	if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 60) {
		throw new Error('PREVIEW_EXPECTED_BUILD_MINUTES must be a whole number from 1 to 60');
	}
	return minutes;
};

const expectedReadyAt = (startedAt = Date.now()) =>
	new Date(Math.ceil((startedAt + expectedBuildMinutes() * 60_000) / 60_000) * 60_000).toISOString();

const runtimeConfig = () => ({
	repository: safeRepository(requiredEnv('GITHUB_REPOSITORY')),
	repositoryId: boundedInteger(requiredEnv('GITHUB_REPOSITORY_ID'), 'GitHub repository id'),
	projectId: exactId(requiredEnv('VERCEL_PROJECT_ID'), 'Vercel project id', 'prj_'),
	projectName: requiredEnv('VERCEL_PROJECT_NAME'),
	teamId: exactId(requiredEnv('VERCEL_TEAM_ID'), 'Vercel team id', 'team_'),
	teamSlug: requiredEnv('VERCEL_TEAM_SLUG'),
	gitRepoId: boundedInteger(requiredEnv('VERCEL_GITHUB_REPO_ID'), 'Vercel Git repository id'),
	developEnvironmentId: exactId(requiredEnv('VERCEL_CUSTOM_ENVIRONMENT_ID'), 'Vercel custom environment id', 'env_'),
	aliasSuffixes: {
		develop: safeHostname(requiredEnv('PREVIEW_ALIAS_SUFFIX'), 'Develop preview alias suffix'),
		production: safeHostname(optionalEnv('PRODUCTION_PREVIEW_ALIAS_SUFFIX', 'previews.thingtime.com'), 'Production preview alias suffix')
	},
	dispatcherLogin: normalizeBotLogin(optionalEnv('ADMIN_PREVIEW_DISPATCHER_LOGIN', EXPECTED_DISPATCHER_LOGIN))
});

const parseDispatch = (event, config) => {
	if (event?.action !== CONTROLLER_DISPATCH_TYPE || event?.client_payload?.admin_preview !== ADMIN_DISPATCH_MARKER) {
		throw new Error('Unexpected admin preview dispatch');
	}
	const sender = normalizeBotLogin(event.sender?.login);
	if (event.sender?.type !== 'Bot' || sender !== config.dispatcherLogin) {
		throw new Error('Admin preview dispatch sender is not the configured GitHub App');
	}
	const payload = {
		prNumber: boundedInteger(event.client_payload.pr_number, 'PR number'),
		headSha: String(event.client_payload.head_sha ?? ''),
		headRef: String(event.client_payload.head_ref ?? ''),
		action: String(event.client_payload.action ?? ''),
		environments: normalizeEnvironments(event.client_payload.environments)
	};
	if (!['configure', 'synchronize', 'closed'].includes(payload.action)) throw new Error('Admin preview dispatch action is invalid');
	if (!/^[0-9a-f]{40}$/.test(payload.headSha)) throw new Error('Admin preview dispatch SHA is invalid');
	if (!safeHeadRef(payload.headRef)) throw new Error('Admin preview dispatch ref is invalid');
	return payload;
};

const pullRequestIssue = (pullRequest, payload, config) => {
	if (!pullRequest || typeof pullRequest !== 'object') return 'missing-pull-request';
	if (Number(pullRequest.base?.repo?.id) !== config.repositoryId || pullRequest.base?.repo?.full_name !== config.repository) return 'wrong-base-repository';
	if (Number(pullRequest.head?.repo?.id) !== config.repositoryId || pullRequest.head?.repo?.full_name !== config.repository) return 'fork';
	if (pullRequest.head?.sha !== payload.headSha) return 'stale-head-sha';
	if (pullRequest.head?.ref !== payload.headRef) return 'stale-head-ref';
	if (payload.action === 'closed') return pullRequest.state === 'closed' ? null : 'not-closed';
	if (pullRequest.state !== 'open') return 'not-open';
	if (pullRequest.draft) return 'draft';
	return null;
};

const previewAlias = (prNumber, environment, config) =>
	`pr-${boundedInteger(prNumber, 'PR number')}.${config.aliasSuffixes[environment]}`;

const githubRequest = async (path, init = {}) => {
	const response = await fetch(`https://api.github.com${path}`, {
		method: init.method ?? 'GET',
		headers: {
			Accept: 'application/vnd.github+json',
			Authorization: `Bearer ${requiredEnv('GH_TOKEN')}`,
			'Content-Type': 'application/json',
			'X-GitHub-Api-Version': '2022-11-28',
			'User-Agent': 'thingtime-admin-preview-controller'
		},
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});
	if (response.status === 204) return null;
	const payload = await response.json().catch(() => null);
	if (!(init.accept ?? [200]).includes(response.status)) throw new HttpError(response.status, payload?.message ?? 'github-error');
	return payload;
};

const vercelRequest = async (config, path, init = {}) => {
	const separator = path.includes('?') ? '&' : '?';
	const response = await fetch(`https://api.vercel.com${path}${separator}teamId=${encodeURIComponent(config.teamId)}`, {
		method: init.method ?? 'GET',
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${requiredEnv('VERCEL_API_TOKEN')}`,
			'Content-Type': 'application/json',
			'User-Agent': 'thingtime-admin-preview-controller'
		},
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});
	if (response.status === 204) return null;
	const payload = await response.json().catch(() => null);
	if (!(init.accept ?? [200]).includes(response.status)) throw new HttpError(response.status, payload?.error?.code ?? 'vercel-error');
	return payload;
};

const getPullRequest = (config, number) => githubRequest(`/repos/${config.repository}/pulls/${boundedInteger(number, 'PR number')}`);

const upsertComment = async (config, prNumber, body, createIfMissing = true) => {
	let existing = null;
	for (let page = 1; page <= MAX_GITHUB_PAGES; page += 1) {
		const comments = await githubRequest(`/repos/${config.repository}/issues/${prNumber}/comments?per_page=100&page=${page}`);
		if (!Array.isArray(comments)) throw new Error('GitHub comments response was invalid');
		existing = comments.find((comment) => comment.user?.login === 'github-actions[bot]' && comment.body?.includes(COMMENT_MARKER));
		if (existing || comments.length < 100) break;
		if (page === MAX_GITHUB_PAGES) throw new Error('GitHub comment scan exceeded its safety bound');
	}
	const markedBody = `${COMMENT_MARKER}\n${body}`;
	if (existing) {
		await githubRequest(`/repos/${config.repository}/issues/comments/${existing.id}`, { method: 'PATCH', body: { body: markedBody } });
		return;
	}
	if (createIfMissing) {
		await githubRequest(`/repos/${config.repository}/issues/${prNumber}/comments`, {
			method: 'POST',
			accept: [201],
			body: { body: markedBody }
		});
	}
};

const deploymentMetadata = (config, pullRequest, environment) => {
	const [githubCommitOrg, githubCommitRepo] = config.repository.split('/');
	return {
		githubDeployment: '1',
		githubCommitOrg,
		githubCommitRepo,
		githubCommitRef: pullRequest.head.ref,
		githubCommitSha: pullRequest.head.sha,
		githubPrId: String(pullRequest.number),
		githubRepoId: String(config.gitRepoId),
		githubRepositoryId: String(config.repositoryId),
		thingtimeAdminPrPreview: '1',
		thingtimeGithubPrebuiltPreview: '1',
		thingtimePreviewEnvironment: environment
	};
};

const deploymentOwnershipIssue = (deployment, config, { prNumber, environment, sha = null, ref = null }) => {
	if (!deployment || typeof deployment !== 'object') return 'missing-deployment';
	if (!/^dpl_[A-Za-z0-9]+$/.test(deployment.id ?? deployment.uid ?? '')) return 'invalid-deployment-id';
	if (deployment.projectId !== config.projectId) return 'wrong-project';
	if (deployment.meta?.thingtimeAdminPrPreview !== '1') return 'missing-marker';
	if (deployment.meta?.thingtimePreviewEnvironment !== environment) return 'wrong-environment';
	if (String(deployment.meta?.githubPrId ?? '') !== String(prNumber)) return 'wrong-pull-request';
	if (String(deployment.meta?.githubRepoId ?? '') !== String(config.gitRepoId)) return 'wrong-vercel-repository';
	if (String(deployment.meta?.githubRepositoryId ?? '') !== String(config.repositoryId)) return 'wrong-github-repository';
	if (sha && deployment.meta?.githubCommitSha !== sha) return 'wrong-sha';
	if (ref && deployment.meta?.githubCommitRef !== ref) return 'wrong-ref';
	return null;
};

const deploymentEnvironmentIssue = (deployment, config, environment) => {
	if (environment === 'develop' && deployment.customEnvironment?.id !== config.developEnvironmentId) return 'wrong-develop-environment';
	if (environment === 'production' && deployment.target !== 'production') return 'wrong-production-environment';
	return null;
};

const cleanupDeploymentIssue = (deployment, config, input) => {
	const ownershipIssue = deploymentOwnershipIssue(deployment, config, input);
	if (ownershipIssue) return ownershipIssue;
	return deploymentEnvironmentIssue(deployment, config, input.environment);
};

const deploymentIssue = (deployment, config, input) => {
	const cleanupIssue = cleanupDeploymentIssue(deployment, config, input);
	if (cleanupIssue) return cleanupIssue;
	if (deployment.meta?.thingtimeGithubPrebuiltPreview !== '1') return 'missing-prebuilt-marker';
	return null;
};

const deploymentStatus = (deployment) => String(deployment?.readyState ?? deployment?.state ?? 'QUEUED').toUpperCase();

const deploymentUrl = (deployment) => {
	try {
		const parsed = new URL(String(deployment?.url ?? '').startsWith('https://') ? deployment.url : `https://${deployment?.url ?? ''}`);
		if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || !parsed.hostname.endsWith('.vercel.app')) {
			throw new Error('invalid');
		}
		return parsed.toString();
	} catch {
		throw new Error('Vercel returned an invalid immutable deployment URL');
	}
};

const listOwnedDeployments = async (config, prNumber, environment) => {
	const owned = [];
	let until = null;
	for (let page = 1; page <= MAX_VERCEL_PAGES; page += 1) {
		const params = new URLSearchParams({
			projectId: config.projectId,
			limit: '100',
			'meta-thingtimeAdminPrPreview': '1',
			'meta-thingtimePreviewEnvironment': environment,
			'meta-githubPrId': String(prNumber)
		});
		if (until) params.set('until', String(until));
		const payload = await vercelRequest(config, `/v6/deployments?${params}`);
		const deployments = Array.isArray(payload?.deployments) ? payload.deployments : [];
		owned.push(...deployments.filter((deployment) => deploymentOwnershipIssue(deployment, config, { prNumber, environment }) === null));
		if (deployments.length < 100) return owned;
		until = Math.min(...deployments.map((deployment) => Number(deployment.createdAt ?? deployment.created)).filter(Number.isFinite)) - 1;
		if (!Number.isFinite(until)) throw new Error('Vercel deployment pagination was invalid');
	}
	throw new Error('Vercel deployment scan exceeded its safety bound');
};

const deploymentDetail = (config, id) => vercelRequest(config, `/v13/deployments/${encodeURIComponent(id)}?withGitRepoInfo=true`);

const getAlias = async (config, alias) => {
	const params = new URLSearchParams({ projectId: config.projectId });
	try {
		const found = await vercelRequest(config, `/v4/aliases/${encodeURIComponent(alias)}?${params}`);
		if (found?.alias !== alias || found?.projectId !== config.projectId || !/^dpl_[A-Za-z0-9]+$/.test(found?.deploymentId ?? '')) {
			throw new Error('Preview alias ownership did not match the configured project');
		}
		return found;
	} catch (error) {
		if (error instanceof HttpError && error.status === 404) return null;
		throw error;
	}
};

const removeAlias = async (config, prNumber, environment) => {
	const alias = previewAlias(prNumber, environment, config);
	const found = await getAlias(config, alias);
	if (!found) return false;
	const deployment = await deploymentDetail(config, found.deploymentId);
	if (cleanupDeploymentIssue(deployment, config, { prNumber, environment })) {
		throw new Error('Refusing to remove an alias owned by another deployment');
	}
	await vercelRequest(config, `/v2/aliases/${encodeURIComponent(found.uid)}`, { method: 'DELETE', accept: [200, 204, 404] });
	return true;
};

const deleteOwnedDeployments = async (config, prNumber, environment, keepIds = new Set()) => {
	const deployments = await listOwnedDeployments(config, prNumber, environment);
	for (const deployment of deployments) {
		const id = String(deployment.id ?? deployment.uid ?? '');
		if (keepIds.has(id)) continue;
		const detail = await deploymentDetail(config, id);
		if (cleanupDeploymentIssue(detail, config, { prNumber, environment })) continue;
		await vercelRequest(config, `/v13/deployments/${encodeURIComponent(id)}`, { method: 'DELETE', accept: [200, 204, 404] });
	}
};

const assertPrebuiltOutput = async (directory) => {
	const outputDirectory = resolve(directory, '.vercel/output');
	const [rawConfig, indexHtml] = await Promise.all([
		readFile(resolve(outputDirectory, 'config.json'), 'utf8'),
		readFile(resolve(outputDirectory, 'static/index.html'), 'utf8')
	]);
	const outputConfig = JSON.parse(rawConfig);
	if (!Array.isArray(outputConfig.routes)) throw new Error('Prebuilt Vercel output config is missing routes');
	if (!indexHtml.includes('<div id="root"></div>')) throw new Error('Prebuilt Vercel output is missing the Vite root shell');
	return outputDirectory;
};

const prebuiltDeploymentArgs = ({ config, environment, prebuiltDirectory, metadata }) => {
	const args = [
		'deploy',
		'--prebuilt',
		'--archive=tgz',
		`--target=${environment}`,
		'--skip-domain',
		'--yes',
		'--scope',
		config.teamSlug,
		'--cwd',
		prebuiltDirectory
	];
	for (const [key, value] of Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right))) {
		args.push('--meta', `${key}=${value}`);
	}
	return args;
};

const deployPrebuiltOutput = async (config, pullRequest, environment) => {
	const prebuiltDirectory = resolve(requiredEnv('VERCEL_PREBUILT_ROOT'), environment);
	await assertPrebuiltOutput(prebuiltDirectory);
	await mkdir(resolve(prebuiltDirectory, '.vercel'), { recursive: true });
	await writeFile(resolve(prebuiltDirectory, '.vercel/project.json'), `${JSON.stringify({ orgId: config.teamId, projectId: config.projectId })}\n`, {
		mode: 0o600
	});
	const args = prebuiltDeploymentArgs({
		config,
		environment,
		prebuiltDirectory,
		metadata: deploymentMetadata(config, pullRequest, environment)
	});
	const { stdout } = await execFileAsync(resolve(requiredEnv('VERCEL_CLI_PATH')), args, {
		env: {
			...process.env,
			VERCEL_ORG_ID: config.teamId,
			VERCEL_PROJECT_ID: config.projectId,
			VERCEL_TOKEN: requiredEnv('VERCEL_API_TOKEN')
		},
		maxBuffer: 4 * 1024 * 1024,
		timeout: 10 * 60 * 1000
	});
	const urls = String(stdout).match(/https:\/\/[a-z0-9.-]+\.vercel\.app\/?/gi) ?? [];
	const hostname = urls.length ? new URL(urls.at(-1)).hostname : '';
	if (!hostname.endsWith('.vercel.app')) throw new Error('Vercel CLI did not return an exact deployment URL');
	return deploymentDetail(config, hostname);
};

const createDeployment = async (config, pullRequest, environment) => {
	const summaries = await listOwnedDeployments(config, pullRequest.number, environment);
	const existing = (await Promise.all(summaries.map((deployment) => deploymentDetail(config, deployment.id ?? deployment.uid))))
		.filter(
			(deployment) =>
				deploymentIssue(deployment, config, {
					prNumber: pullRequest.number,
					environment,
					sha: pullRequest.head.sha,
					ref: pullRequest.head.ref
				}) === null &&
				(deploymentStatus(deployment) === 'READY' || ACTIVE_STATES.has(deploymentStatus(deployment)))
		)
		.sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0))[0];
	if (existing) return deploymentDetail(config, existing.id ?? existing.uid);
	const detail = await deployPrebuiltOutput(config, pullRequest, environment);
	const issue = deploymentIssue(detail, config, {
		prNumber: pullRequest.number,
		environment,
		sha: pullRequest.head.sha,
		ref: pullRequest.head.ref
	});
	if (issue) throw new Error(`Uploaded Vercel deployment failed identity validation (${issue})`);
	return detail;
};

const waitForDeployment = async (config, pullRequest, environment, deployment) => {
	const timeoutAt = Date.now() + 30 * 60 * 1000;
	let current = deployment;
	while (ACTIVE_STATES.has(deploymentStatus(current)) && Date.now() < timeoutAt) {
		await delay(15_000);
		current = await deploymentDetail(config, current.id ?? current.uid);
		const issue = deploymentIssue(current, config, {
			prNumber: pullRequest.number,
			environment,
			sha: pullRequest.head.sha,
			ref: pullRequest.head.ref
		});
		if (issue) throw new Error(`Vercel deployment identity changed while building (${issue})`);
	}
	const status = deploymentStatus(current);
	if (status === 'READY') return current;
	if (FAILURE_STATES.has(status)) throw new Error(`Vercel deployment ended in ${status}`);
	throw new Error('Vercel deployment did not become ready within 30 minutes');
};

const assignAlias = async (config, pullRequest, environment, deployment) => {
	const issue = deploymentIssue(deployment, config, {
		prNumber: pullRequest.number,
		environment,
		sha: pullRequest.head.sha,
		ref: pullRequest.head.ref
	});
	if (issue || deploymentStatus(deployment) !== 'READY') {
		throw new Error(`Refusing to alias an unverified deployment (${issue ?? deploymentStatus(deployment)})`);
	}
	const alias = previewAlias(pullRequest.number, environment, config);
	const existing = await getAlias(config, alias);
	if (existing?.deploymentId === deployment.id) return `https://${alias}/`;
	try {
		const assigned = await vercelRequest(config, `/v2/deployments/${encodeURIComponent(deployment.id)}/aliases`, {
			method: 'POST',
			accept: [200],
			body: { alias }
		});
		if (assigned?.alias !== alias) throw new Error('Vercel assigned an unexpected preview alias');
	} catch (error) {
		const reconciled = await getAlias(config, alias);
		if (reconciled?.deploymentId !== deployment.id) throw error;
	}
	const verified = await getAlias(config, alias);
	if (verified?.deploymentId !== deployment.id) throw new Error('Preview alias did not resolve to the expected deployment');
	return `https://${alias}/`;
};

const environmentLabel = (environment) => (environment === 'develop' ? 'Develop' : 'Production / main');

const statusLabel = (status) => {
	const normalized = String(status ?? 'queued').trim().toLowerCase();
	if (normalized === 'ready') return '✅ Ready';
	if (['error', 'failed', 'blocked'].includes(normalized)) return '❌ Failed';
	if (['canceled', 'cancelled'].includes(normalized)) return '⚪ Canceled';
	return `🟡 ${normalized[0]?.toUpperCase() ?? 'Q'}${normalized.slice(1) || 'ueued'}`;
};

const expectedLabel = (row) => {
	const status = String(row.status).toLowerCase();
	if (status === 'ready') return 'Ready now';
	if (['error', 'failed', 'blocked', 'canceled', 'cancelled'].includes(status)) return '—';
	const parsed = Date.parse(row.expectedReadyAt ?? '');
	return Number.isFinite(parsed) ? new Date(parsed).toISOString().replace('T', ' ').replace(':00.000Z', ' UTC') : 'Estimating';
};

const commentBody = ({ pullRequest, rows }) => {
	const ordered = ENVIRONMENTS.flatMap((environment) => rows.filter((row) => row.environment === environment));
	const content = ordered.length
		? [
				'| Environment | Status | Expected ready | Snapshot URL | Persistent URL |',
				'| --- | --- | --- | --- | --- |',
				...ordered.map(
					(row) =>
						`| ${environmentLabel(row.environment)} | ${statusLabel(row.status)} | ${expectedLabel(row)} | ${
							row.snapshotUrl ? `[Open snapshot](${row.snapshotUrl})` : 'Waiting for Vercel'
						} | [Open persistent preview](${row.persistentUrl}) |`
				),
				'',
				'Expected-ready times are estimates. Snapshot URLs are immutable for this commit. Each persistent URL moves only to the newest READY snapshot for that PR and environment.'
			].join('\n')
		: 'No admin-selected preview environments are currently enabled for this PR.';
	return `### 🦄 Thingtime PR previews\n\n- PR: #${pullRequest.number}\n- Commit: \`${pullRequest.head.sha}\`\n\n${content}`;
};

const removedCommentBody = (prNumber) =>
	`### 🧹 Thingtime PR previews removed\n\nThe PR-scoped Develop and Production/Main preview deployments and persistent aliases for PR #${prNumber} were removed.`;

const assertCurrentPullRequest = async (config, payload) => {
	const current = await getPullRequest(config, payload.prNumber);
	const issue = pullRequestIssue(current, payload, config);
	if (issue) throw new Error(`Pull request is no longer eligible (${issue})`);
	return current;
};

const initialRows = (config, pullRequest, environments, startedAt) =>
	environments.map((environment) => ({
		environment,
		status: 'queued',
		snapshotUrl: null,
		persistentUrl: `https://${previewAlias(pullRequest.number, environment, config)}/`,
		expectedReadyAt: expectedReadyAt(startedAt)
	}));

const cleanupEnvironment = async (config, prNumber, environment) => {
	await removeAlias(config, prNumber, environment);
	await deleteOwnedDeployments(config, prNumber, environment);
};

const deployEnvironment = async ({ config, payload, pullRequest, environment, row, publish }) => {
	let deployment = null;
	try {
		deployment = await createDeployment(config, pullRequest, environment);
		row.status = deploymentStatus(deployment).toLowerCase();
		row.snapshotUrl = deploymentUrl(deployment);
		await publish();
		const ready = await waitForDeployment(config, pullRequest, environment, deployment);
		await assertCurrentPullRequest(config, payload);
		row.persistentUrl = await assignAlias(config, pullRequest, environment, ready);
		row.status = 'ready';
		row.snapshotUrl = deploymentUrl(ready);
		row.expectedReadyAt = null;
		await publish();
		await deleteOwnedDeployments(config, pullRequest.number, environment, new Set([ready.id]));
		return ready;
	} catch (error) {
		row.status = 'failed';
		row.expectedReadyAt = null;
		if (deployment?.url) {
			try {
				row.snapshotUrl = deploymentUrl(deployment);
			} catch {
				row.snapshotUrl = null;
			}
		}
		await publish().catch(() => undefined);
		throw error;
	}
};

const writePrepareOutputs = async ({ shouldBuild, pullRequest = null, environments = [] }) => {
	const lines = [`should_build=${shouldBuild ? 'true' : 'false'}`, `environments=${JSON.stringify(environments)}`];
	if (pullRequest) {
		lines.push(`pr_number=${boundedInteger(pullRequest.number, 'PR number')}`);
		lines.push(`head_sha=${pullRequest.head.sha}`);
		lines.push(`head_ref=${pullRequest.head.ref}`);
	}
	await appendFile(requiredEnv('GITHUB_OUTPUT'), `${lines.join('\n')}\n`, { mode: 0o600 });
};

const prepareAdminBuild = async () => {
	if (requiredEnv('GITHUB_EVENT_NAME') !== 'repository_dispatch') throw new Error('Admin previews require repository_dispatch');
	const config = runtimeConfig();
	const event = JSON.parse(await readFile(requiredEnv('GITHUB_EVENT_PATH'), 'utf8'));
	const payload = parseDispatch(event, config);
	const pullRequest = await getPullRequest(config, payload.prNumber);
	const issue = pullRequestIssue(pullRequest, payload, config);
	if (issue) {
		await writePrepareOutputs({ shouldBuild: false });
		console.log(`Admin preview prebuild skipped for PR #${payload.prNumber}: ${issue}`);
		return;
	}
	if (payload.action !== 'closed') {
		const rows = initialRows(config, pullRequest, payload.environments, Date.now());
		await upsertComment(config, pullRequest.number, commentBody({ pullRequest, rows }), rows.length > 0);
	}
	await writePrepareOutputs({
		shouldBuild: payload.action !== 'closed' && payload.environments.length > 0,
		pullRequest,
		environments: payload.environments
	});
	console.log(`Admin preview prebuild planned for PR #${pullRequest.number}: ${payload.environments.join(', ') || 'cleanup only'}`);
};

const runController = async () => {
	if (requiredEnv('GITHUB_EVENT_NAME') !== 'repository_dispatch') throw new Error('Admin previews require repository_dispatch');
	const config = runtimeConfig();
	const event = JSON.parse(await readFile(requiredEnv('GITHUB_EVENT_PATH'), 'utf8'));
	const payload = parseDispatch(event, config);
	const pullRequest = await getPullRequest(config, payload.prNumber);
	const issue = pullRequestIssue(pullRequest, payload, config);
	if (issue) {
		console.log(`Skipped stale admin preview dispatch for PR #${payload.prNumber}: ${issue}`);
		return;
	}
	const disabled = ENVIRONMENTS.filter((environment) => !payload.environments.includes(environment));
	if (payload.action === 'closed') {
		await Promise.all(ENVIRONMENTS.map((environment) => cleanupEnvironment(config, payload.prNumber, environment)));
		await upsertComment(config, payload.prNumber, removedCommentBody(payload.prNumber), false);
		return;
	}
	await Promise.all(disabled.map((environment) => cleanupEnvironment(config, payload.prNumber, environment)));
	const startedAt = Date.now();
	const rows = initialRows(config, pullRequest, payload.environments, startedAt);
	let commentWrite = Promise.resolve();
	const publish = () => {
		commentWrite = commentWrite.then(() => upsertComment(config, pullRequest.number, commentBody({ pullRequest, rows }), rows.length > 0));
		return commentWrite;
	};
	await publish();
	const results = await Promise.allSettled(
		rows.map((row) => deployEnvironment({ config, payload, pullRequest, environment: row.environment, row, publish }))
	);
	const failures = results.filter((result) => result.status === 'rejected');
	if (failures.length) throw new Error(`${failures.length} admin preview environment deployment(s) failed`);
	console.log(`Admin previews ready for PR #${pullRequest.number}: ${payload.environments.join(', ') || 'none'}`);
};

const runSelfTest = () => {
	const config = {
		repository: 'lopugit/thingtime',
		repositoryId: 42,
		dispatcherLogin: EXPECTED_DISPATCHER_LOGIN,
		developEnvironmentId: 'env_develop',
		teamSlug: 'example-team',
		aliasSuffixes: { develop: 'previews.dev.thingtime.com', production: 'previews.thingtime.com' }
	};
	const event = {
		action: CONTROLLER_DISPATCH_TYPE,
		sender: { login: EXPECTED_DISPATCHER_LOGIN, type: 'Bot' },
		client_payload: {
			admin_preview: '1',
			pr_number: '505',
			head_sha: 'a'.repeat(40),
			head_ref: 'codex/example',
			action: 'configure',
			environments: ['production', 'develop']
		}
	};
	assert.deepEqual(parseDispatch(event, config).environments, ['develop', 'production']);
	assert.throws(() => parseDispatch({ ...event, sender: { login: 'github-actions[bot]', type: 'Bot' } }, config), /sender/);
	assert.throws(() => parseDispatch({ ...event, sender: { login: EXPECTED_DISPATCHER_LOGIN, type: 'User' } }, config), /sender/);
	assert.throws(
		() => parseDispatch({ ...event, client_payload: { ...event.client_payload, environments: ['preview'] } }, config),
		/environments/
	);
	assert.equal(previewAlias(505, 'develop', config), 'pr-505.previews.dev.thingtime.com');
	assert.equal(previewAlias(505, 'production', config), 'pr-505.previews.thingtime.com');
	const developArgs = prebuiltDeploymentArgs({ config, environment: 'develop', prebuiltDirectory: '/tmp/prebuilt/develop', metadata: {} });
	assert.ok(developArgs.includes('--target=develop'));
	assert.ok(developArgs.includes('--skip-domain'));
	const productionArgs = prebuiltDeploymentArgs({ config, environment: 'production', prebuiltDirectory: '/tmp/prebuilt/production', metadata: {} });
	assert.ok(productionArgs.includes('--target=production'));
	assert.ok(productionArgs.includes('--skip-domain'));
	const pullRequest = {
		number: 505,
		state: 'open',
		draft: false,
		base: { ref: 'main', repo: { id: 42, full_name: 'lopugit/thingtime' } },
		head: { ref: 'codex/example', sha: 'a'.repeat(40), repo: { id: 42, full_name: 'lopugit/thingtime' } }
	};
	const payload = parseDispatch(event, config);
	assert.equal(pullRequestIssue(pullRequest, payload, config), null);
	assert.equal(pullRequestIssue({ ...pullRequest, draft: true }, payload, config), 'draft');
	assert.equal(pullRequestIssue({ ...pullRequest, head: { ...pullRequest.head, sha: 'b'.repeat(40) } }, payload, config), 'stale-head-sha');
	assert.equal(
		deploymentIssue(
			{
				id: 'dpl_Test123',
				projectId: 'prj_example',
				customEnvironment: { id: 'env_develop' },
				meta: {
					thingtimeAdminPrPreview: '1',
					thingtimeGithubPrebuiltPreview: '1',
					thingtimePreviewEnvironment: 'develop',
					githubPrId: '505',
					githubRepoId: '7',
					githubRepositoryId: '42',
					githubCommitSha: 'a'.repeat(40),
					githubCommitRef: 'codex/example'
				}
			},
			{ ...config, projectId: 'prj_example', gitRepoId: 7 },
			{ prNumber: 505, environment: 'develop', sha: 'a'.repeat(40), ref: 'codex/example' }
		),
		null
	);
	const rows = initialRows(config, pullRequest, ['develop', 'production'], Date.now());
	const body = commentBody({ pullRequest, rows });
	assert.match(body, /Expected ready/);
	assert.match(body, /pr-505\.previews\.dev\.thingtime\.com/);
	assert.match(body, /pr-505\.previews\.thingtime\.com/);
	console.log('Admin PR preview controller self-test passed');
};

if (process.argv.includes('--self-test')) {
	runSelfTest();
} else if (process.argv.includes('--prepare')) {
	prepareAdminBuild().catch((error) => {
		console.error(error instanceof Error ? error.message : 'Admin PR preview preparation failed');
		process.exitCode = 1;
	});
} else {
	runController().catch((error) => {
		console.error(error instanceof Error ? error.message : 'Admin PR preview controller failed');
		process.exitCode = 1;
	});
}
