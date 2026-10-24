#!/usr/bin/env node

import assert from 'node:assert/strict';
import { isManagedPreviewComment as isManagedComment, upsertPreviewComment, publishPreviewNotifications } from './preview-comments.mjs';
import { syncPreviewLabels, deploymentBuiltAt, previewBuildTime } from './preview-labels.mjs';
import { recoverySourceIssue, previewWorkActive, recoveryAttempt, reconcilePreviewInventory } from './preview-recovery.mjs';
import { execFile } from 'node:child_process';
import { resolveCname } from 'node:dns/promises';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const COMMENT_MARKER = '<!-- thingtime-develop-pr-preview -->';
const WORKFLOW_DEPLOYMENT_MARKER = 'thingtimeDevelopPrPreview';
const PREBUILT_DEPLOYMENT_MARKER = 'thingtimeGithubPrebuiltPreview';
const CONTROLLER_DISPATCH_TYPE = 'develop-pr-preview-controller';
const CONTROLLER_WORKFLOW_PATH = '.github/workflows/develop-pr-preview.yml';
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const TRUSTED_PERMISSIONS = new Set(['admin', 'write']);
const PR_EVENT_ACTIONS = new Set(['opened', 'synchronize', 'reopened', 'ready_for_review', 'converted_to_draft', 'edited', 'closed']);
const ACTIVE_STATES = new Set(['QUEUED', 'INITIALIZING', 'BUILDING']);
const TERMINAL_FAILURE_STATES = new Set(['BLOCKED', 'CANCELED', 'ERROR']);
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);
const CLEANUP_ACTIONS = new Set(['closed', 'converted_to_draft', 'edited']);
const MAX_DEPLOYMENT_PAGES = 20;
const MAX_WORKFLOW_DEPLOYMENTS = 500;
const MAX_RECONCILE_PULL_REQUESTS = 100;
const MAX_GITHUB_PAGES = 10;
const REQUEST_TIMEOUT_MS = 30_000;
const CANCEL_TIMEOUT_MS = 2 * 60 * 1000;
const STABLE_DEVELOP_TIMEOUT_MS = 10 * 60 * 1000;
const STABLE_DEVELOP_POLL_MS = 5_000;
const MAX_STABLE_DEPLOYMENTS = 50;
const DEFAULT_EXPECTED_BUILD_MINUTES = 5;
const execFileAsync = promisify(execFile);

class HttpError extends Error {
	constructor(status, code) {
		super(`Request failed with HTTP ${status} (${code})`);
		this.name = 'HttpError';
		this.status = status;
		this.code = code;
	}
}

class EligibilityError extends Error {
	constructor(reason) {
		super(`Pull request is no longer eligible (${reason})`);
		this.name = 'EligibilityError';
		this.reason = reason;
	}
}

