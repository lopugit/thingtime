#!/usr/bin/env node

import assert from 'node:assert/strict';
import { deploymentIssue as stablePublisherDeploymentIssue, marker as stablePublisherMarker, policyVersion as stablePublisherPolicyVersion, verifyAlias, verifyCanonicalGateway, compatibilityAliasCandidates } from './deploy-vercel-prebuilt.mjs';
import { gatewayPolicy, gatewayMetadata, gatewayDeploymentIssue, gatewayRuntimeArgs, gatewayPublisherEnvironment, restoreGatewayAliases } from './environment-gateway-policy.mjs';
import { isManagedPreviewComment as isManagedComment, upsertPreviewComment, publishPreviewNotifications } from './preview-comments.mjs';
import { syncPreviewLabels, deploymentBuiltAt, previewBuildTime } from './preview-labels.mjs';
import { recoverySourceIssue, previewWorkActive, recoveryAttempt, reconcilePreviewInventory } from './preview-recovery.mjs';
import { publishPreviewSummary } from './preview-pr-summary.mjs';
import { FALLBACK_BRANCH, fallbackResponseIssue, verifyPublishedPreview } from './preview-fallback.mjs';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolveCname } from 'node:dns/promises';
import { appendFile, mkdir, mkdtemp, open, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const COMMENT_MARKER = '<!-- thingtime-develop-pr-preview -->';
const WORKFLOW_DEPLOYMENT_MARKER = 'thingtimeDevelopPrPreview';
const PREBUILT_DEPLOYMENT_MARKER = 'thingtimeGithubPrebuiltPreview';
// v2 keeps the custom develop credential scope while routing gateway reads to
// the controlled preview master. The two scopes must remain independent.
const PR_PREVIEW_POLICY_VERSION = '3';
const PREVIOUS_PR_PREVIEW_POLICY_VERSION = '2';
const PR_PREVIEW_TARGET = Object.freeze({ slug: 'preview', kind: 'preview', id: '' });
const PR_VERCEL_TARGET = 'develop';
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
	deploymentAttempt: `${boundedInteger(requiredEnv('GITHUB_RUN_ID'), 'GitHub run id')}-${boundedInteger(optionalEnv('GITHUB_RUN_ATTEMPT', '1'), 'GitHub run attempt')}`,
	missingBuildPage: optionalEnv('PREVIEW_MISSING_BUILD_PAGE', 'false') === 'true',
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

const prGatewayPolicy = (branch) => gatewayPolicy({ branch, target: PR_PREVIEW_TARGET, follower: true });
const deploymentMetadata = ({ pullRequest, config }) => {
	const [githubCommitOrg, githubCommitRepo] = config.repository.split('/');
	return {
		...gatewayMetadata(prGatewayPolicy(pullRequest.head.ref)),
		githubCommitOrg,
		githubCommitRepo,
		githubCommitRef: pullRequest.head.ref,
		githubCommitSha: pullRequest.head.sha,
		githubPrId: String(pullRequest.number),
		githubRepoId: String(config.gitRepoId),
		githubRepositoryId: String(config.repositoryId),
		thingtimePrPreviewPolicy: PR_PREVIEW_POLICY_VERSION,
		thingtimePrPreviewAttempt: config.deploymentAttempt,
		thingtimeBuildTarget: PR_VERCEL_TARGET,
		thingtimeCustomEnvironmentId: config.customEnvironmentId,
		[WORKFLOW_DEPLOYMENT_MARKER]: '1',
		[PREBUILT_DEPLOYMENT_MARKER]: '1'
	};
};

const deploymentIdentityIssue = (deployment, config, { prNumber, expectedSha, expectedRef, expectedAttempt, legacyAlias = false, allowPreviousPolicy = false } = {}) => {
	if (!deployment || typeof deployment !== 'object') return 'missing-deployment';
	if (!/^dpl_[A-Za-z0-9]+$/.test(deployment.id ?? '')) return 'invalid-deployment-id';
	if (deployment.projectId !== config.projectId) return 'wrong-project';
	if (legacyAlias) {
		if (deployment.target === 'production') return 'wrong-target';
		if (deployment.customEnvironment?.id !== config.customEnvironmentId || deployment.customEnvironment?.slug !== 'develop') return 'wrong-environment';
		if (deployment.meta?.thingtimePrPreviewPolicy != null || deployment.meta?.thingtimeBuildTarget != null) return 'legacy-policy-mismatch';
		if (deployment.meta?.thingtimeCustomEnvironmentId !== config.customEnvironmentId) return 'metadata-environment-mismatch';
		if (deployment.meta?.thingtimeGatewayPolicy != null && gatewayDeploymentIssue(deployment, gatewayPolicy({ branch: deployment.meta.githubCommitRef, target: { slug: 'develop' }, follower: true }))) return 'gateway-policy';
	} else {
		if (deployment.target === 'production') return 'wrong-target';
		if (deployment.customEnvironment?.id !== config.customEnvironmentId || deployment.customEnvironment?.slug !== PR_VERCEL_TARGET ||
			(deployment.customEnvironmentId && deployment.customEnvironmentId !== config.customEnvironmentId)) return 'wrong-environment';
		if (deployment.meta?.thingtimePrPreviewPolicy !== PR_PREVIEW_POLICY_VERSION &&
			!(allowPreviousPolicy && deployment.meta?.thingtimePrPreviewPolicy === PREVIOUS_PR_PREVIEW_POLICY_VERSION)) return 'output-policy';
		if (!/^[1-9][0-9]*-[1-9][0-9]*$/.test(deployment.meta?.thingtimePrPreviewAttempt || '') || (expectedAttempt && deployment.meta.thingtimePrPreviewAttempt !== expectedAttempt)) return 'upload-attempt';
		if (deployment.meta?.thingtimeBuildTarget !== PR_VERCEL_TARGET || deployment.meta?.thingtimeCustomEnvironmentId !== config.customEnvironmentId) return 'metadata-environment-mismatch';
	}
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
	if (!legacyAlias && gatewayDeploymentIssue(deployment, prGatewayPolicy(deployment.meta.githubCommitRef))) return 'gateway-policy';
	if (expectedSha && workflowDeploymentCommitSha(deployment) !== expectedSha) return 'wrong-git-sha';
	if (expectedRef && workflowDeploymentCommitRef(deployment) !== expectedRef) return 'wrong-git-ref';
	return null;
};

const choosePreferredDeployment = (deployments, config, expectedSha) =>
	deployments
		.filter(
			(deployment) =>
				workflowDeploymentCommitSha(deployment) === expectedSha &&
				deployment.meta?.thingtimePrPreviewPolicy === PR_PREVIEW_POLICY_VERSION &&
				deployment.meta?.thingtimeBuildTarget === PR_VERCEL_TARGET &&
				deployment.meta?.thingtimeCustomEnvironmentId === config.customEnvironmentId &&
				deployment.target !== 'production' && deployment.customEnvironment?.id === config.customEnvironmentId && deployment.customEnvironment?.slug === PR_VERCEL_TARGET &&
				!gatewayDeploymentIssue(deployment, prGatewayPolicy(workflowDeploymentCommitRef(deployment))) &&
				(deployment.readyState === 'READY' || ACTIVE_STATES.has(deployment.readyState))
		)
		.sort((left, right) => {
			const readiness = Number(right.readyState === 'READY') - Number(left.readyState === 'READY');
			return readiness || Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0);
		})[0] ?? null;