const requiredEnv = (name) => {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Missing required workflow setting: ${name}`);
	return value;
};

const optionalEnv = (name, fallback) => {
	const value = process.env[name]?.trim();
	return value || fallback;
};

const expectedReadyAt = (startedAt = Date.now()) => {
	const minutes = Number(optionalEnv('PREVIEW_EXPECTED_BUILD_MINUTES', String(DEFAULT_EXPECTED_BUILD_MINUTES)));
	if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 60) {
		throw new Error('PREVIEW_EXPECTED_BUILD_MINUTES must be a whole number from 1 to 60');
	}
	return new Date(Math.ceil((startedAt + minutes * 60_000) / 60_000) * 60_000).toISOString();
};

const expectedReadyForRun = () => {
	const value = process.env.PREVIEW_EXPECTED_READY_AT?.trim();
	if (!value) return expectedReadyAt();
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
		throw new Error('PREVIEW_EXPECTED_READY_AT was invalid');
	}
	return value;
};

const boundedInteger = (value, name) => {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1) {
		throw new Error(`${name} must be a positive integer`);
	}
	return parsed;
};

const exactPrefixedId = (value, name, prefix) => {
	const normalized = String(value ?? '').trim();
	if (!new RegExp(`^${prefix}[A-Za-z0-9]+$`).test(normalized)) {
		throw new Error(`${name} must be an exact ${prefix} identifier`);
	}
	return normalized;
};

const safeRepository = (value) => {
	const repository = String(value ?? '').trim();
	if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
		throw new Error('GitHub repository is invalid');
	}
	return repository;
};

const normalizeLogin = (value) => {
	const login = String(value ?? '')
		.trim()
		.toLowerCase();
	if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(login)) {
		throw new Error('GitHub login is invalid');
	}
	return login;
};

const isSafeHeadRef = (value) =>
	typeof value === 'string' && value.length >= 1 && value.length <= 255 && !/[\u0000-\u001f\u007f]/.test(value);

const parseTrustedLogins = (value) => {
	const entries = String(value ?? '')
		.split(/[\s,]+/)
		.filter(Boolean)
		.map(normalizeLogin);
	if (entries.length === 0) throw new Error('Trusted GitHub login allowlist is empty');
	return new Set(entries);
};

const isHostnameLabel = (value) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value);

const safeHostname = (value, name) => {
	const hostname = String(value ?? '')
		.trim()
		.toLowerCase();
	if (hostname.length > 253 || hostname.includes('..')) throw new Error(`${name} is invalid`);
	const labels = hostname.split('.');
	if (labels.length < 2 || labels.some((label) => !isHostnameLabel(label))) {
		throw new Error(`${name} is invalid`);
	}
	return hostname;
};

const normalizedDnsHostname = (value) => {
	const normalized = String(value ?? '')
		.trim()
		.toLowerCase()
		.replace(/\.$/, '');
	try {
		return safeHostname(normalized, 'DNS hostname');
	} catch {
		return null;
	}
};

const wildcardDnsConfigurationIssue = (domainConfig, resolvedCnames) => {
	if (domainConfig?.configuredBy !== 'CNAME') return 'wrong-configuration-mode';
	const recommendedTargets = new Set(
		(domainConfig.recommendedCNAME ?? []).map((candidate) => normalizedDnsHostname(candidate?.value)).filter(Boolean)
	);
	if (recommendedTargets.size === 0) return 'missing-recommended-cname';
	const liveTargets = new Set((resolvedCnames ?? []).map(normalizedDnsHostname).filter(Boolean));
	if (![...liveTargets].some((target) => recommendedTargets.has(target))) return 'wrong-live-cname';
	return null;
};

const isS3BucketHostname = (hostname) => {
	const awsSuffix = hostname.endsWith('.amazonaws.com.cn') ? '.amazonaws.com.cn' : hostname.endsWith('.amazonaws.com') ? '.amazonaws.com' : null;
	if (!awsSuffix) return false;
	const endpoint = hostname.slice(0, -awsSuffix.length);
	const markerIndex = endpoint.indexOf('.s3');
	if (markerIndex < 3 || markerIndex !== endpoint.lastIndexOf('.s3')) return false;
	const bucket = endpoint.slice(0, markerIndex);
	const service = endpoint.slice(markerIndex + 1);
	if (bucket.length > 63 || !isHostnameLabel(bucket)) return false;
	if (service === 's3') return true;
	if (!service.startsWith('s3.') && !service.startsWith('s3-')) return false;
	return isHostnameLabel(service.slice(3));
};

const safeCorsProbeUrl = (value) => {
	let parsed;
	try {
		parsed = new URL(String(value ?? '').trim());
	} catch {
		throw new Error('Develop S3 CORS probe URL is invalid');
	}
	const hostname = safeHostname(parsed.hostname, 'Develop S3 CORS probe hostname');
	if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || !isS3BucketHostname(hostname)) {
		throw new Error('Develop S3 CORS probe URL must be an unsigned HTTPS S3 bucket URL');
	}
	return parsed.href;
};

const previewAlias = (number, suffix = 'previews.dev.thingtime.com') => {
	const prNumber = boundedInteger(number, 'PR number');
	return `pr-${prNumber}.${safeHostname(suffix, 'Preview alias suffix')}`;
};

const customEnvironmentDomainNames = (domains) =>
	(Array.isArray(domains) ? domains : [])
		.map((domain) => (typeof domain === 'string' ? domain : domain?.name ?? domain?.domain))
		.filter((domain) => typeof domain === 'string');

const stableDevelopDomainBindingIssue = (customEnvironment, stableDomain, config) => {
	if (customEnvironmentDomainNames(customEnvironment?.domains).length !== 0) return 'custom-environment-domain-present';
	if (stableDomain?.projectId !== config.projectId) return 'wrong-project';
	if (stableDomain?.verified !== true) return 'unverified';
	if (stableDomain?.gitBranch !== 'develop') return 'wrong-git-branch';
	if (stableDomain?.customEnvironmentId != null && stableDomain.customEnvironmentId !== '') return 'custom-environment-bound';
	return null;
};

const previewWildcardBindingIssue = (wildcardDomain, { projectId, suffix, expectedGitBranch }) => {
	if (wildcardDomain?.projectId !== projectId) return 'wrong-project';
	if (wildcardDomain?.name !== `*.${suffix}`) return 'wrong-name';
	if (wildcardDomain?.verified !== true) return 'unverified';
	if ((wildcardDomain?.gitBranch ?? null) !== expectedGitBranch) return 'wrong-git-branch';
	if (wildcardDomain?.customEnvironmentId != null && wildcardDomain.customEnvironmentId !== '') return 'custom-environment-bound';
	return null;
};

const stableDevelopDeploymentIssue = (deployment, config, expectedSha) => {
	if (!deployment || typeof deployment !== 'object') return 'missing-deployment';
	if (!/^dpl_[A-Za-z0-9]+$/.test(deployment.id ?? '')) return 'invalid-deployment-id';
	if (deployment.projectId !== config.projectId) return 'wrong-project';
	if (deployment.customEnvironment?.id !== config.customEnvironmentId || deployment.customEnvironment?.slug !== 'develop') {
		return 'wrong-environment';
	}
	if (deployment.meta?.[WORKFLOW_DEPLOYMENT_MARKER] === '1') return 'pr-preview-deployment';
	if (deployment.gitSource?.type !== 'github') return 'wrong-git-provider';
	if (String(deployment.gitSource?.repoId ?? '') !== String(config.gitRepoId)) return 'wrong-git-repository';
	if (deployment.gitSource?.ref !== 'develop') return 'wrong-git-ref';
	if (deployment.gitSource?.prId != null) return 'pull-request-deployment';
	if (!/^[0-9a-f]{40}$/.test(deployment.gitSource?.sha ?? '')) return 'invalid-git-sha';
	if (expectedSha && deployment.gitSource.sha !== expectedSha) return 'wrong-git-sha';
	if (String(deployment.meta?.githubRepoId ?? '') !== String(config.gitRepoId)) return 'metadata-git-repository-mismatch';
	const [repositoryOwner, repositoryName] = config.repository.split('/');
	if (deployment.meta?.githubCommitOrg !== repositoryOwner || deployment.meta?.githubCommitRepo !== repositoryName) {
		return 'metadata-repository-name-mismatch';
	}
	if (deployment.meta?.githubCommitRef !== 'develop') return 'metadata-ref-mismatch';
	if (deployment.meta?.githubCommitSha !== deployment.gitSource.sha) return 'metadata-sha-mismatch';
	return null;
};

const runtimeConfig = () => ({
	repository: safeRepository(requiredEnv('GITHUB_REPOSITORY')),
	repositoryId: boundedInteger(requiredEnv('GITHUB_REPOSITORY_ID'), 'GitHub repository id'),
	actor: null,
	trustedLogins: parseTrustedLogins(requiredEnv('DEVELOP_PREVIEW_TRUSTED_ACTORS')),
	projectId: exactPrefixedId(requiredEnv('VERCEL_PROJECT_ID'), 'Vercel project id', 'prj_'),
	projectName: requiredEnv('VERCEL_PROJECT_NAME'),
	teamId: exactPrefixedId(requiredEnv('VERCEL_TEAM_ID'), 'Vercel team id', 'team_'),
	teamSlug: requiredEnv('VERCEL_TEAM_SLUG'),
	gitRepoId: boundedInteger(requiredEnv('VERCEL_GITHUB_REPO_ID'), 'Vercel Git repository id'),
	customEnvironmentId: exactPrefixedId(requiredEnv('VERCEL_CUSTOM_ENVIRONMENT_ID'), 'Vercel custom environment id', 'env_'),
	previewAliasSuffix: safeHostname(requiredEnv('PREVIEW_ALIAS_SUFFIX'), 'Preview alias suffix'),
	productionPreviewAliasSuffix: safeHostname(
		optionalEnv('PRODUCTION_PREVIEW_ALIAS_SUFFIX', 'previews.thingtime.com'),
		'Production preview alias suffix'
	),
	stableDevelopDomain: safeHostname(requiredEnv('STABLE_DEVELOP_DOMAIN'), 'Stable develop domain')
});

const pullRequestShapeIssue = (pullRequest, repository, repositoryId) => {
	if (!pullRequest || typeof pullRequest !== 'object') {
		return 'missing-pull-request';
	}
	if (pullRequest.state !== 'open') return 'not-open';
	if (Number(pullRequest.base?.repo?.id) !== repositoryId || pullRequest.base?.repo?.full_name !== repository) {
		return 'wrong-base-repository';
	}
	if (!isSafeHeadRef(pullRequest.base?.ref)) return 'invalid-base-ref';
	if (Number(pullRequest.head?.repo?.id) !== repositoryId || pullRequest.head?.repo?.full_name !== repository) {
		return 'fork';
	}
	if (!TRUSTED_ASSOCIATIONS.has(pullRequest.author_association)) {
		return 'untrusted-association';
	}
	if (pullRequest.draft) return 'draft';
	if (!/^[0-9a-f]{40}$/.test(pullRequest.head?.sha ?? '')) {
		return 'invalid-sha';
	}
	if (!isSafeHeadRef(pullRequest.head?.ref)) {
		return 'invalid-ref';
	}
	try {
		normalizeLogin(pullRequest.user?.login);
	} catch {
		return 'invalid-author';
	}
	return null;
};

const classifyPullRequest = (pullRequest, repository, repositoryId) => {
	const shapeIssue = pullRequestShapeIssue(pullRequest, repository, repositoryId);
	if (shapeIssue) return { allowed: false, reason: shapeIssue };
	return { allowed: true };
};

const pullRequestSnapshot = (pullRequest) => ({
	number: boundedInteger(pullRequest.number, 'PR number'),
	author: normalizeLogin(pullRequest.user?.login),
	sha: pullRequest.head.sha,
	ref: pullRequest.head.ref,
	headRepositoryId: Number(pullRequest.head.repo.id),
	baseRepositoryId: Number(pullRequest.base.repo.id)
});

const pullRequestMatchesSnapshot = (pullRequest, snapshot) =>
	pullRequest.number === snapshot.number &&
	normalizeLogin(pullRequest.user?.login) === snapshot.author &&
	pullRequest.head?.sha === snapshot.sha &&
	pullRequest.head?.ref === snapshot.ref &&
	Number(pullRequest.head?.repo?.id) === snapshot.headRepositoryId &&
	Number(pullRequest.base?.repo?.id) === snapshot.baseRepositoryId;

const repositoryDispatchSourceIssue = (run, payload, config) => {
	if (!run || typeof run !== 'object') return 'missing-workflow-run';
	if (Number(run.id) !== payload.sourceRunId) return 'wrong-workflow-run';
	if (run.event !== 'pull_request_target') return 'wrong-source-event';
	if (String(run.path ?? '').split('@')[0] !== CONTROLLER_WORKFLOW_PATH) return 'wrong-workflow-path';
	if (Number(run.repository?.id) !== config.repositoryId) return 'wrong-workflow-repository';
	let triggeringActor;
	try {
		triggeringActor = normalizeLogin(run.triggering_actor?.login ?? run.actor?.login);
	} catch {
		return 'invalid-triggering-actor';
	}
	if (triggeringActor !== payload.actor) return 'wrong-triggering-actor';
	if (!['queued', 'in_progress', 'completed'].includes(run.status)) return 'invalid-workflow-run-state';
	const sourcePullRequest = Array.isArray(run.pull_requests)
		? run.pull_requests.find((candidate) => Number(candidate.number) === payload.prNumber)
		: null;
	if (!sourcePullRequest) {
		// GitHub can remove the workflow run's pull_requests association while the
		// PR is still open (observed after a successful listener dispatch). Bind the
		// missing association to the same-repository run's immutable head instead;
		// the current PR and its live head are independently revalidated below.
		if (Number(run.head_repository?.id) !== config.repositoryId) return 'wrong-source-head-repository';
		if (run.head_sha !== payload.headSha) return 'wrong-source-head-sha';
		if (run.head_branch !== payload.headRef) return 'wrong-source-head-ref';
		return null;
	}
	if (Number(sourcePullRequest.head?.repo?.id) !== config.repositoryId || Number(sourcePullRequest.base?.repo?.id) !== config.repositoryId) {
		return 'wrong-source-pull-request-repository';
	}
	if (sourcePullRequest.head?.sha !== payload.headSha) return 'wrong-source-head-sha';
	if (sourcePullRequest.head?.ref !== payload.headRef) return 'wrong-source-head-ref';
	return null;
};

const dispatchPullRequestIssue = (pullRequest, dispatch) => {
	if (!dispatch) return null;
	if (pullRequest.head?.sha !== dispatch.headSha) return 'head-sha-mismatch';
	if (pullRequest.head?.ref !== dispatch.headRef) return 'head-ref-mismatch';
	if (dispatch.action === 'closed' && pullRequest.state !== 'closed') return 'closed-state-mismatch';
	return null;
};

const workflowDeploymentCommitSha = (deployment) => deployment?.meta?.githubCommitSha ?? deployment?.gitSource?.sha ?? null;
const workflowDeploymentCommitRef = (deployment) => deployment?.meta?.githubCommitRef ?? deployment?.gitSource?.ref ?? null;

const deploymentMetadata = ({ pullRequest, config }) => {
	const [githubCommitOrg, githubCommitRepo] = config.repository.split('/');
	return {
		githubCommitOrg,
		githubCommitRepo,
		githubCommitRef: pullRequest.head.ref,
		githubCommitSha: pullRequest.head.sha,
		githubPrId: String(pullRequest.number),
		githubRepoId: String(config.gitRepoId),
		thingtimeCustomEnvironmentId: config.customEnvironmentId,
		[WORKFLOW_DEPLOYMENT_MARKER]: '1',
		[PREBUILT_DEPLOYMENT_MARKER]: '1'
	};
};

const deploymentIdentityIssue = (deployment, config, { prNumber, expectedSha, expectedRef } = {}) => {
	if (!deployment || typeof deployment !== 'object') return 'missing-deployment';
	if (!/^dpl_[A-Za-z0-9]+$/.test(deployment.id ?? '')) return 'invalid-deployment-id';
	if (deployment.projectId !== config.projectId) return 'wrong-project';
	if (deployment.customEnvironment?.id !== config.customEnvironmentId) return 'wrong-environment';
	if (deployment.meta?.[WORKFLOW_DEPLOYMENT_MARKER] !== '1') return 'missing-marker';
	if (prNumber !== undefined && String(deployment.meta?.githubPrId ?? '') !== String(prNumber)) {
		return 'wrong-pull-request';
	}
	if (String(deployment.meta?.githubRepoId ?? '') !== String(config.gitRepoId)) {
		return 'metadata-git-repository-mismatch';
	}
	if (String(deployment.meta?.githubRepositoryId ?? deployment.meta?.githubRepoId ?? '') !== String(config.repositoryId)) {
		return 'metadata-github-repository-mismatch';
	}
	if (deployment.meta?.thingtimeCustomEnvironmentId !== config.customEnvironmentId) {
		return 'metadata-environment-mismatch';
	}
	const [repositoryOwner, repositoryName] = config.repository.split('/');
	if (deployment.meta?.githubCommitOrg !== repositoryOwner || deployment.meta?.githubCommitRepo !== repositoryName) {
		return 'metadata-repository-name-mismatch';
	}
	if (!/^[0-9a-f]{40}$/.test(deployment.meta?.githubCommitSha ?? '')) return 'invalid-metadata-sha';
	if (!isSafeHeadRef(deployment.meta?.githubCommitRef)) return 'invalid-metadata-ref';
	if (deployment.meta?.[PREBUILT_DEPLOYMENT_MARKER] === '1') {
		if (deployment.gitSource != null) {
			if (deployment.gitSource.type !== 'github') return 'wrong-git-provider';
			if (String(deployment.gitSource.repoId ?? '') !== String(config.gitRepoId)) return 'wrong-git-repository';
			if (deployment.gitSource.sha !== deployment.meta.githubCommitSha) return 'metadata-sha-mismatch';
			if (deployment.gitSource.ref !== deployment.meta.githubCommitRef) return 'metadata-ref-mismatch';
		}
	} else {
		if (deployment.gitSource?.type !== 'github') return 'wrong-git-provider';
		if (String(deployment.gitSource?.repoId ?? '') !== String(config.gitRepoId)) return 'wrong-git-repository';
		if (deployment.meta.githubCommitSha !== deployment.gitSource.sha) return 'metadata-sha-mismatch';
		if (deployment.meta.githubCommitRef !== deployment.gitSource.ref) return 'metadata-ref-mismatch';
	}
	if (expectedSha && workflowDeploymentCommitSha(deployment) !== expectedSha) return 'wrong-git-sha';
	if (expectedRef && workflowDeploymentCommitRef(deployment) !== expectedRef) return 'wrong-git-ref';
	return null;
};

const choosePreferredDeployment = (deployments, expectedSha) =>
	deployments
		.filter(
			(deployment) =>
				workflowDeploymentCommitSha(deployment) === expectedSha &&
				(deployment.readyState === 'READY' || ACTIVE_STATES.has(deployment.readyState))
		)
		.sort((left, right) => {
			const readiness = Number(right.readyState === 'READY') - Number(left.readyState === 'READY');
			return readiness || Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0);
		})[0] ?? null;

const chooseStableDevelopDeployment = (deployments, config, expectedSha) =>
	deployments
		.filter(
			(deployment) =>
				stableDevelopDeploymentIssue(deployment, config, expectedSha) === null &&
				(deployment.readyState === 'READY' || ACTIVE_STATES.has(deployment.readyState))
		)
		.sort((left, right) => {
			const readiness = Number(right.readyState === 'READY') - Number(left.readyState === 'READY');
			return readiness || Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0);
		})[0] ?? null;

const deploymentListParams = (config, { prNumber = null, sha = null, until = null, workflowOwned = true } = {}) => {
	const params = new URLSearchParams({
		projectId: config.projectId,
		limit: '100'
	});
	if (workflowOwned) params.set(`meta-${WORKFLOW_DEPLOYMENT_MARKER}`, '1');
	if (prNumber !== null && !workflowOwned) throw new Error('PR deployment filters require workflow ownership');
	if (prNumber !== null) params.set('meta-githubPrId', String(boundedInteger(prNumber, 'PR number')));
	if (sha) {
		if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('Vercel deployment SHA filter is invalid');
		params.set(workflowOwned ? 'meta-githubCommitSha' : 'sha', sha);
	}
	if (until !== null) params.set('until', String(boundedInteger(until, 'Vercel deployment cursor')));
	return params;
};

const runSelfTest = async () => {
	let checks = 0;
	const equal = (actual, expected) => {
		assert.deepEqual(actual, expected);
		checks += 1;
	};
	const truthy = (value) => {
		assert.ok(value);
		checks += 1;
	};
	const throws = (callback) => {
		assert.throws(callback);
		checks += 1;
	};

	const base = {
		number: 201,
		state: 'open',
		draft: false,
		author_association: 'OWNER',
		user: { login: 'lopu' },
		base: { ref: 'develop', repo: { id: 42, full_name: 'lopugit/thingtime' } },
		head: {
			ref: 'codex/example',
			sha: 'a'.repeat(40),
			repo: { id: 42, full_name: 'lopugit/thingtime' }
		}
	};
	const config = {
		repository: 'lopugit/thingtime',
		repositoryId: 42,
		projectId: 'prj_example',
		projectName: 'thingtime',
		gitRepoId: 4242,
		customEnvironmentId: 'env_develop',
		stableDevelopDomain: 'dev.thingtime.com',
		previewAliasSuffix: 'previews.dev.thingtime.com',
		productionPreviewAliasSuffix: 'previews.thingtime.com'
	};
	truthy(
		isManagedPreviewComment({
			user: { login: 'github-actions[bot]', type: 'Bot' },
			author_association: 'NONE',
			body: COMMENT_MARKER
		})
	);
	truthy(
		isManagedPreviewComment({
			user: { login: 'lopugit', type: 'User' },
			author_association: 'OWNER',
			body: COMMENT_MARKER
		})
	);
	truthy(
		!isManagedPreviewComment({
			user: { login: 'outside-user', type: 'User' },
			author_association: 'NONE',
			body: COMMENT_MARKER
		})
	);
	const previousExpectedReady = process.env.PREVIEW_EXPECTED_READY_AT;
	process.env.PREVIEW_EXPECTED_READY_AT = '2026-09-03T12:30:00.000Z';
	equal(expectedReadyForRun(), '2026-09-03T12:30:00.000Z');
	process.env.PREVIEW_EXPECTED_READY_AT = 'not-a-time';
	throws(() => expectedReadyForRun());
	if (previousExpectedReady === undefined) delete process.env.PREVIEW_EXPECTED_READY_AT;
	else process.env.PREVIEW_EXPECTED_READY_AT = previousExpectedReady;

	equal(classifyPullRequest(base, config.repository, config.repositoryId), { allowed: true });
	equal(classifyPullRequest({ ...base, state: 'closed' }, config.repository, config.repositoryId).reason, 'not-open');
	equal(classifyPullRequest({ ...base, base: { ...base.base, ref: 'main' } }, config.repository, config.repositoryId), { allowed: true });
	equal(classifyPullRequest({ ...base, base: { ...base.base, ref: 'release/example' } }, config.repository, config.repositoryId), {
		allowed: true
	});
	equal(pullRequestShapeIssue({ ...base, base: { ...base.base, ref: 'codex/parent' } }, config.repository, config.repositoryId), null);
	equal(
		classifyPullRequest({ ...base, head: { ...base.head, repo: { id: 99, full_name: 'lopugit/thingtime' } } }, config.repository, config.repositoryId)
			.reason,
		'fork'
	);
	equal(classifyPullRequest({ ...base, author_association: 'CONTRIBUTOR' }, config.repository, config.repositoryId).reason, 'untrusted-association');
	equal(classifyPullRequest({ ...base, draft: true }, config.repository, config.repositoryId).reason, 'draft');
	equal(previewAlias(201), 'pr-201.previews.dev.thingtime.com');
	throws(() => previewAlias('../201'));
	throws(() => previewAlias(201, 'previews..thingtime.com'));
	equal(
		safeCorsProbeUrl('https://example-develop.s3.ap-southeast-2.amazonaws.com/cors-probe'),
		'https://example-develop.s3.ap-southeast-2.amazonaws.com/cors-probe'
	);
	equal(safeCorsProbeUrl('https://example-develop.s3.amazonaws.com/cors-probe'), 'https://example-develop.s3.amazonaws.com/cors-probe');
	throws(() => safeCorsProbeUrl('https://example-develop.s3.ap-southeast-2.amazonaws.com/cors-probe?signature=no'));
	throws(() => safeCorsProbeUrl('https://user@example-develop.s3.ap-southeast-2.amazonaws.com/probe'));
	throws(() => safeCorsProbeUrl('https://example.invalid/probe'));
	throws(() => safeCorsProbeUrl(`https://a.s3-${'--'.repeat(10_000)}.amazonaws.com/probe`));
	throws(() => safeCorsProbeUrl('https://example-develop.s3evil.amazonaws.com/probe'));
	equal([...parseTrustedLogins(' Lopu, trusted-bot\n')], ['lopu', 'trusted-bot']);
	throws(() => parseTrustedLogins(''));
	truthy(TRUSTED_PERMISSIONS.has('write'));
	truthy(!TRUSTED_PERMISSIONS.has('read'));
	equal(
		wildcardDnsConfigurationIssue({ configuredBy: 'CNAME', misconfigured: true, recommendedCNAME: [{ value: 'cname.vercel-dns.com.' }] }, [
			'cname.vercel-dns.com'
		]),
		null
	);
	equal(
		wildcardDnsConfigurationIssue({ configuredBy: 'CNAME', misconfigured: false, recommendedCNAME: [{ value: 'cname.vercel-dns.com.' }] }, [
			'wrong.example.com'
		]),
		'wrong-live-cname'
	);
	equal(
		wildcardDnsConfigurationIssue({ configuredBy: 'A', recommendedCNAME: [{ value: 'cname.vercel-dns.com.' }] }, ['cname.vercel-dns.com']),
		'wrong-configuration-mode'
	);

	const snapshot = pullRequestSnapshot(base);
	truthy(pullRequestMatchesSnapshot(base, snapshot));
	truthy(!pullRequestMatchesSnapshot({ ...base, head: { ...base.head, sha: 'b'.repeat(40) } }, snapshot));

	const metadata = deploymentMetadata({ pullRequest: base, config });
	equal(metadata.githubCommitSha, base.head.sha);
	equal(metadata.githubCommitRef, base.head.ref);
	equal(metadata.githubDeployment, undefined);
	equal(metadata[WORKFLOW_DEPLOYMENT_MARKER], '1');
	equal(metadata[PREBUILT_DEPLOYMENT_MARKER], '1');
	equal(Object.keys(metadata).length, 9);
	const runtimeEnvironment = {
		THINGTIME_BRANCH_NAME: base.head.ref,
		THINGTIME_GIT_COMMIT_SHA: base.head.sha
	};
	const prebuiltArgs = prebuiltDeploymentArgs({ config, prebuiltDirectory: '/tmp/prebuilt', metadata, runtimeEnvironment });
	truthy(prebuiltArgs.includes('--target=develop'));
	truthy(!prebuiltArgs.includes('--skip-domain'));
	truthy(prebuiltArgs.includes('--env'));
	truthy(prebuiltArgs.includes(`THINGTIME_BRANCH_NAME=${base.head.ref}`));
	truthy(prebuiltArgs.includes(`THINGTIME_GIT_COMMIT_SHA=${base.head.sha}`));
	equal(customEnvironmentDomainNames(['dev.thingtime.com', { name: 'preview.example.com' }, { domain: 'legacy.example.com' }]), [
		'dev.thingtime.com',
		'preview.example.com',
		'legacy.example.com'
	]);
	equal(customEnvironmentDomainNames(null), []);
	equal(
		stableDevelopDomainBindingIssue(
			{ domains: [] },
			{
				projectId: config.projectId,
				verified: true,
				gitBranch: 'develop',
				customEnvironmentId: null
			},
			config
		),
		null
	);
	equal(
		stableDevelopDomainBindingIssue(
			{ domains: [] },
			{
				projectId: config.projectId,
				verified: true,
				gitBranch: 'develop',
				customEnvironmentId: ''
			},
			config
		),
		null
	);
	equal(
		stableDevelopDomainBindingIssue(
			{ domains: [{ name: config.stableDevelopDomain }] },
			{ projectId: config.projectId, verified: true, gitBranch: 'develop', customEnvironmentId: null },
			config
		),
		'custom-environment-domain-present'
	);
	equal(
		stableDevelopDomainBindingIssue(
			{ domains: [] },
			{ projectId: config.projectId, verified: true, gitBranch: null, customEnvironmentId: config.customEnvironmentId },
			config
		),
		'wrong-git-branch'
	);
	equal(
		previewWildcardBindingIssue(
			{ projectId: config.projectId, name: '*.previews.dev.thingtime.com', verified: true, gitBranch: 'develop', customEnvironmentId: null },
			{ projectId: config.projectId, suffix: config.previewAliasSuffix, expectedGitBranch: 'develop' }
		),
		null
	);
	equal(
		previewWildcardBindingIssue(
			{ projectId: config.projectId, name: '*.previews.thingtime.com', verified: true, gitBranch: null, customEnvironmentId: '' },
			{ projectId: config.projectId, suffix: config.productionPreviewAliasSuffix, expectedGitBranch: null }
		),
		null
	);
	equal(
		previewWildcardBindingIssue(
			{ projectId: config.projectId, name: '*.previews.dev.thingtime.com', verified: true, gitBranch: null, customEnvironmentId: null },
			{ projectId: config.projectId, suffix: config.previewAliasSuffix, expectedGitBranch: 'develop' }
		),
		'wrong-git-branch'
	);

	const deployment = {
		id: 'dpl_example',
		projectId: config.projectId,
		createdAt: 2,
		readyState: 'READY',
		customEnvironment: { id: config.customEnvironmentId, slug: 'develop' },
		meta: {
			[WORKFLOW_DEPLOYMENT_MARKER]: '1',
			githubPrId: '201',
			githubRepoId: String(config.gitRepoId),
			githubRepositoryId: String(config.repositoryId),
			githubCommitOrg: 'lopugit',
			githubCommitRepo: 'thingtime',
			githubCommitSha: base.head.sha,
			githubCommitRef: base.head.ref,
			thingtimeCustomEnvironmentId: config.customEnvironmentId
		},
		gitSource: { type: 'github', repoId: config.gitRepoId, sha: base.head.sha, ref: base.head.ref }
	};
	equal(
		deploymentIdentityIssue(deployment, config, {
			prNumber: base.number,
			expectedSha: base.head.sha,
			expectedRef: base.head.ref
		}),
		null
	);
	const prebuiltDeployment = {
		...deployment,
		meta: { ...deployment.meta, [PREBUILT_DEPLOYMENT_MARKER]: '1' },
		gitSource: null
	};
	equal(
		deploymentIdentityIssue(prebuiltDeployment, config, {
			prNumber: base.number,
			expectedSha: base.head.sha,
			expectedRef: base.head.ref
		}),
		null
	);
	equal(workflowDeploymentCommitSha(prebuiltDeployment), base.head.sha);
	equal(workflowDeploymentCommitRef(prebuiltDeployment), base.head.ref);
	equal(deploymentIdentityIssue({ ...deployment, projectId: 'prj_wrong' }, config, { prNumber: 201 }), 'wrong-project');
	equal(
		deploymentIdentityIssue({ ...deployment, customEnvironment: { id: 'env_wrong', slug: 'develop' } }, config, { prNumber: 201 }),
		'wrong-environment'
	);
	equal(
		deploymentIdentityIssue({ ...deployment, gitSource: { ...deployment.gitSource, repoId: 1 } }, config, { prNumber: 201 }),
		'wrong-git-repository'
	);
	equal(
		deploymentIdentityIssue({ ...deployment, meta: { ...deployment.meta, githubRepositoryId: '99' } }, config, { prNumber: 201 }),
		'metadata-github-repository-mismatch'
	);
	equal(choosePreferredDeployment([deployment], base.head.sha)?.id, deployment.id);
	equal(choosePreferredDeployment([{ ...deployment, readyState: 'ERROR' }], base.head.sha), null);
	const developSha = 'd'.repeat(40);
	const stableDeployment = {
		id: 'dpl_stable',
		projectId: config.projectId,
		createdAt: 3,
		readyState: 'READY',
		customEnvironment: { id: config.customEnvironmentId, slug: 'develop' },
		meta: {
			githubCommitOrg: 'lopugit',
			githubCommitRepo: 'thingtime',
			githubCommitRef: 'develop',
			githubCommitSha: developSha,
			githubRepoId: String(config.gitRepoId),
			// Vercel can associate the standing develop-to-main PR in metadata even
			// though this is a native develop branch deployment. gitSource.prId is
			// the authoritative non-PR fence.
			githubPrId: '289'
		},
		gitSource: { type: 'github', repoId: config.gitRepoId, sha: developSha, ref: 'develop', prId: null }
	};
	equal(stableDevelopDeploymentIssue(stableDeployment, config, developSha), null);
	equal(
		stableDevelopDeploymentIssue(
			{ ...stableDeployment, meta: { ...stableDeployment.meta, [WORKFLOW_DEPLOYMENT_MARKER]: '1' } },
			config,
			developSha
		),
		'pr-preview-deployment'
	);
	equal(
		stableDevelopDeploymentIssue(
			{ ...stableDeployment, gitSource: { ...stableDeployment.gitSource, prId: 201 } },
			config,
			developSha
		),
		'pull-request-deployment'
	);
	equal(stableDevelopDeploymentIssue(stableDeployment, config, 'e'.repeat(40)), 'wrong-git-sha');
	equal(chooseStableDevelopDeployment([stableDeployment], config, developSha)?.id, stableDeployment.id);
	equal(chooseStableDevelopDeployment([{ ...stableDeployment, readyState: 'ERROR' }], config, developSha), null);
	equal(developRefSha({ ref: 'refs/heads/develop', object: { type: 'commit', sha: developSha } }), developSha);
	throws(() => developRefSha({ ref: 'refs/heads/main', object: { type: 'commit', sha: developSha } }));
	equal(Object.fromEntries(deploymentListParams(config, { prNumber: 201, sha: base.head.sha, until: 123 })), {
		projectId: config.projectId,
		limit: '100',
		[`meta-${WORKFLOW_DEPLOYMENT_MARKER}`]: '1',
		'meta-githubPrId': '201',
		'meta-githubCommitSha': base.head.sha,
		until: '123'
	});
	equal(Object.fromEntries(deploymentListParams(config, { sha: developSha, workflowOwned: false })), {
		projectId: config.projectId,
		limit: '100',
		sha: developSha
	});
	throws(() => deploymentListParams(config, { prNumber: 0 }));
	throws(() => deploymentListParams(config, { prNumber: 201, workflowOwned: false }));
	throws(() => deploymentListParams(config, { sha: 'not-a-sha' }));
	truthy(IDEMPOTENT_METHODS.has('GET'));
	truthy(!IDEMPOTENT_METHODS.has('POST'));
	truthy(isRetryableHttpResponse(403, new Headers({ 'retry-after': '2' }), { message: 'secondary rate limit' }));
	truthy(isRetryableHttpResponse(403, new Headers({ 'x-ratelimit-remaining': '0' }), { message: 'API rate limit exceeded' }));
	truthy(isRetryableHttpResponse(403, new Headers(), { message: 'You have exceeded a secondary rate limit.' }));
	truthy(isRetryableHttpResponse(403, new Headers(), null));
	truthy(!isRetryableHttpResponse(403, new Headers(), { message: 'Resource not accessible by integration' }));
	equal(parseErrorCode({ message: 'Resource not accessible by integration' }), 'integration-permission');
	equal(parseErrorCode({ message: 'API rate limit exceeded for installation ID 123.' }), 'api-rate-limit');
	truthy(CLEANUP_ACTIONS.has('converted_to_draft'));

	const dispatchPayload = {
		prNumber: 201,
		sourceRunId: 123,
		actor: 'lopu',
		action: 'synchronize',
		headSha: base.head.sha,
		headRef: base.head.ref
	};
	const sourceRun = {
		id: 123,
		event: 'pull_request_target',
		path: CONTROLLER_WORKFLOW_PATH,
		status: 'in_progress',
		repository: { id: 42 },
		head_repository: { id: 42 },
		head_sha: base.head.sha,
		head_branch: base.head.ref,
		actor: { login: 'lopu' },
		triggering_actor: { login: 'lopu' },
		pull_requests: [
			{
				number: 201,
				head: { sha: base.head.sha, ref: base.head.ref, repo: { id: 42 } },
				base: { repo: { id: 42 } }
			}
		]
	};
	equal(repositoryDispatchSourceIssue(sourceRun, dispatchPayload, config), null);
	equal(repositoryDispatchSourceIssue({ ...sourceRun, path: '.github/workflows/untrusted.yml' }, dispatchPayload, config), 'wrong-workflow-path');
	equal(repositoryDispatchSourceIssue(sourceRun, { ...dispatchPayload, headSha: 'b'.repeat(40) }, config), 'wrong-source-head-sha');
	equal(repositoryDispatchSourceIssue(sourceRun, { ...dispatchPayload, headRef: 'codex/wrong' }, config), 'wrong-source-head-ref');
	equal(repositoryDispatchSourceIssue({ ...sourceRun, pull_requests: [] }, dispatchPayload, config), null);
	equal(
		repositoryDispatchSourceIssue({ ...sourceRun, pull_requests: [], head_repository: { id: 99 } }, dispatchPayload, config),
		'wrong-source-head-repository'
	);
	equal(
		repositoryDispatchSourceIssue({ ...sourceRun, pull_requests: [], head_sha: 'b'.repeat(40) }, dispatchPayload, config),
		'wrong-source-head-sha'
	);
	equal(
		repositoryDispatchSourceIssue({ ...sourceRun, pull_requests: [], head_branch: 'codex/wrong' }, dispatchPayload, config),
		'wrong-source-head-ref'
	);
	const closedDispatchPayload = { ...dispatchPayload, action: 'closed' };
	const closedSourceRun = { ...sourceRun, status: 'completed', pull_requests: [] };
	equal(repositoryDispatchSourceIssue(closedSourceRun, closedDispatchPayload, config), null);
	equal(
		repositoryDispatchSourceIssue({ ...closedSourceRun, head_repository: { id: 99 } }, closedDispatchPayload, config),
		'wrong-source-head-repository'
	);
	equal(repositoryDispatchSourceIssue({ ...closedSourceRun, head_sha: 'b'.repeat(40) }, closedDispatchPayload, config), 'wrong-source-head-sha');
	equal(repositoryDispatchSourceIssue({ ...closedSourceRun, head_branch: 'codex/wrong' }, closedDispatchPayload, config), 'wrong-source-head-ref');
	equal(dispatchPullRequestIssue(base, dispatchPayload), null);
	equal(dispatchPullRequestIssue({ ...base, head: { ...base.head, sha: 'b'.repeat(40) } }, dispatchPayload), 'head-sha-mismatch');
	equal(dispatchPullRequestIssue({ ...base, head: { ...base.head, ref: 'codex/wrong' } }, dispatchPayload), 'head-ref-mismatch');
	equal(dispatchPullRequestIssue(base, closedDispatchPayload), 'closed-state-mismatch');
	equal(dispatchPullRequestIssue({ ...base, state: 'closed' }, closedDispatchPayload), null);
	const parsedDispatch = parseRepositoryDispatch({
		action: CONTROLLER_DISPATCH_TYPE,
		client_payload: {
			pr_number: '201',
			source_run_id: '123',
			actor: 'Lopu',
			action: 'closed',
			head_sha: base.head.sha,
			head_ref: base.head.ref
		}
	});
	equal(parsedDispatch, closedDispatchPayload);
	const recoveryEvent = { action: CONTROLLER_DISPATCH_TYPE, sender: { type: 'Bot', login: 'github-actions[bot]' },
		client_payload: { pr_number: '201', source_run_id: '123', actor: 'lopu', action: 'synchronize',
			head_sha: base.head.sha, head_ref: base.head.ref, recovery: '1' } };
	equal(parseRepositoryDispatch(recoveryEvent), { ...dispatchPayload, action: 'synchronize', recovery: true });
	for (const sender of [undefined, { type: 'User', login: 'lopu' }, { type: 'Bot', login: 'other[bot]' }]) {
		throws(() => parseRepositoryDispatch({ ...recoveryEvent, sender }));
	}
	throws(() => parseRepositoryDispatch({ ...recoveryEvent, client_payload: { ...recoveryEvent.client_payload, action: 'closed' } }));
	throws(() =>
		parseRepositoryDispatch({
			action: CONTROLLER_DISPATCH_TYPE,
			client_payload: { pr_number: '201', source_run_id: '123', actor: 'lopu', action: 'closed', head_sha: base.head.sha, head_ref: '' }
		})
	);
	const acceptedBases = ['main', 'release/example', 'codex/former-parent'];
	for (const baseRef of acceptedBases) {
		const direct = { ...base, base: { ...base.base, ref: baseRef } };
		const checked = await assertTrustedPullRequestStack(config, direct, {
			actor: 'lopu',
			assertPrincipal: async (_config, login, label) => {
				equal(login, 'lopu');
				truthy(label === 'author' || label === 'actor');
			}
		});
		equal(checked.stack.chain.map((candidate) => candidate.number), [201]);
		equal(checked.stack.terminalBranch, baseRef);
	}
	equal(
		pullRequestShapeIssue({ ...base, base: { ...base.base, ref: '' } }, config.repository, config.repositoryId),
		'invalid-base-ref'
	);

	// A trusted control-plane PR still has nothing to preview: its head carries
	// only `.github`, so the contents probe 404s and the PR is ineligible rather
	// than authorized into a build that can only fail.
	const bundleProbe = (result) => async (repository, headSha) => {
		equal(repository, config.repository);
		equal(headSha, base.head.sha);
		if (result instanceof Error) throw result;
		return result;
	};
	await assertPreviewBundle(config, base, { hasPreviewBundle: bundleProbe(true) });
	checks += 1;
	await assert.rejects(
		assertPreviewBundle(config, base, { hasPreviewBundle: bundleProbe(false) }),
		(error) => error instanceof EligibilityError && error.reason === 'head-has-no-preview-bundle'
	);
	checks += 1;
	// A transport fault must not be silently read as "nothing to preview".
	await assert.rejects(
		assertPreviewBundle(config, base, { hasPreviewBundle: bundleProbe(new HttpError(500, 'server_error')) }),
		(error) => error instanceof HttpError && error.status === 500
	);
	checks += 1;
	const contentsProbe = (response) => async (path) => {
		equal(path, `/repos/${config.repository}/contents/${PREVIEW_BUNDLE_PATH}?ref=${base.head.sha}`);
		if (response instanceof Error) throw response;
		return response;
	};
	equal(await headHasPreviewBundle(config.repository, base.head.sha, contentsProbe({ type: 'file' })), true);
	equal(await headHasPreviewBundle(config.repository, base.head.sha, contentsProbe({ type: 'dir' })), false);
	equal(
		await headHasPreviewBundle(config.repository, base.head.sha, contentsProbe(new HttpError(404, 'not_found'))),
		false
	);
	await assert.rejects(
		headHasPreviewBundle(config.repository, base.head.sha, contentsProbe(new HttpError(403, 'forbidden'))),
		(error) => error instanceof HttpError && error.status === 403
	);
	checks += 1;
	await assert.rejects(
		headHasPreviewBundle(config.repository, 'not-a-sha', contentsProbe({ type: 'file' })),
		(error) => error instanceof EligibilityError && error.reason === 'invalid-head-sha'
	);
	checks += 1;

	console.log(`develop PR preview self-test: ${checks}/${checks} passed`);
};

const parseErrorCode = (body) => {
	if (!body || typeof body !== 'object') return 'unknown';
	const code = body.error?.code ?? body.code;
	if (typeof code === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(code)) return code;
	const message = typeof body.message === 'string' ? body.message.toLowerCase() : '';
	if (message.includes('resource not accessible by integration')) return 'integration-permission';
	if (message.includes('secondary rate limit')) return 'secondary-rate-limit';
	if (message.includes('api rate limit exceeded')) return 'api-rate-limit';
	if (message.includes('not found')) return 'not-found';
	if (message.includes('validation failed')) return 'validation-failed';
	return 'unknown';
};

const isRetryableHttpResponse = (status, headers, body) => {
	if (status === 429 || status >= 500) return true;
	if (status !== 403) return false;
	if (headers?.get?.('retry-after')) return true;
	if (headers?.get?.('x-ratelimit-remaining') === '0') return true;
	const message = typeof body?.message === 'string' ? body.message.toLowerCase() : '';
	return (
		!message ||
		message.includes('secondary rate limit') ||
		message.includes('api rate limit exceeded') ||
		message.includes('abuse detection') ||
		message.includes('please wait a few minutes before you try again')
	);
};

const retryDelayMs = (response, attempt) => {
	const retryAfterSeconds = Number(response.headers.get('retry-after'));
	if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
		return Math.min(retryAfterSeconds * 1000, 30_000);
	}
	return 1000 * 2 ** attempt;
};