const retainPreviousPolicyAliasDuringRecovery = (binding, pullRequest) =>
	binding && !binding.legacy && binding.deployment.readyState === 'READY' &&
	binding.deployment.meta?.thingtimePrPreviewPolicy === PREVIOUS_PR_PREVIEW_POLICY_VERSION &&
	workflowDeploymentCommitSha(binding.deployment) === pullRequest.head.sha &&
	workflowDeploymentCommitRef(binding.deployment) === pullRequest.head.ref;

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
	if (workflowOwned) {
		params.set(`meta-${WORKFLOW_DEPLOYMENT_MARKER}`, '1');
		params.set('meta-thingtimePrPreviewPolicy', PR_PREVIEW_POLICY_VERSION);
		params.set('meta-thingtimeBuildTarget', PR_VERCEL_TARGET);
		params.set('meta-thingtimeCustomEnvironmentId', config.customEnvironmentId);
	}
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
		teamSlug: 'team',
		deploymentAttempt: '123-1',
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
	equal(Object.keys(metadata).length, 17);
	equal(metadata.thingtimeBuildTarget, 'develop');
	equal(metadata.thingtimePrPreviewPolicy, '3');
	equal(metadata.thingtimeCustomEnvironmentId, config.customEnvironmentId);
	equal(metadata.thingtimeGatewayOrigin, 'https://master.previews.thingtime.com');
	equal(metadata.thingtimeGatewayOwner, 'false');
	const runtimeEnvironment = prPreviewRuntimeEnvironment(config, base);
	const prebuiltArgs = prebuiltDeploymentArgs({ config, prebuiltDirectory: '/tmp/prebuilt', metadata, runtimeEnvironment });
	truthy(prebuiltArgs.includes('--target=develop'));
	truthy(!prebuiltArgs.includes('--target=preview'));
	truthy(!prebuiltArgs.includes('--prod'));
	truthy(!prebuiltArgs.some((arg) => String(arg).includes('THINGTIME_MONGODB_CONNECTION_MODE')));
	equal(prGatewayPolicy('main').owner, false);
	equal(prGatewayPolicy('develop').environment, 'preview');
	equal(gatewayPolicy({ branch: 'develop', target: { slug: 'develop' } }).origin, 'https://dev.thingtime.com');
	equal(gatewayPolicy({ branch: 'main', target: { slug: 'production' } }).origin, 'https://thingtime.com');
	equal(previewGatewaySecretRow([{ id: 'env_preview', key: 'THINGTIME_GATEWAY_SECRET', type: 'encrypted', target: ['preview'] }]).id, 'env_preview');
	checks += 1;
	for (const rows of [[], [{ id: 'env_bad', key: 'THINGTIME_GATEWAY_SECRET', type: 'encrypted', target: ['production'] }], [{ id: 'env_bad', key: 'THINGTIME_GATEWAY_SECRET', type: 'encrypted', customEnvironmentIds: [config.customEnvironmentId] }], [{ id: 'env_bad', key: 'THINGTIME_GATEWAY_SECRET', type: 'plain', target: ['preview'] }], [{ id: 'env_a', key: 'THINGTIME_GATEWAY_SECRET', type: 'encrypted', target: ['preview'] }, { id: 'env_b', key: 'THINGTIME_GATEWAY_SECRET', type: 'encrypted', target: ['preview'] }]]) throws(() => previewGatewaySecretRow(rows));
	truthy(!prebuiltArgs.includes('--skip-domain')); // CLI 59.10 permits this only for production.
	truthy(prebuiltArgs.includes('--env'));
	truthy(prebuiltArgs.includes('THINGTIME_GATEWAY_SECRET'));
	truthy(!prebuiltArgs.some((arg) => String(arg).startsWith('THINGTIME_GATEWAY_SECRET=')));
	truthy(prebuiltArgs.includes(`THINGTIME_BRANCH_NAME=${base.head.ref}`));
	truthy(prebuiltArgs.includes(`THINGTIME_GIT_COMMIT_SHA=${base.head.sha}`));
	equal(runtimeEnvironment.THINGTIME_GATEWAY_SOURCE_ORIGINS, 'https://pr-201.previews.dev.thingtime.com');
	equal(prebuiltArgs.filter((arg) => String(arg).startsWith('THINGTIME_GATEWAY_SOURCE_ORIGINS=')),
		['THINGTIME_GATEWAY_SOURCE_ORIGINS=https://pr-201.previews.dev.thingtime.com']);
	const uploadEnvironment = prebuiltUploadEnvironment(config, base.head.ref, 's'.repeat(32), 'synthetic-token', {
		THINGTIME_GATEWAY_SECRET: 'wrong-custom-develop-secret',
		THINGTIME_GATEWAY_ENVIRONMENT: 'develop',
		THINGTIME_GATEWAY_ORIGIN: 'https://dev.thingtime.com',
		THINGTIME_MONGODB_CONNECTION_MODE: 'proxy'
	});
	equal(uploadEnvironment.THINGTIME_GATEWAY_SECRET, 's'.repeat(32));
	equal(uploadEnvironment.THINGTIME_GATEWAY_ENVIRONMENT, 'preview');
	equal(uploadEnvironment.THINGTIME_GATEWAY_ORIGIN, 'https://master.previews.thingtime.com');
	equal(uploadEnvironment.THINGTIME_MONGODB_CONNECTION_MODE, undefined);
	equal(uploadEnvironment.VERCEL_TARGET_ENV, 'develop');
	truthy(!prebuiltArgs.some((arg) => String(arg).includes('s'.repeat(32))));
	checks += 1;
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
		target: null,
		customEnvironment: { id: config.customEnvironmentId, slug: 'develop' },
		meta: {
			...gatewayMetadata(prGatewayPolicy(base.head.ref)),
			[WORKFLOW_DEPLOYMENT_MARKER]: '1',
			githubPrId: '201',
			githubRepoId: String(config.gitRepoId),
			githubRepositoryId: String(config.repositoryId),
			githubCommitOrg: 'lopugit',
			githubCommitRepo: 'thingtime',
			githubCommitSha: base.head.sha,
			githubCommitRef: base.head.ref,
			thingtimePrPreviewPolicy: PR_PREVIEW_POLICY_VERSION,
			thingtimePrPreviewAttempt: config.deploymentAttempt,
			thingtimeBuildTarget: PR_VERCEL_TARGET,
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
		meta: { ...deployment.meta, ...gatewayMetadata(prGatewayPolicy(base.head.ref)), [PREBUILT_DEPLOYMENT_MARKER]: '1' },
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
	const previousPolicyDeployment = { ...prebuiltDeployment, meta: { ...prebuiltDeployment.meta, thingtimePrPreviewPolicy: PREVIOUS_PR_PREVIEW_POLICY_VERSION } };
	equal(deploymentIdentityIssue(previousPolicyDeployment, config, { prNumber: 201 }), 'output-policy');
	equal(deploymentIdentityIssue(previousPolicyDeployment, config, { prNumber: 201, allowPreviousPolicy: true }), null);
	equal(choosePreferredDeployment([previousPolicyDeployment], config, base.head.sha), null);
	const previousPolicyBinding = await getAliasBinding(config, 201, {
		readAlias: async () => ({ deploymentId: previousPolicyDeployment.id, uid: 'als_previous' }),
		readDeployment: async () => previousPolicyDeployment
	});
	equal(previousPolicyBinding.legacy, false);
	equal(retainPreviousPolicyAliasDuringRecovery(previousPolicyBinding, base), true);
	equal(retainPreviousPolicyAliasDuringRecovery(previousPolicyBinding, { ...base, head: { ...base.head, sha: 'f'.repeat(40) } }), false);
	for (const [changed, issue] of [
		[{ target: 'production' }, 'wrong-target'],
		[{ customEnvironment: null }, 'wrong-environment'],
		[{ customEnvironmentId: 'env_wrong' }, 'wrong-environment'],
		[{ meta: { ...prebuiltDeployment.meta, thingtimePrPreviewPolicy: '1' } }, 'output-policy'],
		[{ meta: { ...prebuiltDeployment.meta, thingtimeBuildTarget: 'preview' } }, 'metadata-environment-mismatch'],
		[{ meta: { ...prebuiltDeployment.meta, thingtimeCustomEnvironmentId: 'env_wrong' } }, 'metadata-environment-mismatch'],
		[{ meta: { ...prebuiltDeployment.meta, thingtimeGatewayOrigin: 'https://dev.thingtime.com' } }, 'gateway-policy'],
		[{ meta: { ...prebuiltDeployment.meta, thingtimeGatewayOwner: 'true' } }, 'gateway-policy']
	]) {
		equal(deploymentIdentityIssue({ ...prebuiltDeployment, ...changed }, config, { prNumber: 201 }), issue);
	}
	const legacyDeployment = { ...deployment, customEnvironment: { id: config.customEnvironmentId, slug: 'develop' }, meta: { ...deployment.meta, ...gatewayMetadata(gatewayPolicy({ branch: base.head.ref, target: { slug: 'develop' }, follower: true })), thingtimeCustomEnvironmentId: config.customEnvironmentId } };
	delete legacyDeployment.meta.thingtimePrPreviewPolicy;
	delete legacyDeployment.meta.thingtimePrPreviewAttempt;
	delete legacyDeployment.meta.thingtimeBuildTarget;
	equal(deploymentIdentityIssue(legacyDeployment, config, { prNumber: 201 }), 'output-policy');
	equal(deploymentIdentityIssue(legacyDeployment, config, { prNumber: 201, legacyAlias: true }), null);
	equal(choosePreferredDeployment([legacyDeployment], config, base.head.sha), null);
	equal(deploymentIdentityIssue({ ...legacyDeployment, target: 'production' }, config, { prNumber: 201, legacyAlias: true }), 'wrong-target');
	const legacyBinding = await getAliasBinding(config, 201, {
		readAlias: async () => ({ deploymentId: legacyDeployment.id, uid: 'als_legacy' }),
		readDeployment: async () => legacyDeployment
	});
	equal(legacyBinding.legacy, true);
	equal(await removeAliasForPr(config, 201, { readBinding: async () => legacyBinding, request: async () => { throw new Error('Legacy alias must not be deleted'); } }), false);
	await assert.rejects(getAliasBinding(config, 202, {
		readAlias: async () => ({ deploymentId: legacyDeployment.id }), readDeployment: async () => legacyDeployment
	}), /wrong-pull-request/);
	checks += 1;
	await assert.rejects(getAliasBinding(config, 201, {
		readAlias: async () => ({ deploymentId: legacyDeployment.id }), readDeployment: async () => ({ ...legacyDeployment, id: 'dpl_other' })
	}), /Alias deployment ID mismatch/);
	checks += 1;
	equal(deploymentIdentityIssue({ ...legacyDeployment, meta: { ...legacyDeployment.meta, thingtimeGatewayOrigin: 'https://master.previews.thingtime.com' } }, config, { prNumber: 201, legacyAlias: true }), 'gateway-policy');
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
	equal(choosePreferredDeployment([{ ...deployment, meta: { ...deployment.meta, thingtimeGatewayOrigin: 'https://dev.thingtime.com' } }], config, base.head.sha), null);
	equal(choosePreferredDeployment([prebuiltDeployment], config, base.head.sha)?.id, prebuiltDeployment.id);
	equal(choosePreferredDeployment([{ ...deployment, readyState: 'ERROR' }], config, base.head.sha), null);
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
		'meta-thingtimePrPreviewPolicy': PR_PREVIEW_POLICY_VERSION,
		'meta-thingtimeBuildTarget': PR_VERCEL_TARGET,
		'meta-thingtimeCustomEnvironmentId': config.customEnvironmentId,
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

	const master = { id: 'dpl_master', projectId: config.projectId, readyState: 'READY', target: null, customEnvironment: null,
		meta: { ...gatewayMetadata(gatewayPolicy({ branch: 'main', target: PR_PREVIEW_TARGET, owner: true })), [stablePublisherMarker]: '1', thingtimePrebuiltPolicy: stablePublisherPolicyVersion, thingtimeBuildTarget: 'preview', githubCommitRef: 'main', githubCommitSha: base.head.sha } };
	const masterDependencies = (candidate = master) => ({
		readGithub: async (path) => { equal(path, `/repos/${config.repository}/git/ref/heads/main`); return { ref: 'refs/heads/main', object: { type: 'commit', sha: base.head.sha } }; },
		readVercel: async (path) => {
			if (path === `/v4/aliases/master.previews.thingtime.com?projectId=${encodeURIComponent(config.projectId)}`) {
				return { alias: 'master.previews.thingtime.com', projectId: config.projectId, deploymentId: 'dpl_master' };
			}
			equal(path, '/v13/deployments/dpl_master?withGitRepoInfo=true');
			return candidate;
		},
		verify: async (name, policy, id) => { equal(name, 'master.previews.thingtime.com'); equal(policy.environment, 'preview'); equal(id, 'dpl_master'); }
	});
	await assertPreviewMaster(config, masterDependencies());
	checks += 1;
	for (const candidate of [
		{ ...master, target: 'production' },
		{ ...master, customEnvironment: { id: config.customEnvironmentId } },
		{ ...master, meta: { ...master.meta, githubCommitRef: 'develop' } },
		{ ...master, meta: { ...master.meta, thingtimeGatewayOwner: 'false' } },
		{ ...master, meta: { ...master.meta, githubCommitSha: 'b'.repeat(40) } }
	]) {
		await assert.rejects(assertPreviewMaster(config, masterDependencies(candidate)), /Controlled preview master/);
		checks += 1;
	}
	const developEnvironment = { id: config.customEnvironmentId, slug: 'develop', branchMatcher: { type: 'equals', pattern: 'develop' }, domains: [] };
	const developDomain = { projectId: config.projectId, verified: true, gitBranch: 'develop', customEnvironmentId: null };
	const developPreflight = (environment = developEnvironment, domain = developDomain) =>
		assertCustomDevelopEnvironment(config, async (path) => path.includes('/custom-environments/') ? environment : domain);
	await developPreflight(); checks += 1;
	let developPreflightPaths = [];
	await assertCustomDevelopEnvironment(config, async (path) => {
		developPreflightPaths.push(path);
		return path.includes('/custom-environments/') ? developEnvironment : developDomain;
	});
	equal(developPreflightPaths, [
		`/v9/projects/${config.projectId}/custom-environments/${config.customEnvironmentId}`,
		`/v9/projects/${config.projectId}/domains/${config.stableDevelopDomain}`
	]);
	checks += 1;
	for (const [environment, domain] of [
		[{ ...developEnvironment, slug: 'preview' }, developDomain],
		[{ ...developEnvironment, branchMatcher: { type: 'startsWith', pattern: 'develop' } }, developDomain],
		[{ ...developEnvironment, domains: ['dev.thingtime.com'] }, developDomain],
		[developEnvironment, { ...developDomain, gitBranch: base.head.ref }]
	]) {
		await assert.rejects(developPreflight(environment, domain)); checks += 1;
	}
	let masterApiRequests = 0;
	const runtimeProbe = (status) => ({
		verifyManifest: async (name, policy, id) => { equal(name, 'master.previews.thingtime.com'); equal(policy.environment, 'preview'); equal(id, 'dpl_master'); },
		fetcher: async (url, options) => { equal(url, 'https://master.previews.thingtime.com/api/root-data'); equal(options.redirect, 'error'); masterApiRequests += 1; return new Response('{}', { status, headers: { 'content-type': 'application/json' } }); },
		retry: (check) => check({ signal: AbortSignal.timeout(1000) })
	});
	await verifyPreviewMasterRuntime('master.previews.thingtime.com', { environment: 'preview' }, 'dpl_master', runtimeProbe(200));
	await assert.rejects(verifyPreviewMasterRuntime('master.previews.thingtime.com', { environment: 'preview' }, 'dpl_master', runtimeProbe(503)), /Preview master API is not ready/);
	equal(masterApiRequests, 2);
	checks += 2;
	for (const rows of [[], [{ id: 'env_bad', key: 'THINGTIME_GATEWAY_SECRET', type: 'encrypted', target: ['production'] }],
		[{ id: 'env_bad', key: 'THINGTIME_GATEWAY_SECRET', type: 'encrypted', customEnvironmentIds: [config.customEnvironmentId] }],
		[{ id: 'env_bad', key: 'THINGTIME_GATEWAY_SECRET', type: 'encrypted', target: ['preview'], gitBranch: 'another-branch' }]]) {
		let uploaded = false;
		await assert.rejects(deployPrebuiltOutput(config, base, {
			directory: '/unused/secret-fence-test', prepare: async () => {},
			readVariables: async (path) => { equal(path, `/v10/projects/${config.projectId}/env`); return { envs: rows }; },
			execute: async () => { uploaded = true; throw new Error('unexpected upload'); }
		}), /Exactly one unbranched, encrypted standard Preview gateway secret is required/);
		equal(uploaded, false);
		checks += 1;
	}
	const listedSecret = { id: 'env_preview', key: 'THINGTIME_GATEWAY_SECRET', type: 'encrypted', target: ['preview'] };
	const previewSecret = 'a'.repeat(32);
	equal(await readPreviewGatewaySecret(config, async (path) => path.endsWith('/env') ? { envs: [listedSecret] } : { ...listedSecret, decrypted: true, value: previewSecret }), previewSecret);
	for (const changed of [{ id: 'env_other' }, { target: ['develop'] }, { decrypted: false }, { value: 'short' }]) {
		await assert.rejects(readPreviewGatewaySecret(config, async (path) => path.endsWith('/env') ? { envs: [listedSecret] } : { ...listedSecret, decrypted: true, value: previewSecret, ...changed }), /could not be decrypted with its exact scope/);
		checks += 1;
	}
	const domainInventory = async () => ({ domains: [{ name: 'thingtime.com' }, { name: config.stableDevelopDomain, gitBranch: 'develop' }, { name: '*.previews.thingtime.com' }] });
	const protectedNames = await protectedPreviewAliasNames(config, base, domainInventory);
	for (const name of ['thingtime.com', 'dev.thingtime.com', 'master.previews.thingtime.com', '*.previews.thingtime.com', 'thingtime-git-main-team.vercel.app', 'thingtime-git-develop-team.vercel.app']) truthy(protectedNames.includes(name));
	for (const ref of ['main', 'develop']) {
		await assert.rejects(protectedPreviewAliasNames(config, { ...base, head: { ...base.head, ref } }, domainInventory), /Protected source branch/);
		checks += 1;
	}
	await assert.rejects(protectedPreviewAliasNames(config, base, async () => ({ domains: [{ name: 'stable.example.com', gitBranch: base.head.ref }] })), /bound to a protected project domain/);
	checks += 1;
	const guardedUploadFixture = () => {
		const bindings = new Map([['thingtime.com', { deploymentId: 'dpl_production' }], ['dev.thingtime.com', { deploymentId: 'dpl_develop' }], ['master.previews.thingtime.com', { deploymentId: 'dpl_master' }]]);
		const receipts = []; const assigned = []; const removed = [];
		const options = {
			names: (c, pr) => protectedPreviewAliasNames(c, pr, domainInventory),
			read: async (name) => bindings.get(name) || null,
			assign: async (name, id) => { assigned.push([name, id]); bindings.set(name, { deploymentId: id }); },
			remove: async (name) => { removed.push(name); bindings.delete(name); },
			inventory: async () => [prebuiltDeployment], receipt: async (record) => receipts.push(record)
		};
		return { bindings, receipts, assigned, removed, options };
	};
	// The CLI may assign before returning. Restore only our exact verified
	// attempt, remove only new bindings, and keep a concurrent operator's move.
	for (const uncertain of [false, true]) {
		const fixture = guardedUploadFixture(); let calls = 0;
		const result = await guardPreviewUpload(config, base, async () => {
			calls += 1;
			fixture.bindings.set('dev.thingtime.com', { deploymentId: prebuiltDeployment.id });
			fixture.bindings.set('thingtime-git-main-team.vercel.app', { deploymentId: prebuiltDeployment.id });
			fixture.bindings.set('master.previews.thingtime.com', { deploymentId: 'dpl_operator' });
			if (uncertain) throw new Error('CLI transport failed after provider accepted upload');
			return prebuiltDeployment;
		}, fixture.options);
		equal(calls, 1); equal(result.id, prebuiltDeployment.id);
		equal(fixture.bindings.get('dev.thingtime.com')?.deploymentId, 'dpl_develop');
		equal(fixture.bindings.get('thingtime.com')?.deploymentId, 'dpl_production');
		equal(fixture.bindings.get('master.previews.thingtime.com')?.deploymentId, 'dpl_operator');
		equal(fixture.bindings.has('thingtime-git-main-team.vercel.app'), false);
		equal(fixture.receipts.at(-1).state, 'aliases-restored');
	}
	for (const change of [{ thingtimePrPreviewAttempt: '122-1' }, { githubCommitSha: 'b'.repeat(40) }, { thingtimeBuildTarget: 'preview' }]) {
		const fixture = guardedUploadFixture();
		fixture.options.inventory = async () => [{ ...prebuiltDeployment, meta: { ...prebuiltDeployment.meta, ...change } }];
		await assert.rejects(guardPreviewUpload(config, base, async () => { throw new Error('uncertain upload'); }, fixture.options), (error) => /upload outcome is uncertain/.test(error.message) && error.preservePreviewAttempt === true);
		equal(fixture.receipts.at(-1).state, 'upload-uncertain');
		equal(fixture.assigned.length, 0); checks += 1;
	}
	const restorationFailure = guardedUploadFixture();
	restorationFailure.options.assign = async () => { throw new Error('provider restore unavailable'); };
	await assert.rejects(guardPreviewUpload(config, base, async () => {
		restorationFailure.bindings.set('dev.thingtime.com', { deploymentId: prebuiltDeployment.id }); return prebuiltDeployment;
	}, restorationFailure.options), (error) => /Protected alias restoration is uncertain/.test(error.message) && error.preservePreviewAttempt === true);
	equal(restorationFailure.receipts.at(-1).state, 'restoration-uncertain'); checks += 1;
	const heldAlias = new Map([['dev.thingtime.com', { deploymentId: prebuiltDeployment.id }]]);
	const protectedGuard = (c, candidate) => assertNoProtectedAlias(c, candidate, {
		names: async () => ['dev.thingtime.com', 'master.previews.thingtime.com'],
		read: async (name) => heldAlias.get(name) || null
	});
	let laterMutations = 0;
	await assert.rejects(prepareDeployment(config, base, {
		list: async () => [prebuiltDeployment], guard: protectedGuard,
		remove: async () => { laterMutations += 1; },
		cleanup: async () => { laterMutations += 1; }
	}), /still owns protected alias dev\.thingtime\.com/);
	equal(laterMutations, 0); checks += 1;
	await assert.rejects(cancelAndDeleteDeployment(prebuiltDeployment, config, base.number, {
		refresh: async () => prebuiltDeployment, guard: protectedGuard,
		request: async () => { laterMutations += 1; }
	}), /still owns protected alias dev\.thingtime\.com/);
	equal(laterMutations, 0); checks += 1;
	heldAlias.set('dev.thingtime.com', { deploymentId: 'dpl_operator' });
	const activeCandidate = { ...prebuiltDeployment, readyState: 'BUILDING' };
	let activeGuardChecks = 0;
	let candidateDeleteRequests = 0;
	await assert.rejects(cancelAndDeleteDeployment(activeCandidate, config, base.number, {
		refresh: async () => activeCandidate,
		guard: async () => {
			activeGuardChecks += 1;
			if (activeGuardChecks === 1) return;
			heldAlias.set('master.previews.thingtime.com', { deploymentId: activeCandidate.id });
			return protectedGuard(config, activeCandidate);
		},
		request: async (path) => {
			if (path.endsWith('/cancel')) { activeCandidate.readyState = 'CANCELED'; return {}; }
			candidateDeleteRequests += 1;
			return {};
		}
	}), /still owns protected alias master\.previews\.thingtime\.com/);
	equal(activeGuardChecks, 2);
	equal(candidateDeleteRequests, 0);
	checks += 1;
	heldAlias.set('master.previews.thingtime.com', { deploymentId: 'dpl_operator' });
	await protectedGuard(config, prebuiltDeployment); checks += 1;
	let cleanCandidateCleanup = null;
	const cleanCandidate = await prepareDeployment(config, base, {
		list: async () => [prebuiltDeployment], guard: async () => {},
		remove: async () => {},
		cleanup: async (_items, _config, _pr, keep) => { cleanCandidateCleanup = keep; }
	});
	equal(cleanCandidate.id, prebuiltDeployment.id);
	truthy(cleanCandidateCleanup.has(prebuiltDeployment.id));
	checks += 1;
	let earlyUpload = false;
	await assert.rejects(guardPreviewUpload(config, base, async () => { earlyUpload = true; return prebuiltDeployment; }, {
		names: async () => [], receipt: async () => { throw new Error('receipt unavailable'); }
	}), /receipt unavailable/);
	equal(earlyUpload, false); checks += 1;
	const receiptDirectory = await mkdtemp(join(tmpdir(), 'thingtime-pr-preview-receipt-'));
	try {
		const receiptPath = join(receiptDirectory, 'receipt.json');
		await savePreviewUploadReceipt({ state: 'uploading', attempt: config.deploymentAttempt }, receiptPath);
		equal(JSON.parse(await readFile(receiptPath, 'utf8')).attempt, config.deploymentAttempt);
		equal((await readdir(receiptDirectory)).length, 1);
		let attemptedDespiteAtomicReceiptFailure = false;
		await assert.rejects(guardPreviewUpload(config, base, async () => {
			attemptedDespiteAtomicReceiptFailure = true;
			return prebuiltDeployment;
		}, { names: async () => [], receipt: (record) => savePreviewUploadReceipt(record, receiptDirectory) }), /EISDIR|directory/i);
		equal(attemptedDespiteAtomicReceiptFailure, false);
		equal((await readdir(receiptDirectory)).length, 1);
		checks += 1;
	} finally { await rm(receiptDirectory, { recursive: true, force: true }); }
	const workflow = await readFile(new URL('../workflows/develop-pr-preview.yml', import.meta.url), 'utf8');
	const buildJob = workflow.split('\n  build:')[1].split('\n  controller:')[0];
	truthy(buildJob.includes('VERCEL_ENV: preview'));
	truthy(buildJob.includes('VERCEL_TARGET_ENV: develop'));
	truthy(!/secrets\.|VERCEL_API_TOKEN|environment: vercel-/.test(buildJob));
	truthy(buildJob.includes('VERCEL_GIT_COMMIT_REF: ${{ needs.prepare.outputs.head_ref }}'));
	truthy(!buildJob.includes('THINGTIME_MONGODB_CONNECTION_MODE'));
	// Missing preview secret is fenced before the upload subprocess; production
	// and custom-develop rows cannot satisfy it. No secret values enter argv.
	const source = await readFile(new URL(import.meta.url), 'utf8');
	const upload = source.slice(source.lastIndexOf('const deployPrebuiltOutput = async')).split('const createVercelDeployment')[0];
	truthy(upload.indexOf('readPreviewGatewaySecret(') < upload.indexOf('await execute('));
	truthy(!source.slice(source.lastIndexOf('const main = async')).includes('reconcileStableDevelopAlias('));
	const deployHandler = source.slice(source.lastIndexOf('const deploy = async')).split('const writePrepareOutputs')[0];
	truthy(deployHandler.includes('if (!error.preservePreviewAttempt) await Promise.allSettled([cleanupPrResources('));
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
// `ENOENT ... /product/remix`, and published a "PR preview failed"
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
	if (['main', 'develop', 'github-actions'].includes(pullRequest.head?.ref)) throw new EligibilityError('protected-source-branch');
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
		() => publishPreviewSummary({ request: githubRequest, repository: config.repository, number: pullRequest.number,
			sha: pullRequest.head.sha, summary: deploymentComment({ pullRequest, ...fields }) }),
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
		description: 'Thingtime custom-develop PR deployment with Preview gateway',
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
		state === 'ready' ? '✅ PR preview ready' : state === 'failed' ? '❌ PR preview failed' : '🧪 PR preview deploying';
	const previewLabel = state === 'ready' ? 'Preview' : 'Expected preview';
	const previewLine = `- ${previewLabel}: [https://${alias}](https://${alias})`;
	const expectedLine = state === 'deploying' && expectedReady ? `\n- Expected ready: ${expectedReady.replace('T', ' ').replace(':00.000Z', ' UTC')} (estimate)` : '';
	const builtLine = builtAt ? `\n- Last successfully built: ${previewBuildTime(builtAt)} (Australia/Melbourne)` : '';
	return `### ${title}\n\n- Commit: \`${sha}\`\n- Vercel credential target: custom \`develop\`\n- Gateway: shared \`preview\`\n${previewLine}${expectedLine}${builtLine}${
		deploymentUrl ? `\n- Immutable deployment: [${deploymentUrl}](${deploymentUrl})` : ''
	}${dashboard ? `\n- Vercel status: [open deployment](${dashboard})` : ''}${
		note ? `\n\n${note}` : ''
	}\n\nThis PR deployment uses master.previews.thingtime.com and development data. The URL namespace is retained for compatibility; cleanup owns only current-policy PR deployments.`;
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

// Only the protected stable publisher owns the preview master. This controller
// reads its main-source/preview-target provenance and live runtime; it never
// promotes develop or points arbitrary PR code at a stable gateway hostname.
const verifyPreviewMasterRuntime = async (name, policy, deploymentId, { verifyManifest = verifyCanonicalGateway, fetcher = fetch, retry = verifyAlias } = {}) => retry(async ({ signal }) => {
	await verifyManifest(name, policy, deploymentId, signal);
	const response = await fetcher(`https://${name}/api/root-data`, { signal, cache: 'no-store', redirect: 'error' });
	if (!response.ok || !(response.headers.get('content-type') || '').includes('json')) throw new Error('Preview master API is not ready');
	await response.json();
});

const assertPreviewMaster = async (config, { readGithub = githubRequest, readVercel = vercelRequest, verify = verifyPreviewMasterRuntime } = {}) => {
	const reference = await readGithub(`/repos/${config.repository}/git/ref/heads/main`);
	if (reference?.ref !== 'refs/heads/main' || reference.object?.type !== 'commit' || !/^[0-9a-f]{40}$/.test(reference.object?.sha || '')) throw new Error('Preview master main source ref was invalid');
	const policy = gatewayPolicy({ branch: 'main', target: PR_PREVIEW_TARGET, owner: true });
	const name = new URL(policy.origin).hostname;
	const alias = await readVercel(`/v4/aliases/${encodeURIComponent(name)}?projectId=${encodeURIComponent(config.projectId)}`);
	if (alias?.alias !== name || alias.projectId !== config.projectId || !/^dpl_[A-Za-z0-9]+$/.test(alias.deploymentId || '')) throw new Error('Preview master alias ownership mismatch');
	const deployment = await readVercel(`/v13/deployments/${encodeURIComponent(alias.deploymentId)}?withGitRepoInfo=true`);
	const issue = stablePublisherDeploymentIssue(deployment, { sha: reference.object.sha, branch: 'main', target: PR_PREVIEW_TARGET, projectId: config.projectId });
	if (issue || deployment.id !== alias.deploymentId || deployment.readyState !== 'READY') throw new Error(`Controlled preview master is not ready (${issue || 'deployment-state'})`);
	await verify(name, policy, deployment.id);
};

const assertCustomDevelopEnvironment = async (config, request = vercelRequest) => {
	const customEnvironment = await request(
		`/v9/projects/${encodeURIComponent(config.projectId)}/custom-environments/${encodeURIComponent(config.customEnvironmentId)}`
	);
	if (customEnvironment?.id !== config.customEnvironmentId || customEnvironment?.slug !== PR_VERCEL_TARGET ||
		customEnvironment.branchMatcher?.type !== 'equals' || customEnvironment.branchMatcher?.pattern !== 'develop') {
		throw new Error('Vercel custom environment identity did not match develop');
	}
	const stableDomain = await request(
		`/v9/projects/${encodeURIComponent(config.projectId)}/domains/${encodeURIComponent(config.stableDevelopDomain)}`
	);
	const stableDomainIssue = stableDevelopDomainBindingIssue(customEnvironment, stableDomain, config);
	if (stableDomainIssue) {
		throw new Error(`Stable develop domain must track only the develop Git branch (${stableDomainIssue})`);
	}
};

const assertVercelConfiguration = async (config) => {
	const project = await vercelRequest(`/v9/projects/${encodeURIComponent(config.projectId)}`);
	if (project?.id !== config.projectId || project?.name !== config.projectName) {
		throw new Error('Vercel project identity did not match the configured exact project');
	}
	// Prebuilt-only projects deliberately disconnect the native Git integration.
	// An existing link must still match; project identity and team scope above
	// remain mandatory when that optional source-build integration is absent.
	if (project.link && String(project.link.repoId ?? '') !== String(config.gitRepoId)) {
		throw new Error('Vercel project Git repository did not match the configured repository');
	}
	await assertCustomDevelopEnvironment(config);

	await assertPreviewMaster(config);

	const wildcardPolicies = [
		{ label: 'Development preview', suffix: config.previewAliasSuffix, expectedGitBranch: 'develop', expectedRuntimeBranch: 'develop' },
		// Vercel deliberately refuses to bind a project domain to the production
		// branch as a Preview domain. Detached is therefore the only valid
		// production binding; the live branch probe below makes that default
		// explicit and fails closed if Vercel ever routes it elsewhere.
		{ label: 'Production preview', suffix: config.productionPreviewAliasSuffix, expectedGitBranch: null, expectedRuntimeBranch: 'main' }
	];
	for (const policy of wildcardPolicies) {
		if (config.missingBuildPage) policy.expectedGitBranch = FALLBACK_BRANCH;
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
};

const verifyWildcardFallbackRuntime = async ({ suffix, expectedBranch, missingBuildPage = false }) => {
	const hostname = `controller-fallback-probe.${suffix}`;
	let lastError = null;
	for (let attempt = 0; attempt < 5; attempt += 1) {
		try {
			const response = await fetch(`https://${hostname}/${missingBuildPage ? '' : 'api/root-data'}`, {
				headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
				redirect: 'manual',
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
			});
			if (missingBuildPage) {
				const issue = fallbackResponseIssue(response, await response.text());
				if (!issue) return;
				lastError = new Error(`Missing-build fallback check failed: ${issue}`);
			} else if (!response.ok) {
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
	await verifyWildcardFallbackRuntime({ suffix: config.previewAliasSuffix, expectedBranch: 'develop', missingBuildPage: config.missingBuildPage });
	await verifyWildcardFallbackRuntime({ suffix: config.productionPreviewAliasSuffix, expectedBranch: 'main', missingBuildPage: config.missingBuildPage });
};

const verifyPublishedAlias = (aliasUrl) => verifyPublishedPreview(aliasUrl);

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
			candidate.meta?.[WORKFLOW_DEPLOYMENT_MARKER] === '1' && candidate.meta?.thingtimePrPreviewPolicy === PR_PREVIEW_POLICY_VERSION && (prNumber === null || String(candidate.meta?.githubPrId ?? '') === String(prNumber))
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

const cancelAndDeleteDeployment = async (deployment, config, prNumber, {
	refresh = refreshOwnedDeployment, guard = assertNoProtectedAlias, request = vercelRequest
} = {}) => {
	let current = await refresh(deployment.id, config, prNumber);
	if (!current) return false;
	await guard(config, current);
	if (ACTIVE_STATES.has(current.readyState)) {
		try {
			await request(`/v12/deployments/${encodeURIComponent(current.id)}/cancel`, {
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
			current = await refresh(deployment.id, config, prNumber);
			if (!current) return false;
		} while (ACTIVE_STATES.has(current.readyState) && Date.now() < timeoutAt);
		if (ACTIVE_STATES.has(current.readyState)) {
			throw new Error('Canceled Vercel deployment did not become terminal within two minutes');
		}
	}
	await guard(config, current);
	await request(`/v13/deployments/${encodeURIComponent(current.id)}`, {
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

const getAliasBinding = async (config, prNumber, { readAlias = getOwnedAlias, readDeployment = deploymentDetail } = {}) => {
	const alias = previewAlias(prNumber, config.previewAliasSuffix);
	const found = await readAlias(config, alias);
	if (!found) return null;
	if (!/^dpl_[A-Za-z0-9]+$/.test(found.deploymentId ?? '')) {
		throw new Error('Owned alias did not point to a deployment');
	}
	const deployment = await readDeployment(found.deploymentId);
	if (deployment?.id !== found.deploymentId) throw new Error('Alias deployment ID mismatch');
	const legacy = deployment.meta?.thingtimePrPreviewPolicy == null;
	// A v2 alias remains identifiable for guarded replacement or alias removal.
	// Only v3 deployments are eligible for reuse and managed backend cleanup.
	const issue = deploymentIdentityIssue(deployment, config, { prNumber, legacyAlias: legacy, allowPreviousPolicy: true });
	if (issue) throw new Error(`Alias deployment ownership check failed (${issue})`);
	return { alias, record: found, deployment, legacy };
};

const removeAliasForPr = async (config, prNumber, { readBinding = getAliasBinding, request = vercelRequest } = {}) => {
	const binding = await readBinding(config, prNumber);
	// Legacy custom-develop resources age out separately; this sweep owns v2 only.
	if (!binding || binding.legacy) return false;
	await request(`/v2/aliases/${encodeURIComponent(binding.record.uid)}`, {
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
	await assertNoProtectedAlias(config, deployment);
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

const reconcileStableDevelopAlias = async (config, { waitForReady = false } = {}) => {
	await assertVercelConfiguration(config);
	const timeoutAt = Date.now() + STABLE_DEVELOP_TIMEOUT_MS;
	for (;;) {
		const expectedSha = await getDevelopHeadSha(config);
		const binding = await getStableDevelopAliasBinding(config);
		const bindingIssue = binding ? stablePublisherDeploymentIssue(binding.deployment, { sha: expectedSha, branch: 'develop', target: { slug: 'develop', kind: 'preview', id: config.customEnvironmentId }, projectId: config.projectId }) : 'missing-alias';
		if (binding && bindingIssue === null && binding.deployment.readyState === 'READY') {
			console.log(`Stable develop alias already current: ${config.stableDevelopDomain} -> ${expectedSha}`);
			return { changed: false, deploymentId: binding.deployment.id, sha: expectedSha };
		}

		// The protected prebuilt publisher exclusively owns stable gateway aliases.
		// This PR controller waits for that owner; it never promotes a legacy build.

		if (!waitForReady) {
			console.log(`Stable develop alias promotion deferred: current=${expectedSha}; binding=${bindingIssue}; stable publisher owns promotion`);
			return { changed: false, deferred: true, deploymentId: binding?.deployment.id ?? null, sha: expectedSha };
		}
		if (Date.now() >= timeoutAt) {
			throw new Error(`Timed out waiting for the exact develop deployment (${expectedSha})`);
		}
		await delay(STABLE_DEVELOP_POLL_MS);
	}
};

const prepareDeployment = async (config, pullRequest, {
	list = listWorkflowDeployments, remove = removeAliasForPr,
	cleanup = cleanupDeployments, guard = assertNoProtectedAlias
} = {}) => {
	const deployments = await list(config, { prNumber: pullRequest.number });
	const reusable = choosePreferredDeployment(deployments, config, pullRequest.head.sha);
	if (reusable) await guard(config, reusable);
	let aliasFailure = null;
	try {
		await remove(config, pullRequest.number);
	} catch (error) {
		aliasFailure = error;
	}
	const keepIds = reusable ? new Set([reusable.id]) : new Set();
	await cleanup(deployments, config, pullRequest.number, keepIds);
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
	args.push(...gatewayRuntimeArgs(prGatewayPolicy(metadata.githubCommitRef)));
	args.push('--env', 'THINGTIME_GATEWAY_SECRET');
	for (const [key, value] of Object.entries(runtimeEnvironment).sort(([left], [right]) => left.localeCompare(right))) {
		args.push('--env', `${key}=${value}`);
	}
	for (const [key, value] of Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right))) {
		args.push('--meta', `${key}=${value}`);
	}
	return args;
};

const prPreviewRuntimeEnvironment = (config, pullRequest) => ({
	THINGTIME_BRANCH_NAME: pullRequest.head.ref,
	THINGTIME_GIT_COMMIT_SHA: pullRequest.head.sha,
	// The runtime accepts the one alias this publisher assigns. The direct
	// Vercel URL is admitted independently through VERCEL_URL.
	THINGTIME_GATEWAY_SOURCE_ORIGINS: `https://${previewAlias(pullRequest.number, config.previewAliasSuffix)}`
});

const prebuiltUploadEnvironment = (config, branch, gatewaySecret, token, inherited = process.env) => ({
	...gatewayPublisherEnvironment(prGatewayPolicy(branch), {
		...inherited,
		VERCEL_ORG_ID: config.teamId,
		VERCEL_PROJECT_ID: config.projectId,
		VERCEL_TARGET_ENV: PR_VERCEL_TARGET,
		VERCEL_TOKEN: token
	}),
	THINGTIME_GATEWAY_SECRET: gatewaySecret
});

const previewGatewaySecretRow = (rows) => {
	const matching = rows.filter((row) => row.key === 'THINGTIME_GATEWAY_SECRET' &&
		row.type === 'encrypted' && row.gitBranch == null &&
		Array.isArray(row.target) && row.target.length === 1 && row.target[0] === 'preview' &&
		(!row.customEnvironmentIds || row.customEnvironmentIds.length === 0));
	if (matching.length !== 1 || !matching[0].id || !/^[A-Za-z0-9_]+$/.test(matching[0].id)) {
		throw new Error('Exactly one unbranched, encrypted standard Preview gateway secret is required');
	}
	return matching[0];
};

const readPreviewGatewaySecret = async (config, readVariables = vercelRequest) => {
	const listed = await readVariables(`/v10/projects/${config.projectId}/env`);
	const row = previewGatewaySecretRow(listed.envs || []);
	const detail = await readVariables(`/v1/projects/${config.projectId}/env/${encodeURIComponent(row.id)}`);
	if (detail?.id !== row.id || detail.key !== row.key || detail.type !== row.type ||
		detail.gitBranch != null || !Array.isArray(detail.target) || detail.target.length !== 1 || detail.target[0] !== 'preview' ||
		(detail.customEnvironmentIds && detail.customEnvironmentIds.length > 0) || detail.decrypted !== true ||
		typeof detail.value !== 'string' || detail.value.length < 32) {
		throw new Error('Preview gateway secret could not be decrypted with its exact scope');
	}
	return detail.value;
};

const preparePrebuiltDirectory = async (config, prebuiltDirectory) => {
	await assertPrebuiltOutput(prebuiltDirectory);
	await mkdir(resolve(prebuiltDirectory, '.vercel'), { recursive: true });
	await writeFile(
		resolve(prebuiltDirectory, '.vercel/project.json'),
		`${JSON.stringify({ orgId: config.teamId, projectId: config.projectId })}\n`,
		{ mode: 0o600 }
	);

};

const protectedPreviewAliasNames = async (config, pullRequest, request = vercelRequest) => {
	if (['main', 'develop', 'github-actions'].includes(pullRequest.head.ref)) throw new Error('Protected source branch uses its canonical publisher; refusing ordinary PR upload');
	const names = new Set(['thingtime.com', config.stableDevelopDomain, new URL(prGatewayPolicy(pullRequest.head.ref).origin).hostname]);
	const seen = new Set();
	let until = null;
	for (let page = 0; page < MAX_DEPLOYMENT_PAGES; page += 1) {
		const params = new URLSearchParams({ limit: '100' });
		if (until !== null) params.set('until', String(until));
		const result = await request(`/v9/projects/${config.projectId}/domains?${params}`);
		if (!Array.isArray(result?.domains)) throw new Error('Protected domain inventory was invalid');
		for (const domain of result.domains) {
			if (domain.gitBranch === pullRequest.head.ref) throw new Error('PR source branch is bound to a protected project domain; refusing upload');
			const wildcard = String(domain.name || '').startsWith('*.');
			const name = `${wildcard ? '*.' : ''}${safeHostname(wildcard ? domain.name.slice(2) : domain.name, 'Protected domain')}`;
			names.add(name);
		}
		const next = result.pagination?.next;
		if (next == null) break;
		if (seen.has(next) || page === MAX_DEPLOYMENT_PAGES - 1) throw new Error('Protected domain inventory exceeded its safety bound');
		seen.add(next); until = boundedInteger(next, 'Domain cursor');
	}
	for (const branch of new Set(['main', 'develop', pullRequest.head.ref])) {
		for (const name of compatibilityAliasCandidates({ branch, projectName: config.projectName, teamSlug: config.teamSlug, target: { slug: PR_VERCEL_TARGET } })) names.add(name);
	}
	return [...names];
};

const savePreviewUploadReceipt = async (receipt, destination = requiredEnv('VERCEL_PREVIEW_RECEIPT_PATH')) => {
	const path = resolve(destination);
	const directory = dirname(path);
	const temporary = resolve(directory, `.${basename(path)}.${randomUUID()}.tmp`);
	let staged = false;
	try {
		const file = await open(temporary, 'wx', 0o600);
		staged = true;
		try {
			await file.writeFile(`${JSON.stringify(receipt)}\n`);
			await file.sync();
		} finally {
			await file.close();
		}
		await rename(temporary, path);
		staged = false;
		const parent = await open(directory, 'r');
		try { await parent.sync(); } finally { await parent.close(); }
	} finally {
		if (staged) await unlink(temporary).catch(() => undefined);
	}
};

const assertNoProtectedAlias = async (config, deployment, {
	names = protectedPreviewAliasNames,
	read = (name) => getOwnedAlias(config, name)
} = {}) => {
	if (!/^dpl_[A-Za-z0-9]+$/.test(deployment?.id ?? '') || !isSafeHeadRef(deployment?.meta?.githubCommitRef)) {
		throw new Error('Cannot inspect protected aliases for an invalid PR deployment');
	}
	for (const name of await names(config, { head: { ref: deployment.meta.githubCommitRef } })) {
		if ((await read(name))?.deploymentId === deployment.id) {
			throw new Error(`PR deployment ${deployment.id} still owns protected alias ${name}; preserve the upload receipt`);
		}
	}
};

const guardPreviewUpload = async (config, pullRequest, upload, {
	names = protectedPreviewAliasNames, read = (name) => getOwnedAlias(config, name),
	assign = (name, id) => vercelRequest(`/v2/deployments/${id}/aliases`, { method: 'POST', retries: 0, body: { alias: name } }),
	remove = async (name) => { const alias = await getOwnedAlias(config, name); if (alias) await vercelRequest(`/v2/aliases/${encodeURIComponent(alias.uid)}`, { method: 'DELETE', accept: [200, 204, 404] }); },
	inventory = () => listWorkflowDeployments(config, { prNumber: pullRequest.number, sha: pullRequest.head.sha }),
	receipt = savePreviewUploadReceipt
} = {}) => {
	const expected = { prNumber: pullRequest.number, expectedSha: pullRequest.head.sha, expectedRef: pullRequest.head.ref, expectedAttempt: config.deploymentAttempt };
	const before = new Map(await Promise.all((await names(config, pullRequest)).map(async (name) => [name, await read(name)])));
	const record = { attempt: config.deploymentAttempt, prNumber: pullRequest.number, sha: pullRequest.head.sha, ref: pullRequest.head.ref,
		aliases: [...before].map(([name, binding]) => ({ name, deploymentId: binding?.deploymentId || null })), state: 'uploading', deploymentId: null };
	await receipt(record);
	try {
	let deployment;
	try {
		deployment = await upload();
		const issue = deploymentIdentityIssue(deployment, config, expected);
		if (issue) throw new Error(`Uploaded Preview attempt identity mismatch (${issue})`);
	} catch (error) {
		let candidates;
		try { candidates = (await inventory()).filter((candidate) => candidate.meta?.thingtimePrPreviewAttempt === config.deploymentAttempt); }
		catch (recoveryError) { await receipt({ ...record, state: 'upload-uncertain' }); throw recoveryError; }
		if (candidates.length !== 1 || deploymentIdentityIssue(candidates[0], config, expected)) {
			await receipt({ ...record, state: 'upload-uncertain' });
			throw new Error(`Preview upload outcome is uncertain for attempt ${config.deploymentAttempt}; preserve the receipt and inspect before retrying`, { cause: error });
		}
		deployment = candidates[0];
	}
	await receipt({ ...record, deploymentId: deployment.id, state: 'restoring-aliases' });
	try {
		await restoreGatewayAliases({ before, deploymentId: deployment.id, read, assign, remove });
		for (const name of before.keys()) {
			if ((await read(name))?.deploymentId === deployment.id) throw new Error('PR attempt still owns a protected alias');
		}
	} catch (error) {
		await receipt({ ...record, deploymentId: deployment.id, state: 'restoration-uncertain' });
		throw new Error(`Protected alias restoration is uncertain for attempt ${config.deploymentAttempt}; preserve the receipt`, { cause: error });
	}
	await receipt({ ...record, deploymentId: deployment.id, state: 'aliases-restored' });
	return deployment;
	} catch (error) {
		// An uncertain attempt or rollback must remain inspectable; the caller
		// must not delete candidate deployments while aliases may still use them.
		error.preservePreviewAttempt = true;
		throw error;
	}
};

const deployPrebuiltOutput = async (config, pullRequest, {
	directory = requiredEnv('VERCEL_PREBUILT_DIR'), prepare = preparePrebuiltDirectory,
	readVariables = vercelRequest, execute = execFileAsync
} = {}) => {
	const prebuiltDirectory = resolve(directory);
	await prepare(config, prebuiltDirectory);
	const gatewaySecret = await readPreviewGatewaySecret(config, readVariables);
	const metadata = deploymentMetadata({ pullRequest, config });
	const runtimeEnvironment = prPreviewRuntimeEnvironment(config, pullRequest);
	const args = prebuiltDeploymentArgs({ config, prebuiltDirectory, metadata, runtimeEnvironment });

	return guardPreviewUpload(config, pullRequest, async () => {
	const { stdout } = await execute(resolve(requiredEnv('VERCEL_CLI_PATH')), args, {
		env: prebuiltUploadEnvironment(config, pullRequest.head.ref, gatewaySecret, requiredEnv('VERCEL_API_TOKEN')),
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
	});
};

const createVercelDeployment = async (config, pullRequest, reusable = null) => {
	if (reusable) {
		await assertNoProtectedAlias(config, reusable);
		return reusable;
	}
	const created = await deployPrebuiltOutput(config, pullRequest);
	const issue = deploymentIdentityIssue(created, config, {
		prNumber: pullRequest.number,
		expectedSha: pullRequest.head.sha,
		expectedRef: pullRequest.head.ref
	});
	if (issue || gatewayDeploymentIssue(created, prGatewayPolicy(pullRequest.head.ref))) throw new Error(`Created Vercel deployment failed identity validation (${issue || 'gateway-policy'})`);
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
		return '### 🧹 PR preview removed\n\nThe PR-specific alias and current-policy custom-develop PR deployments were removed when this PR closed.';
	}
	if (reason === 'draft') {
		return '### ⏭️ PR preview paused\n\nDraft PRs do not keep current-policy Preview resources. The preview will be rebuilt after an allowlisted maintainer marks the PR ready.';
	}
	if (reason === 'wrong-base') {
		return '### 🧹 PR preview removed\n\nThis PR no longer targets `develop`, so its credentialed preview resources were removed.';
	}
	return '### ⏭️ PR preview skipped\n\nThis PR or triggering actor is not currently eligible for the credentialed develop preview.';
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
	console.log(`PR preview ineligible for PR #${prNumber}: ${reason}; alias=${cleaned.aliasRemoved}; deployments=${cleaned.deleted}`);
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
			binding && !binding.legacy &&
			binding.deployment.meta?.thingtimePrPreviewPolicy === PR_PREVIEW_POLICY_VERSION &&
			binding.deployment.readyState === 'READY' &&
			workflowDeploymentCommitSha(binding.deployment) === pullRequest.head.sha &&
			workflowDeploymentCommitRef(binding.deployment) === pullRequest.head.ref
		) {
			keeper = binding.deployment;
		} else if (binding && !binding.legacy && !retainPreviousPolicyAliasDuringRecovery(binding, pullRequest)) {
			await vercelRequest(`/v2/aliases/${encodeURIComponent(binding.record.uid)}`, {
				method: 'DELETE',
				accept: [200, 204, 404]
			});
			removedAliases += 1;
		}
		keeper ??= choosePreferredDeployment(owned.filter((deployment) => workflowDeploymentCommitRef(deployment) === pullRequest.head.ref), config, pullRequest.head.sha);
		if (keeper) {
			await assertNoProtectedAlias(config, keeper);
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
					description: 'PR preview is ready at the exact current SHA'
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
	console.log(`PR preview reconciliation complete: prs=${byPullRequest.size}; aliases=${removedAliases}; deployments=${removedDeployments}`);
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
				description: 'PR preview deployment failed'
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
				description: 'Deploying exact SHA with custom-develop credentials and Preview gateway'
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
			description: 'PR preview is ready at the exact current SHA'
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
		console.log(`PR preview ready for PR #${pullRequest.number}: ${aliasUrl}`);
	} catch (error) {
		if (!published) {
			if (!error.preservePreviewAttempt) await Promise.allSettled([cleanupPrResources(config, pullRequest.number)]);
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
		const results = await Promise.allSettled([reconcile(config)]);
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
		return;
	}
	await deploy(config, pullRequest);
};

main().catch((error) => {
	console.error(error instanceof Error ? error.message : 'Develop PR preview failed');
	process.exitCode = 1;
});