const requestJson = async (url, { method = 'GET', token, body, accept = [200], retries, timeoutMs = REQUEST_TIMEOUT_MS } = {}) => {
	const normalizedMethod = method.toUpperCase();
	const retryLimit = retries ?? (IDEMPOTENT_METHODS.has(normalizedMethod) ? 3 : 0);
	let lastError = null;
	for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
		let response;
		try {
			response = await fetch(url, {
				method: normalizedMethod,
				headers: {
					Accept: 'application/json',
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json',
					'User-Agent': 'thingtime-develop-pr-preview',
					'X-GitHub-Api-Version': '2022-11-28'
				},
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(timeoutMs)
			});
		} catch {
			lastError = new TypeError('Request failed before a response was received');
			if (attempt < retryLimit) {
				await delay(1000 * 2 ** attempt);
				continue;
			}
			throw lastError;
		}

		const text = await response.text();
		let parsed = null;
		if (text) {
			try {
				parsed = JSON.parse(text);
			} catch {
				parsed = null;
			}
		}
		if (accept.includes(response.status)) return parsed;
		const error = new HttpError(response.status, parseErrorCode(parsed));
		lastError = error;
		if (attempt < retryLimit && isRetryableHttpResponse(response.status, response.headers, parsed)) {
			await delay(retryDelayMs(response, attempt));
			continue;
		}
		throw error;
	}
	throw lastError ?? new Error('Request failed');
};

const githubUrl = (path) => `${process.env.GITHUB_API_URL ?? 'https://api.github.com'}${path}`;

const githubRequest = async (path, options = {}) => {
	try {
		return await requestJson(githubUrl(path), {
			...options,
			token: requiredEnv('GH_TOKEN')
		});
	} catch (error) {
		if (error instanceof HttpError) {
			const pathname = String(path).split('?')[0];
			error.message = `GitHub ${String(options.method ?? 'GET').toUpperCase()} ${pathname} failed with HTTP ${error.status} (${error.code})`;
		}
		throw error;
	}
};

const vercelRequest = (path, options = {}) => {
	const separator = path.includes('?') ? '&' : '?';
	const teamId = encodeURIComponent(requiredEnv('VERCEL_TEAM_ID'));
	return requestJson(`https://api.vercel.com${path}${separator}teamId=${teamId}`, {
		...options,
		token: requiredEnv('VERCEL_API_TOKEN')
	});
};

const getPullRequest = async (repository, number) => githubRequest(`/repos/${repository}/pulls/${boundedInteger(number, 'PR number')}`);

const developRefSha = (reference) => {
	if (reference?.ref !== 'refs/heads/develop' || reference?.object?.type !== 'commit' || !/^[0-9a-f]{40}$/.test(reference.object.sha ?? '')) {
		throw new Error('GitHub develop ref was invalid');
	}
	return reference.object.sha;
};

const getDevelopHeadSha = async (config) => {
	const reference = await githubRequest(`/repos/${config.repository}/git/ref/heads/develop`);
	return developRefSha(reference);
};

const parseRepositoryDispatch = (event) => {
	if (event?.action !== CONTROLLER_DISPATCH_TYPE || !event.client_payload) {
		throw new EligibilityError('unexpected-repository-dispatch');
	}
	const payload = {
		prNumber: boundedInteger(event.client_payload.pr_number, 'PR number'),
		sourceRunId: boundedInteger(event.client_payload.source_run_id, 'Source workflow run id'),
		actor: normalizeLogin(event.client_payload.actor),
		action: String(event.client_payload.action ?? ''),
		headSha: String(event.client_payload.head_sha ?? ''),
		headRef: String(event.client_payload.head_ref ?? '')
	};
	if (event.client_payload.recovery === '1') {
		if (event.sender?.type !== 'Bot' || event.sender?.login !== 'github-actions[bot]' || payload.action !== 'synchronize') {
			throw new EligibilityError('untrusted-recovery-sender');
		}
		payload.recovery = true;
	}
	if (!PR_EVENT_ACTIONS.has(payload.action)) throw new EligibilityError('unexpected-source-action');
	if (!/^[0-9a-f]{40}$/.test(payload.headSha)) throw new EligibilityError('invalid-source-head-sha');
	if (!isSafeHeadRef(payload.headRef)) throw new EligibilityError('invalid-source-head-ref');
	return payload;
};

const assertRepositoryDispatchSource = async (config, event) => {
	const payload = parseRepositoryDispatch(event);
	const run = await githubRequest(`/repos/${config.repository}/actions/runs/${payload.sourceRunId}`);
	const repository = payload.recovery ? await githubRequest(`/repos/${config.repository}`) : null;
	const issue = payload.recovery
		? recoverySourceIssue(run, payload, { ...config, defaultBranch: repository.default_branch })
		: repositoryDispatchSourceIssue(run, payload, config);
	if (issue) throw new EligibilityError(`invalid-dispatch-source-${issue}`);
	return payload;
};

const getRepositoryPermission = async (repository, login) =>
	githubRequest(`/repos/${repository}/collaborators/${encodeURIComponent(login)}/permission`);

const assertTrustedPrincipal = async (config, login, label) => {
	const normalized = normalizeLogin(login);
	if (!config.trustedLogins.has(normalized)) {
		throw new EligibilityError(`${label}-not-allowlisted`);
	}
	let permission;
	try {
		permission = await getRepositoryPermission(config.repository, normalized);
	} catch (error) {
		if (error instanceof HttpError && error.status === 404) {
			throw new EligibilityError(`${label}-no-current-permission`);
		}
		throw error;
	}
	if (!TRUSTED_PERMISSIONS.has(permission?.permission)) {
		throw new EligibilityError(`${label}-requires-write-or-admin`);
	}
};

const assertTrustedPullRequest = async (config, pullRequest, { actor = null, assertPrincipal = assertTrustedPrincipal } = {}) => {
	const shapeIssue = pullRequestShapeIssue(pullRequest, config.repository, config.repositoryId);
	if (shapeIssue) throw new EligibilityError(shapeIssue);
	await assertPrincipal(config, pullRequest.user.login, 'author');
	if (actor) await assertPrincipal(config, actor, 'actor');
	return pullRequest;
};

const assertTrustedPullRequestStack = async (config, pullRequest, { actor = null, assertPrincipal = assertTrustedPrincipal } = {}) => {
	// Preview eligibility belongs to the exact PR being built. Its base may be
	// develop, main, another feature branch, or a branch whose former parent PR
	// has already closed; none of those shapes changes the trust of this PR's
	// same-repository author, ref, or immutable head SHA.
	await assertTrustedPullRequest(config, pullRequest, { actor, assertPrincipal });
	return { pullRequest, stack: { chain: [pullRequest], terminalBranch: pullRequest.base.ref } };
};

// Trust is not the same question as buildability. The build job checks the
// exact head out into the `product/` directory and then runs
// `pnpm --dir product/remix install`, so the head must carry `remix/` for the
// preview to build at all — no matter how trusted its author is. Control-plane
// PRs (base `github-actions`) carry only `.github` and the root docs, so every
// one of them was authorized, failed the build with
// `ENOENT ... /product/remix`, and published a "Develop S3 preview failed"
// comment telling the operator to correct the deployment, DNS, or CORS
// configuration. Probe the head instead and let the controller take its
// ordinary skip/reconcile path.
//
// The path is repository-relative: `product/` is the checkout directory, not
// part of the repository layout. This is also deliberately a head-content
// probe rather than a base-ref filter, because the caller workflow does not
// filter by base ref either — retarget and close events must still reach
// cleanup.
const PREVIEW_BUNDLE_PATH = 'remix/package.json';

const headHasPreviewBundle = async (repository, headSha, request = githubRequest) => {
	if (!/^[0-9a-f]{40}$/.test(headSha ?? '')) throw new EligibilityError('invalid-head-sha');
	try {
		const entry = await request(`/repos/${repository}/contents/${PREVIEW_BUNDLE_PATH}?ref=${headSha}`);
		return entry?.type === 'file';
	} catch (error) {
		if (error instanceof HttpError && error.status === 404) return false;
		throw error;
	}
};

const assertPreviewBundle = async (config, pullRequest, { hasPreviewBundle = headHasPreviewBundle } = {}) => {
	if (!(await hasPreviewBundle(config.repository, pullRequest.head?.sha))) {
		throw new EligibilityError('head-has-no-preview-bundle');
	}
};

const assertCurrentPullRequest = async (config, snapshot, actor) => {
	const current = await getPullRequest(config.repository, snapshot.number);
	await assertTrustedPullRequestStack(config, current, { actor });
	if (!pullRequestMatchesSnapshot(current, snapshot)) throw new EligibilityError('stale-head');
	return current;
};

const isManagedPreviewComment = (comment) => isManagedComment(comment, COMMENT_MARKER);

const upsertComment = (repository, number, body) => upsertPreviewComment({
	request: githubRequest, repository, number, marker: COMMENT_MARKER, body
});

const publishDevelopStatus = (config, pullRequest, fields, { bestEffort = false } = {}) =>
	publishPreviewNotifications([
		() => upsertComment(config.repository, pullRequest.number, deploymentComment({ pullRequest, ...fields })),
		() => syncPreviewLabels({ request: githubRequest, repository: config.repository, number: pullRequest.number,
			sha: pullRequest.head.sha, status: fields.state === 'deploying' ? 'building' : fields.state,
			...(fields.builtAt ? { builtAt: fields.builtAt } : {}) })
	], { bestEffort });

const findGithubDeployment = async (repository, pullRequest) => {
	const environment = `develop-pr-${pullRequest.number}`;
	const params = new URLSearchParams({ environment, ref: pullRequest.head.sha, per_page: '100' });
	const deployments = await githubRequest(`/repos/${repository}/deployments?${params}`);
	if (!Array.isArray(deployments)) throw new Error('GitHub deployments response was invalid');
	return (
		deployments.find(
			(deployment) =>
				deployment.ref === pullRequest.head.sha &&
				deployment.environment === environment &&
				deployment.payload?.kind === WORKFLOW_DEPLOYMENT_MARKER &&
				String(deployment.payload?.pullRequest ?? '') === String(pullRequest.number)
		) ?? null
	);
};

const createGithubDeployment = async (repository, pullRequest) => {
	const body = {
		ref: pullRequest.head.sha,
		environment: `develop-pr-${pullRequest.number}`,
		description: 'Thingtime develop Custom Environment PR preview',
		auto_merge: false,
		required_contexts: [],
		transient_environment: true,
		production_environment: false,
		payload: {
			kind: WORKFLOW_DEPLOYMENT_MARKER,
			pullRequest: pullRequest.number,
			sha: pullRequest.head.sha
		}
	};
	try {
		return await githubRequest(`/repos/${repository}/deployments`, {
			method: 'POST',
			accept: [201],
			retries: 0,
			body
		});
	} catch (error) {
		const reconciled = await findGithubDeployment(repository, pullRequest);
		if (reconciled) return reconciled;
		throw error;
	}
};

const setGithubDeploymentStatus = async (repository, deploymentId, state, { environmentUrl, logUrl, description } = {}) =>
	githubRequest(`/repos/${repository}/deployments/${deploymentId}/statuses`, {
		method: 'POST',
		accept: [201],
		retries: 0,
		body: {
			state,
			auto_inactive: false,
			...(environmentUrl ? { environment_url: environmentUrl } : {}),
			...(logUrl ? { log_url: logUrl } : {}),
			...(description ? { description: description.slice(0, 140) } : {})
		}
	});

const markGithubEnvironmentInactive = async (repository, prNumber, keepId = null) => {
	const environment = `develop-pr-${boundedInteger(prNumber, 'PR number')}`;
	for (let page = 1; page <= MAX_GITHUB_PAGES; page += 1) {
		const deployments = await githubRequest(
			`/repos/${repository}/deployments?environment=${encodeURIComponent(environment)}&per_page=100&page=${page}`
		);
		if (!Array.isArray(deployments)) throw new Error('GitHub deployments response was invalid');
		for (const deployment of deployments) {
			if (deployment.id === keepId || deployment.payload?.kind !== WORKFLOW_DEPLOYMENT_MARKER) continue;
			await setGithubDeploymentStatus(repository, deployment.id, 'inactive', {
				description: 'Develop PR preview superseded or removed'
			});
		}
		if (deployments.length < 100) return;
	}
	throw new Error('GitHub deployment scan exceeded its safety bound');
};

const dashboardUrl = (deploymentId, config) => `https://vercel.com/${config.teamSlug}/${config.projectName}/${deploymentId}`;

const deploymentComment = ({ state, pullRequest, alias, deploymentUrl, dashboard, note, expectedReady = null, builtAt = null }) => {
	const sha = pullRequest.head.sha.slice(0, 8);
	const title =
		state === 'ready' ? '✅ Develop S3 preview ready' : state === 'failed' ? '❌ Develop S3 preview failed' : '🧪 Develop S3 preview deploying';
	const previewLabel = state === 'ready' ? 'Preview' : 'Expected preview';
	const previewLine = `- ${previewLabel}: [https://${alias}](https://${alias})`;
	const expectedLine = state === 'deploying' && expectedReady ? `\n- Expected ready: ${expectedReady.replace('T', ' ').replace(':00.000Z', ' UTC')} (estimate)` : '';
	const builtLine = builtAt ? `\n- Last successfully built: ${previewBuildTime(builtAt)} (Australia/Melbourne)` : '';
	return `### ${title}\n\n- Commit: \`${sha}\`\n- Environment: Vercel Custom Environment \`develop\`\n${previewLine}${expectedLine}${builtLine}${
		deploymentUrl ? `\n- Immutable deployment: [${deploymentUrl}](${deploymentUrl})` : ''
	}${dashboard ? `\n- Vercel status: [open deployment](${dashboard})` : ''}${
		note ? `\n\n${note}` : ''
	}\n\nGeneric Vercel Preview deployments use the shared development runtime; this controller adds the stable exact-SHA alias and marker-scoped cleanup.`;
};

const verifyCors = async (origin, probeUrl) => {
	const response = await fetch(probeUrl, {
		method: 'OPTIONS',
		redirect: 'manual',
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		headers: {
			Origin: origin,
			'Access-Control-Request-Method': 'PUT',
			'Access-Control-Request-Headers': 'x-amz-checksum-sha256'
		}
	});
	const allowedOrigin = response.headers.get('access-control-allow-origin');
	const allowedMethods = (response.headers.get('access-control-allow-methods') ?? '').toUpperCase().split(/\s*,\s*/);
	const allowedHeaders = (response.headers.get('access-control-allow-headers') ?? '').toLowerCase().split(/\s*,\s*/);
	if (!response.ok || allowedOrigin !== origin || !allowedMethods.includes('PUT') || !allowedHeaders.includes('x-amz-checksum-sha256')) {
		throw new Error('Develop S3 CORS preflight did not authorize the PR origin');
	}
};

const assertVercelConfiguration = async (config) => {
	const project = await vercelRequest(`/v9/projects/${encodeURIComponent(config.projectId)}`);
	if (project?.id !== config.projectId || project?.name !== config.projectName) {
		throw new Error('Vercel project identity did not match the configured exact project');
	}
	if (String(project.link?.repoId ?? '') !== String(config.gitRepoId)) {
		throw new Error('Vercel project Git repository did not match the configured repository');
	}

	const customEnvironment = await vercelRequest(
		`/v9/projects/${encodeURIComponent(config.projectId)}/custom-environments/${encodeURIComponent(config.customEnvironmentId)}`
	);
	if (customEnvironment?.id !== config.customEnvironmentId || customEnvironment?.slug !== 'develop') {
		throw new Error('Vercel custom environment identity did not match develop');
	}
	const stableDomain = await vercelRequest(
		`/v9/projects/${encodeURIComponent(config.projectId)}/domains/${encodeURIComponent(config.stableDevelopDomain)}`
	);
	const stableDomainIssue = stableDevelopDomainBindingIssue(customEnvironment, stableDomain, config);
	if (stableDomainIssue) {
		throw new Error(`Stable develop domain must track only the develop Git branch (${stableDomainIssue})`);
	}

	const wildcardPolicies = [
		{ label: 'Development preview', suffix: config.previewAliasSuffix, expectedGitBranch: 'develop', expectedRuntimeBranch: 'develop' },
		// Vercel deliberately refuses to bind a project domain to the production
		// branch as a Preview domain. Detached is therefore the only valid
		// production binding; the live branch probe below makes that default
		// explicit and fails closed if Vercel ever routes it elsewhere.
		{ label: 'Production preview', suffix: config.productionPreviewAliasSuffix, expectedGitBranch: null, expectedRuntimeBranch: 'main' }
	];
	for (const policy of wildcardPolicies) {
		const wildcardDomainName = `*.${policy.suffix}`;
		const wildcardDomainPath = encodeURIComponent(wildcardDomainName).replaceAll('*', '%2A');
		const wildcardDomain = await vercelRequest(`/v9/projects/${encodeURIComponent(config.projectId)}/domains/${wildcardDomainPath}`);
		const wildcardBindingIssue = previewWildcardBindingIssue(wildcardDomain, {
			projectId: config.projectId,
			suffix: policy.suffix,
			expectedGitBranch: policy.expectedGitBranch
		});
		if (wildcardBindingIssue) {
			const expected = policy.expectedGitBranch ?? 'the Vercel production default';
			throw new Error(`${policy.label} wildcard must track only ${expected} (${wildcardBindingIssue})`);
		}

		const wildcardDomainConfig = await vercelRequest(`/v6/domains/${wildcardDomainPath}/config`);
		let resolvedCnames;
		try {
			resolvedCnames = await resolveCname(`controller-dns-probe.${policy.suffix}`);
		} catch {
			throw new Error(`${policy.label} wildcard CNAME did not resolve`);
		}
		const wildcardDnsIssue = wildcardDnsConfigurationIssue(wildcardDomainConfig, resolvedCnames);
		if (wildcardDnsIssue) {
			throw new Error(`${policy.label} wildcard DNS failed live CNAME verification (${wildcardDnsIssue})`);
		}
	}
	await assertWildcardFallbackRuntimes(config);
};

const verifyWildcardFallbackRuntime = async ({ suffix, expectedBranch }) => {
	const hostname = `controller-fallback-probe.${suffix}`;
	let lastError = null;
	for (let attempt = 0; attempt < 5; attempt += 1) {
		try {
			const response = await fetch(`https://${hostname}/api/root-data`, {
				headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
				redirect: 'manual',
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
			});
			if (!response.ok) {
				lastError = new Error(`HTTP ${response.status}`);
			} else {
				const payload = await response.json();
				const branch = payload?.envFromCookie?.THINGTIME_BRANCH_NAME;
				if (branch === expectedBranch) return;
				lastError = new Error(`runtime branch was ${typeof branch === 'string' ? branch : 'missing'}`);
			}
		} catch (error) {
			lastError = error;
		}
		if (attempt < 4) await delay(1_000 * (attempt + 1));
	}
	throw new Error(
		`Wildcard fallback runtime did not resolve to ${expectedBranch} (${lastError instanceof Error ? lastError.message : 'unknown'})`
	);
};

const assertWildcardFallbackRuntimes = async (config) => {
	await verifyWildcardFallbackRuntime({ suffix: config.previewAliasSuffix, expectedBranch: 'develop' });
	await verifyWildcardFallbackRuntime({ suffix: config.productionPreviewAliasSuffix, expectedBranch: 'main' });
};

const verifyPublishedAlias = async (aliasUrl) => {
	let lastError = null;
	for (let attempt = 0; attempt < 5; attempt += 1) {
		try {
			const response = await fetch(aliasUrl, {
				method: 'HEAD',
				redirect: 'manual',
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
			});
			if (response.status >= 200 && response.status < 500) return;
			lastError = new Error(`HTTP ${response.status}`);
		} catch (error) {
			lastError = error;
		}
		if (attempt < 4) await delay(1_000 * (attempt + 1));
	}
	throw new Error(`Published PR preview alias did not pass HTTPS verification (${lastError instanceof Error ? lastError.message : 'unknown'})`);
};

const deploymentDetail = async (deploymentId) => vercelRequest(`/v13/deployments/${encodeURIComponent(deploymentId)}?withGitRepoInfo=true`);

const listDeploymentSummaries = async (config, { prNumber = null, sha = null, workflowOwned = true } = {}) => {
	const results = [];
	const seenIds = new Set();
	const seenCursors = new Set();
	let until = null;
	for (let page = 0; page < MAX_DEPLOYMENT_PAGES; page += 1) {
		const params = deploymentListParams(config, { prNumber, sha, until, workflowOwned });
		const response = await vercelRequest(`/v7/deployments?${params}`);
		if (!Array.isArray(response?.deployments)) throw new Error('Vercel deployment list response was invalid');
		for (const deployment of response.deployments) {
			const id = deployment.uid ?? deployment.id;
			if (typeof id !== 'string' || seenIds.has(id)) continue;
			seenIds.add(id);
			results.push(deployment);
		}
		const next = Number(response.pagination?.next);
		if (!Number.isSafeInteger(next) || next < 1) return results;
		if (seenCursors.has(next)) throw new Error('Vercel deployment pagination repeated a cursor');
		seenCursors.add(next);
		until = next;
	}
	throw new Error('Vercel deployment scan exceeded its safety bound');
};

const listWorkflowDeployments = async (config, { prNumber = null, sha = null } = {}) => {
	const summaries = await listDeploymentSummaries(config, { prNumber, sha });
	const owned = summaries.filter(
		(candidate) =>
			candidate.meta?.[WORKFLOW_DEPLOYMENT_MARKER] === '1' && (prNumber === null || String(candidate.meta?.githubPrId ?? '') === String(prNumber))
	);
	if (owned.length > MAX_WORKFLOW_DEPLOYMENTS) {
		throw new Error('Workflow deployment detail scan exceeded its safety bound');
	}
	const details = [];
	for (const candidate of owned) {
		const id = candidate.uid ?? candidate.id;
		let detail;
		try {
			detail = await deploymentDetail(id);
		} catch (error) {
			if (error instanceof HttpError && error.status === 404) continue;
			throw error;
		}
		const issue = deploymentIdentityIssue(detail, config, { prNumber: prNumber ?? undefined });
		if (issue) throw new Error(`Workflow deployment ownership check failed (${issue})`);
		if (sha && workflowDeploymentCommitSha(detail) !== sha) throw new Error('Vercel SHA filter returned a mismatched deployment');
		details.push(detail);
	}
	return details;
};

const listStableDevelopDeployments = async (config, sha) => {
	const summaries = await listDeploymentSummaries(config, { sha, workflowOwned: false });
	if (summaries.length > MAX_STABLE_DEPLOYMENTS) {
		throw new Error('Stable develop deployment detail scan exceeded its safety bound');
	}
	const details = [];
	for (const candidate of summaries) {
		const id = candidate.uid ?? candidate.id;
		if (!/^dpl_[A-Za-z0-9]+$/.test(id ?? '')) continue;
		try {
			details.push(await deploymentDetail(id));
		} catch (error) {
			if (error instanceof HttpError && error.status === 404) continue;
			throw error;
		}
	}
	return details;
};

const deploymentUrl = (deployment) => {
	const hostname = safeHostname(deployment?.url, 'Vercel deployment URL');
	if (!hostname.endsWith('.vercel.app')) throw new Error('Vercel deployment URL was outside vercel.app');
	return `https://${hostname}`;
};

const refreshOwnedDeployment = async (deploymentId, config, prNumber) => {
	let detail;
	try {
		detail = await deploymentDetail(deploymentId);
	} catch (error) {
		if (error instanceof HttpError && error.status === 404) return null;
		throw error;
	}
	const issue = deploymentIdentityIssue(detail, config, { prNumber });
	if (issue) throw new Error(`Workflow deployment ownership check failed (${issue})`);
	return detail;
};

const cancelAndDeleteDeployment = async (deployment, config, prNumber) => {
	let current = await refreshOwnedDeployment(deployment.id, config, prNumber);
	if (!current) return false;
	if (ACTIVE_STATES.has(current.readyState)) {
		try {
			await vercelRequest(`/v12/deployments/${encodeURIComponent(current.id)}/cancel`, {
				method: 'PATCH',
				retries: 0,
				accept: [200]
			});
		} catch (error) {
			if (!(error instanceof HttpError && [400, 404, 409].includes(error.status))) throw error;
		}
		const timeoutAt = Date.now() + CANCEL_TIMEOUT_MS;
		do {
			await delay(5000);
			current = await refreshOwnedDeployment(deployment.id, config, prNumber);
			if (!current) return false;
		} while (ACTIVE_STATES.has(current.readyState) && Date.now() < timeoutAt);
		if (ACTIVE_STATES.has(current.readyState)) {
			throw new Error('Canceled Vercel deployment did not become terminal within two minutes');
		}
	}
	await vercelRequest(`/v13/deployments/${encodeURIComponent(current.id)}`, {
		method: 'DELETE',
		accept: [200, 204, 404]
	});
	return true;
};

const cleanupDeployments = async (deployments, config, prNumber, keepIds = new Set()) => {
	let deleted = 0;
	for (const deployment of deployments) {
		if (keepIds.has(deployment.id)) continue;
		if (await cancelAndDeleteDeployment(deployment, config, prNumber)) deleted += 1;
	}
	return deleted;
};

const getOwnedAlias = async (config, alias) => {
	const params = new URLSearchParams({ projectId: config.projectId });
	try {
		const found = await vercelRequest(`/v4/aliases/${encodeURIComponent(alias)}?${params}`);
		if (found?.projectId !== config.projectId || found?.alias !== alias) {
			throw new Error('Alias ownership did not match the configured project');
		}
		return found;
	} catch (error) {
		if (error instanceof HttpError && error.status === 404) return null;
		throw error;
	}
};

const getStableDevelopAliasBinding = async (config) => {
	const found = await getOwnedAlias(config, config.stableDevelopDomain);
	if (!found) return null;
	if (!/^dpl_[A-Za-z0-9]+$/.test(found.deploymentId ?? '')) {
		throw new Error('Stable develop alias did not point to a deployment');
	}
	let deployment;
	try {
		deployment = await deploymentDetail(found.deploymentId);
	} catch (error) {
		if (error instanceof HttpError && error.status === 404) {
			throw new Error('Stable develop alias pointed to a missing deployment');
		}
		throw error;
	}
	return { alias: config.stableDevelopDomain, record: found, deployment };
};

const getAliasBinding = async (config, prNumber) => {
	const alias = previewAlias(prNumber, config.previewAliasSuffix);
	const found = await getOwnedAlias(config, alias);
	if (!found) return null;
	if (!/^dpl_[A-Za-z0-9]+$/.test(found.deploymentId ?? '')) {
		throw new Error('Owned alias did not point to a deployment');
	}
	const deployment = await refreshOwnedDeployment(found.deploymentId, config, prNumber);
	if (!deployment) throw new Error('Owned alias pointed to a missing deployment');
	return { alias, record: found, deployment };
};

const removeAliasForPr = async (config, prNumber) => {
	const binding = await getAliasBinding(config, prNumber);
	if (!binding) return false;
	await vercelRequest(`/v2/aliases/${encodeURIComponent(binding.record.uid)}`, {
		method: 'DELETE',
		accept: [200, 204, 404]
	});
	return true;
};

const assignAliasVerified = async (config, deployment, prNumber) => {
	const alias = previewAlias(prNumber, config.previewAliasSuffix);
	const issue = deploymentIdentityIssue(deployment, config, { prNumber });
	if (issue || deployment.readyState !== 'READY') {
		throw new Error(`Refusing to alias an unverified deployment (${issue ?? deployment.readyState})`);
	}
	const existing = await getAliasBinding(config, prNumber);
	if (existing?.deployment.id === deployment.id) return { alias, oldDeploymentId: null };

	let assignment = null;
	try {
		assignment = await vercelRequest(`/v2/deployments/${encodeURIComponent(deployment.id)}/aliases`, {
			method: 'POST',
			accept: [200],
			retries: 0,
			body: { alias }
		});
	} catch (error) {
		const reconciled = await getAliasBinding(config, prNumber);
		if (reconciled?.deployment.id !== deployment.id) throw error;
		return { alias, oldDeploymentId: reconciled.record.deploymentId ?? null };
	}
	if (assignment?.alias !== alias) throw new Error('Vercel assigned an unexpected alias');
	const verified = await getAliasBinding(config, prNumber);
	if (verified?.deployment.id !== deployment.id) throw new Error('Alias did not resolve to the expected deployment');
	return { alias, oldDeploymentId: assignment.oldDeploymentId ?? null };
};

const assignStableDevelopAliasVerified = async (config, deployment, expectedSha) => {
	const issue = stableDevelopDeploymentIssue(deployment, config, expectedSha);
	if (issue || deployment.readyState !== 'READY') {
		throw new Error(`Refusing to publish an unverified stable develop deployment (${issue ?? deployment.readyState})`);
	}
	if ((await getDevelopHeadSha(config)) !== expectedSha) return { headChanged: true, oldDeploymentId: null };

	const existing = await getStableDevelopAliasBinding(config);
	if (existing?.deployment.id === deployment.id) {
		return { headChanged: false, oldDeploymentId: null };
	}

	let assignment = null;
	try {
		assignment = await vercelRequest(`/v2/deployments/${encodeURIComponent(deployment.id)}/aliases`, {
			method: 'POST',
			accept: [200],
			retries: 0,
			body: { alias: config.stableDevelopDomain }
		});
	} catch (error) {
		const reconciled = await getStableDevelopAliasBinding(config);
		if (reconciled?.deployment.id !== deployment.id) throw error;
		assignment = reconciled.record;
	}
	if (assignment?.alias !== config.stableDevelopDomain) {
		throw new Error('Vercel assigned an unexpected stable develop alias');
	}
	const verified = await getStableDevelopAliasBinding(config);
	if (verified?.deployment.id !== deployment.id) {
		throw new Error('Stable develop alias did not resolve to the expected deployment');
	}
	await assertVercelConfiguration(config);
	await verifyPublishedAlias(`https://${config.stableDevelopDomain}`);
	return {
		headChanged: (await getDevelopHeadSha(config)) !== expectedSha,
		oldDeploymentId: assignment.oldDeploymentId ?? null
	};
};

const reconcileStableDevelopAlias = async (config, { waitForReady = false } = {}) => {
	await assertVercelConfiguration(config);
	const timeoutAt = Date.now() + STABLE_DEVELOP_TIMEOUT_MS;
	for (;;) {
		const expectedSha = await getDevelopHeadSha(config);
		const binding = await getStableDevelopAliasBinding(config);
		const bindingIssue = binding ? stableDevelopDeploymentIssue(binding.deployment, config, expectedSha) : 'missing-alias';
		if (binding && bindingIssue === null && binding.deployment.readyState === 'READY') {
			console.log(`Stable develop alias already current: ${config.stableDevelopDomain} -> ${expectedSha}`);
			return { changed: false, deploymentId: binding.deployment.id, sha: expectedSha };
		}

		const deployments = await listStableDevelopDeployments(config, expectedSha);
		const preferred = chooseStableDevelopDeployment(deployments, config, expectedSha);
		if (preferred?.readyState === 'READY') {
			const assigned = await assignStableDevelopAliasVerified(config, preferred, expectedSha);
			if (assigned.headChanged) {
				if (!waitForReady && Date.now() >= timeoutAt) {
					console.log('Stable develop alias promotion deferred because develop advanced during assignment');
					return { changed: true, deferred: true, deploymentId: preferred.id, sha: expectedSha };
				}
				continue;
			}
			console.log(`Stable develop alias promoted: ${config.stableDevelopDomain} -> ${preferred.id} (${expectedSha})`);
			return { changed: true, deploymentId: preferred.id, sha: expectedSha };
		}

		if (!waitForReady) {
			console.log(`Stable develop alias promotion deferred: current=${expectedSha}; binding=${bindingIssue}; deployment=${preferred?.readyState ?? 'missing'}`);
			return { changed: false, deferred: true, deploymentId: binding?.deployment.id ?? null, sha: expectedSha };
		}
		if (Date.now() >= timeoutAt) {
			throw new Error(`Timed out waiting for the exact develop deployment (${expectedSha})`);
		}
		await delay(STABLE_DEVELOP_POLL_MS);
	}
};

const prepareDeployment = async (config, pullRequest) => {
	const deployments = await listWorkflowDeployments(config, { prNumber: pullRequest.number });
	let aliasFailure = null;
	try {
		await removeAliasForPr(config, pullRequest.number);
	} catch (error) {
		aliasFailure = error;
	}
	const reusable = choosePreferredDeployment(deployments, pullRequest.head.sha);
	const keepIds = reusable ? new Set([reusable.id]) : new Set();
	await cleanupDeployments(deployments, config, pullRequest.number, keepIds);
	if (aliasFailure) throw aliasFailure;
	return reusable;
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

const prebuiltDeploymentArgs = ({ config, prebuiltDirectory, metadata, runtimeEnvironment }) => {
	const args = [
		'deploy',
		'--prebuilt',
		'--archive=tgz',
		'--target=develop',
		'--yes',
		'--scope',
		config.teamSlug,
		'--cwd',
		prebuiltDirectory
	];
	for (const [key, value] of Object.entries(runtimeEnvironment).sort(([left], [right]) => left.localeCompare(right))) {
		args.push('--env', `${key}=${value}`);
	}
	for (const [key, value] of Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right))) {
		args.push('--meta', `${key}=${value}`);
	}
	return args;
};

const deployPrebuiltOutput = async (config, pullRequest) => {
	const prebuiltDirectory = resolve(requiredEnv('VERCEL_PREBUILT_DIR'));
	await assertPrebuiltOutput(prebuiltDirectory);
	await mkdir(resolve(prebuiltDirectory, '.vercel'), { recursive: true });
	await writeFile(
		resolve(prebuiltDirectory, '.vercel/project.json'),
		`${JSON.stringify({ orgId: config.teamId, projectId: config.projectId })}\n`,
		{ mode: 0o600 }
	);

	const metadata = deploymentMetadata({ pullRequest, config });
	const runtimeEnvironment = {
		THINGTIME_BRANCH_NAME: pullRequest.head.ref,
		THINGTIME_GIT_COMMIT_SHA: pullRequest.head.sha
	};
	const args = prebuiltDeploymentArgs({ config, prebuiltDirectory, metadata, runtimeEnvironment });

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
	const candidateUrl = stdout
		.trim()
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.at(-1);
	let deploymentHostname;
	try {
		const parsed = new URL(candidateUrl);
		if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('invalid URL');
		deploymentHostname = safeHostname(parsed.hostname, 'Prebuilt Vercel deployment URL');
	} catch {
		throw new Error('Vercel CLI did not return an exact deployment URL');
	}
	if (!deploymentHostname.endsWith('.vercel.app')) throw new Error('Prebuilt deployment URL was outside vercel.app');
	return deploymentDetail(deploymentHostname);
};

const createVercelDeployment = async (config, pullRequest, reusable = null) => {
	if (reusable) return reusable;
	let created;
	try {
		created = await deployPrebuiltOutput(config, pullRequest);
	} catch (error) {
		await delay(1500);
		const reconciled = choosePreferredDeployment(
			await listWorkflowDeployments(config, { prNumber: pullRequest.number, sha: pullRequest.head.sha }),
			pullRequest.head.sha
		);
		if (reconciled) return reconciled;
		throw error;
	}
	if (!/^dpl_[A-Za-z0-9]+$/.test(created?.id ?? '')) {
		const reconciled = choosePreferredDeployment(
			await listWorkflowDeployments(config, { prNumber: pullRequest.number, sha: pullRequest.head.sha }),
			pullRequest.head.sha
		);
		if (reconciled) return reconciled;
		throw new Error('Vercel create response did not identify a deployment');
	}
	const issue = deploymentIdentityIssue(created, config, {
		prNumber: pullRequest.number,
		expectedSha: pullRequest.head.sha,
		expectedRef: pullRequest.head.ref
	});
	if (issue) throw new Error(`Created Vercel deployment failed identity validation (${issue})`);
	return created;
};

const waitForDeployment = async (config, pullRequest, deployment) => {
	const timeoutAt = Date.now() + 30 * 60 * 1000;
	let current = deployment;
	while (ACTIVE_STATES.has(current.readyState) && Date.now() < timeoutAt) {
		await delay(15_000);
		current = await deploymentDetail(current.id);
		const issue = deploymentIdentityIssue(current, config, {
			prNumber: pullRequest.number,
			expectedSha: pullRequest.head.sha,
			expectedRef: pullRequest.head.ref
		});
		if (issue) throw new Error(`Vercel deployment identity changed while building (${issue})`);
	}
	if (current.readyState === 'READY') return current;
	if (TERMINAL_FAILURE_STATES.has(current.readyState)) {
		throw new Error(`Vercel deployment ended in ${current.readyState}`);
	}
	throw new Error('Vercel deployment did not become ready within 30 minutes');
};

const cleanupPrResources = async (config, prNumber, deployments = null) => {
	let aliasRemoved = false;
	let deleted = 0;
	const failures = [];
	try {
		aliasRemoved = await removeAliasForPr(config, prNumber);
	} catch (error) {
		failures.push(error);
	}
	try {
		const owned = deployments ?? (await listWorkflowDeployments(config, { prNumber }));
		deleted = await cleanupDeployments(owned, config, prNumber);
	} catch (error) {
		failures.push(error);
	}
	try {
		await markGithubEnvironmentInactive(config.repository, prNumber);
	} catch (error) {
		failures.push(error);
	}
	if (failures.length > 0) {
		throw new AggregateError(failures, 'Develop PR preview cleanup was incomplete');
	}
	return { aliasRemoved, deleted };
};

const cleanupComment = (reason) => {
	if (reason === 'closed') {
		return '### 🧹 Develop S3 preview removed\n\nThe PR-specific alias and every workflow-created develop deployment were removed when this PR closed.';
	}
	if (reason === 'draft') {
		return '### ⏭️ Develop S3 preview paused\n\nDraft PRs do not keep develop credentials. The preview will be rebuilt after an allowlisted maintainer marks the PR ready.';
	}
	if (reason === 'wrong-base') {
		return '### 🧹 Develop S3 preview removed\n\nThis PR no longer targets `develop`, so its credentialed preview resources were removed.';
	}
	return '### ⏭️ Develop S3 preview skipped\n\nThis PR or triggering actor is not currently eligible for the credentialed develop preview.';
};

const handleIneligible = async (config, pullRequest, reason, { comment = true } = {}) => {
	const prNumber = boundedInteger(pullRequest.number, 'PR number');
	const cleaned = await cleanupPrResources(config, prNumber);
	await syncPreviewLabels({ request: githubRequest, repository: config.repository,
		number: prNumber, sha: pullRequest.head.sha, status: 'removed' });
	if (comment && (cleaned.aliasRemoved || cleaned.deleted > 0)) {
		await upsertComment(
			config.repository,
			prNumber,
			`${cleanupComment(reason)}\n\nThe ordinary generated Vercel Preview remains available on the shared development runtime.`
		);
	}
	console.log(`Develop preview ineligible for PR #${prNumber}: ${reason}; alias=${cleaned.aliasRemoved}; deployments=${cleaned.deleted}`);
};

const reconcile = async (config) => {
	const deployments = await listWorkflowDeployments(config);
	const byPullRequest = new Map();
	for (const deployment of deployments) {
		const prNumber = boundedInteger(deployment.meta.githubPrId, 'Deployment PR number');
		const group = byPullRequest.get(prNumber) ?? [];
		group.push(deployment);
		byPullRequest.set(prNumber, group);
	}
	// The old sweep only visited PRs with Vercel objects. A failed authorization
	// or missed event creates no such object, so those PRs were never repaired.
	const open = await githubRequest(`/repos/${config.repository}/pulls?state=open&per_page=100`);
	if (!Array.isArray(open) || open.length >= 100) throw new Error('Open preview PR inventory exceeds its safety bound');
	for (const pr of open) if (!byPullRequest.has(pr.number)) byPullRequest.set(pr.number, []);
	if (byPullRequest.size > MAX_RECONCILE_PULL_REQUESTS) {
		throw new Error('Scheduled reconciliation exceeded its pull-request safety bound');
	}

	let removedAliases = 0;
	let removedDeployments = 0;
	await reconcilePreviewInventory({ numbers: [...byPullRequest.keys()], inspect: async (prNumber) => {
		const owned = byPullRequest.get(prNumber);
		if (await previewWorkActive(githubRequest, config.repository, prNumber)) return;
		let pullRequest = null;
		let candidate = null;
		try {
			candidate = await getPullRequest(config.repository, prNumber);
			await assertTrustedPullRequestStack(config, candidate);
			await assertPreviewBundle(config, candidate);
			pullRequest = candidate;
		} catch (error) {
			if (!(error instanceof EligibilityError) && !(error instanceof HttpError && error.status === 404)) throw error;
		}

		if (!pullRequest) {
			const cleaned = await cleanupPrResources(config, prNumber, owned);
			if (cleaned.aliasRemoved) removedAliases += 1;
			removedDeployments += cleaned.deleted;
			if (candidate) await syncPreviewLabels({ request: githubRequest, repository: config.repository,
				number: prNumber, sha: candidate.head.sha, status: 'removed' });
			return;
		}

		// Do not race a Vercel build that outlived its GitHub job either.
		if (owned.some((deployment) => ACTIVE_STATES.has(deployment.readyState))) return;
		const binding = await getAliasBinding(config, prNumber);
		let keeper = null;
		if (
			binding &&
			binding.deployment.readyState === 'READY' &&
			workflowDeploymentCommitSha(binding.deployment) === pullRequest.head.sha &&
			workflowDeploymentCommitRef(binding.deployment) === pullRequest.head.ref
		) {
			keeper = binding.deployment;
		} else if (binding) {
			await vercelRequest(`/v2/aliases/${encodeURIComponent(binding.record.uid)}`, {
				method: 'DELETE',
				accept: [200, 204, 404]
			});
			removedAliases += 1;
		}
		keeper ??= choosePreferredDeployment(owned.filter((deployment) => workflowDeploymentCommitRef(deployment) === pullRequest.head.ref), pullRequest.head.sha);
		if (keeper) {
			const snapshot = pullRequestSnapshot(pullRequest);
			await assertCurrentPullRequest(config, snapshot, null);
			await assertVercelConfiguration(config);
			const alias = previewAlias(prNumber, config.previewAliasSuffix);
			await verifyCors(`https://${alias}`, safeCorsProbeUrl(requiredEnv('DEVELOP_S3_CORS_PROBE_URL')));
			await assertCurrentPullRequest(config, snapshot, null);
			if (binding?.deployment.id !== keeper.id) await assignAliasVerified(config, keeper, prNumber);
			await verifyPublishedAlias(`https://${alias}`);
			await assertCurrentPullRequest(config, snapshot, null);
			const githubDeployment = await createGithubDeployment(config.repository, pullRequest);
			const statuses = await githubRequest(`/repos/${config.repository}/deployments/${githubDeployment.id}/statuses?per_page=100`);
			if (!Array.isArray(statuses)) throw new Error('Invalid deployment status inventory');
			if (statuses[0]?.state !== 'success' || statuses[0]?.environment_url !== `https://${alias}`) {
				await setGithubDeploymentStatus(config.repository, githubDeployment.id, 'success', {
					environmentUrl: `https://${alias}`, logUrl: dashboardUrl(keeper.id, config),
					description: 'Develop S3 preview is ready at the exact current SHA'
				});
			}
			await publishDevelopStatus(config, pullRequest, { state: 'ready', alias, builtAt: deploymentBuiltAt(keeper),
				deploymentUrl: deploymentUrl(keeper), dashboard: dashboardUrl(keeper.id, config),
				note: 'The alias passed the develop bucket CORS preflight and a final live PR/SHA fence.' });
		} else {
			await requestRecoveryBuild(config, pullRequest);
		}
		removedDeployments += await cleanupDeployments(owned, config, prNumber, keeper ? new Set([keeper.id]) : new Set());
	} });
	console.log(`Develop preview reconciliation complete: prs=${byPullRequest.size}; aliases=${removedAliases}; deployments=${removedDeployments}`);
};

const requestRecoveryBuild = async (config, pullRequest) => {
	const recoveryToken = requiredEnv('RECOVERY_GH_TOKEN');
	const snapshot = pullRequestSnapshot(pullRequest);
	await assertCurrentPullRequest(config, snapshot, null);
	if (await previewWorkActive(githubRequest, config.repository, pullRequest.number)) return;
	const deployment = await createGithubDeployment(config.repository, pullRequest);
	const statuses = await githubRequest(`/repos/${config.repository}/deployments/${deployment.id}/statuses?per_page=100`);
	const decision = recoveryAttempt(statuses);
	if (!decision.allowed) {
		if (decision.reason === 'retry-limit') {
			await publishDevelopStatus(config, pullRequest, { state: 'failed',
				alias: previewAlias(pullRequest.number, config.previewAliasSuffix),
				note: 'Automatic recovery reached its three-attempt limit for this commit. Inspect the workflow failure and manually re-run the preview after fixing it.' });
		}
		console.log(`Preview recovery deferred for PR #${pullRequest.number}: ${decision.reason}`);
		return;
	}
	// Record before dispatch. An uncertain API response cannot cause an
	// immediate duplicate; the bounded receipt survives runner replacement.
	await setGithubDeploymentStatus(config.repository, deployment.id, 'queued', {
		description: `Preview recovery requested (attempt ${decision.attempt})`,
		logUrl: `https://github.com/${config.repository}/actions/runs/${requiredEnv('GITHUB_RUN_ID')}`
	});
	await publishDevelopStatus(config, pullRequest, { state: 'deploying',
		alias: previewAlias(pullRequest.number, config.previewAliasSuffix), expectedReady: expectedReadyAt(),
		note: 'The scheduled controller found no ready preview for this commit and requested a fresh secretless build.' }, { bestEffort: true });
	await requestJson(githubUrl(`/repos/${config.repository}/dispatches`), {
		method: 'POST', accept: [204], retries: 0, token: recoveryToken,
		body: { event_type: CONTROLLER_DISPATCH_TYPE, client_payload: {
			pr_number: String(pullRequest.number), head_sha: pullRequest.head.sha, head_ref: pullRequest.head.ref,
			action: 'synchronize', actor: pullRequest.user.login, source_run_id: requiredEnv('GITHUB_RUN_ID'), recovery: '1'
		} }
	});
	console.log(`Requested bounded preview recovery for PR #${pullRequest.number}, attempt ${decision.attempt}`);
};

const reportFailure = async (config, pullRequest, githubDeployment, vercelDeployment) => {
	const dashboard = vercelDeployment?.id ? dashboardUrl(vercelDeployment.id, config) : null;
	let immutableUrl = null;
	try {
		if (vercelDeployment?.url) immutableUrl = deploymentUrl(vercelDeployment);
	} catch {
		immutableUrl = null;
	}
	const reporting = [];
	reporting.push(syncPreviewLabels({ request: githubRequest, repository: config.repository,
		number: pullRequest.number, sha: pullRequest.head.sha, status: 'failed' }));
	if (githubDeployment?.id) {
		reporting.push(
			setGithubDeploymentStatus(config.repository, githubDeployment.id, 'failure', {
				...(immutableUrl ? { environmentUrl: immutableUrl } : {}),
				...(dashboard ? { logUrl: dashboard } : {}),
				description: 'Develop S3 preview deployment failed'
			})
		);
	}
	reporting.push(
		upsertComment(
			config.repository,
			pullRequest.number,
			deploymentComment({
				state: 'failed',
				pullRequest,
				alias: previewAlias(pullRequest.number, config.previewAliasSuffix),
				deploymentUrl: immutableUrl,
				dashboard,
				note: 'The ordinary generated Vercel Preview remains available on the shared development runtime. Re-run this workflow after correcting the deployment, DNS, or CORS configuration.'
			})
		)
	);
	await Promise.allSettled(reporting);
};

const deploy = async (config, pullRequest) => {
	await assertTrustedPullRequestStack(config, pullRequest, { actor: config.actor });
	const corsProbeUrl = safeCorsProbeUrl(requiredEnv('DEVELOP_S3_CORS_PROBE_URL'));
	const snapshot = pullRequestSnapshot(pullRequest);
	await assertVercelConfiguration(config);
	const reusable = await prepareDeployment(config, pullRequest);
	pullRequest = await assertCurrentPullRequest(config, snapshot, config.actor);

	let githubDeployment = null;
	let vercelDeployment = null;
	let published = false;
	const estimatedReady = expectedReadyForRun();
	try {
		githubDeployment = await createGithubDeployment(config.repository, pullRequest);
		await publishDevelopStatus(config, pullRequest, {
				state: 'deploying',
				alias: previewAlias(pullRequest.number, config.previewAliasSuffix),
				expectedReady: estimatedReady
			}, { bestEffort: true });
		vercelDeployment = await createVercelDeployment(config, pullRequest, reusable);
		const immutableUrl = deploymentUrl(vercelDeployment);
		const dashboard = dashboardUrl(vercelDeployment.id, config);
		await setGithubDeploymentStatus(config.repository, githubDeployment.id, 'in_progress', {
			environmentUrl: immutableUrl,
			logUrl: dashboard,
			description: 'Deploying exact SHA to Vercel Custom Environment develop'
		});
		await publishDevelopStatus(config, pullRequest, {
				state: 'deploying',
				alias: previewAlias(pullRequest.number, config.previewAliasSuffix),
				deploymentUrl: immutableUrl,
				dashboard,
				expectedReady: estimatedReady
			}, { bestEffort: true });

		const ready = await waitForDeployment(config, pullRequest, vercelDeployment);
		await assertCurrentPullRequest(config, snapshot, config.actor);
		await assertVercelConfiguration(config);
		const alias = previewAlias(pullRequest.number, config.previewAliasSuffix);
		const aliasUrl = `https://${alias}`;
		await verifyCors(aliasUrl, corsProbeUrl);
		await assertCurrentPullRequest(config, snapshot, config.actor);
		await assignAliasVerified(config, ready, pullRequest.number);
		await verifyPublishedAlias(aliasUrl);
		await assertCurrentPullRequest(config, snapshot, config.actor);
		published = true;

		await setGithubDeploymentStatus(config.repository, githubDeployment.id, 'success', {
			environmentUrl: aliasUrl,
			logUrl: dashboard,
			description: 'Develop S3 preview is ready at the exact current SHA'
		});
		await publishDevelopStatus(config, pullRequest, {
				state: 'ready',
				builtAt: deploymentBuiltAt(ready),
				alias,
				deploymentUrl: deploymentUrl(ready),
				dashboard,
				note: 'The alias passed the develop bucket CORS preflight and a final live PR/SHA fence.'
			});
		const owned = await listWorkflowDeployments(config, { prNumber: pullRequest.number });
		await cleanupDeployments(owned, config, pullRequest.number, new Set([ready.id]));
		await markGithubEnvironmentInactive(config.repository, pullRequest.number, githubDeployment.id);
		console.log(`Develop preview ready for PR #${pullRequest.number}: ${aliasUrl}`);
	} catch (error) {
		if (!published) {
			await Promise.allSettled([cleanupPrResources(config, pullRequest.number)]);
			await reportFailure(config, pullRequest, githubDeployment, vercelDeployment);
		}
		throw error;
	}
};

const writePrepareOutputs = async ({ shouldBuild, pullRequest = null, expectedReady = null }) => {
	const outputPath = requiredEnv('GITHUB_OUTPUT');
	const lines = [`should_build=${shouldBuild ? 'true' : 'false'}`];
	if (pullRequest) {
		lines.push(`pr_number=${boundedInteger(pullRequest.number, 'PR number')}`);
		lines.push(`head_sha=${pullRequest.head.sha}`);
		lines.push(`head_ref=${pullRequest.head.ref}`);
		if (expectedReady) lines.push(`expected_ready_at=${expectedReady}`);
	}
	await appendFile(outputPath, `${lines.join('\n')}\n`, { mode: 0o600 });
};

const prepareBuildPlan = async () => {
	let config = runtimeConfig();
	const eventName = requiredEnv('GITHUB_EVENT_NAME');
	if (eventName === 'schedule' || eventName === 'pull_request_target') {
		await writePrepareOutputs({ shouldBuild: false });
		console.log(`GitHub prebuild not required for ${eventName}`);
		return;
	}

	const event = JSON.parse(await readFile(requiredEnv('GITHUB_EVENT_PATH'), 'utf8'));
	let dispatch = null;
	try {
		dispatch = eventName === 'repository_dispatch' ? await assertRepositoryDispatchSource(config, event) : null;
	} catch (error) {
		if (!(error instanceof EligibilityError)) throw error;
		await writePrepareOutputs({ shouldBuild: false });
		console.log(`GitHub prebuild skipped: ${error.reason}`);
		return;
	}
	config = {
		...config,
		actor: dispatch?.actor ?? normalizeLogin(process.env.GITHUB_TRIGGERING_ACTOR || requiredEnv('GITHUB_ACTOR'))
	};
	const prNumber =
		eventName === 'workflow_dispatch'
			? boundedInteger(event.inputs?.pr_number, 'PR number')
			: dispatch?.prNumber ?? boundedInteger(event.pull_request?.number, 'PR number');
	const pullRequest = await getPullRequest(config.repository, prNumber);
	const dispatchIssue = dispatchPullRequestIssue(pullRequest, dispatch);
	if (dispatchIssue) {
		await writePrepareOutputs({ shouldBuild: false });
		console.log(`GitHub prebuild skipped for stale PR #${prNumber}: ${dispatchIssue}`);
		return;
	}
	try {
		await assertTrustedPullRequestStack(config, pullRequest, { actor: config.actor });
		await assertPreviewBundle(config, pullRequest);
	} catch (error) {
		if (!(error instanceof EligibilityError)) throw error;
		await writePrepareOutputs({ shouldBuild: false });
		console.log(`GitHub prebuild not required for PR #${prNumber}: ${error.reason}`);
		return;
	}
	const expectedReady = expectedReadyAt();
	await publishDevelopStatus(config, pullRequest, {
			state: 'deploying',
			alias: previewAlias(pullRequest.number, config.previewAliasSuffix),
			expectedReady
		}, { bestEffort: true });
	await writePrepareOutputs({ shouldBuild: true, pullRequest, expectedReady });
	console.log(`GitHub prebuild authorized for PR #${prNumber} at ${pullRequest.head.sha}`);
};

const main = async () => {
	if (process.argv.includes('--self-test')) {
		await runSelfTest();
		return;
	}
	if (process.argv.includes('--prepare')) {
		await prepareBuildPlan();
		return;
	}

	let config = runtimeConfig();
	const eventName = requiredEnv('GITHUB_EVENT_NAME');
	if (eventName === 'schedule') {
		const results = await Promise.allSettled([reconcileStableDevelopAlias(config), reconcile(config)]);
		const failures = results.filter((result) => result.status === 'rejected');
		if (failures.length) throw new AggregateError(failures.map((result) => result.reason),
			`Scheduled preview reconciliation failed: ${failures.map((result) => result.reason.message).join('; ')}`);
		return;
	}

	const event = JSON.parse(await readFile(requiredEnv('GITHUB_EVENT_PATH'), 'utf8'));
	const dispatch = eventName === 'repository_dispatch' ? await assertRepositoryDispatchSource(config, event) : null;
	config = {
		...config,
		actor: dispatch?.actor ?? normalizeLogin(process.env.GITHUB_TRIGGERING_ACTOR || requiredEnv('GITHUB_ACTOR'))
	};
	const prNumber =
		eventName === 'workflow_dispatch'
			? boundedInteger(event.inputs?.pr_number, 'PR number')
			: dispatch?.prNumber ?? boundedInteger(event.pull_request?.number, 'PR number');
	const pullRequest = await getPullRequest(config.repository, prNumber);
	const dispatchIssue = dispatchPullRequestIssue(pullRequest, dispatch);
	if (dispatchIssue) {
		console.log(`Skipped stale controller dispatch for PR #${prNumber}: ${dispatchIssue}`);
		return;
	}
	const action = dispatch?.action ?? String(event.action ?? 'workflow_dispatch');
	const mergedIntoDevelop =
		action === 'closed' &&
		pullRequest.state === 'closed' &&
		pullRequest.merged === true &&
		pullRequest.base?.ref === 'develop' &&
		Number(pullRequest.base?.repo?.id) === config.repositoryId &&
		pullRequest.base?.repo?.full_name === config.repository;

	let stackEligibilityError = null;
	try {
		await assertTrustedPullRequestStack(config, pullRequest, { actor: config.actor });
		// The reconcile/report step re-enters here with no prebuilt bundle, so a
		// head that cannot build must be classified before deploy() is reached.
		await assertPreviewBundle(config, pullRequest);
	} catch (error) {
		if (!(error instanceof EligibilityError)) throw error;
		stackEligibilityError = error;
	}
	if (stackEligibilityError) {
		const cleanupRelevant =
			CLEANUP_ACTIONS.has(action) ||
			pullRequest.base?.ref === 'develop' ||
			event.changes?.base?.ref?.from === 'develop';
		if (cleanupRelevant) {
			const reason = action === 'closed' ? 'closed' : stackEligibilityError.reason;
			await handleIneligible(config, pullRequest, reason);
		} else {
			console.log(`Skipped unrelated PR #${prNumber}: ${stackEligibilityError.reason}`);
		}
		if (mergedIntoDevelop) {
			await assertTrustedPrincipal(config, config.actor, 'actor');
			await assertTrustedPrincipal(config, pullRequest.merged_by?.login, 'merger');
			await reconcileStableDevelopAlias(config, { waitForReady: true });
		}
		return;
	}
	await reconcileStableDevelopAlias(config);
	await deploy(config, pullRequest);
};

main().catch((error) => {
	console.error(error instanceof Error ? error.message : 'Develop PR preview failed');
	process.exitCode = 1;
});
