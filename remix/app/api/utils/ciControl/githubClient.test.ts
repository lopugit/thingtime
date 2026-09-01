import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalFeatureStackPlanFromPullRequests, resolveCiWorkflowDispatch, resolveCiWorkflowEntryRef } from './githubClient';

test('Feature Stack snapshots preserve admin order and exact same-repository heads', () => {
  const plan = canonicalFeatureStackPlanFromPullRequests({
    name: 'Search + Messenger',
    sourcePrNumbers: [12, 14],
    targets: ['develop', 'main'],
    repository: 'lopugit/thingtime',
    stackId: 'ci-feature-stack-11111111-1111-4111-8111-111111111111',
		runId: 'feature-stack-run-11111111-1111-4111-8111-111111111111',
    autoDecideBranches: true,
    pullRequests: [
			{
				number: 12,
				title: 'Search',
				state: 'open',
				draft: false,
				base: { ref: 'develop' },
				head: { ref: 'feature/search', sha: 'a'.repeat(40), repo: { full_name: 'lopugit/thingtime' } }
			},
			{
				number: 14,
				title: 'Messenger',
				state: 'open',
				draft: false,
				base: { ref: 'develop' },
				head: { ref: 'feature/messenger', sha: 'b'.repeat(40), repo: { full_name: 'lopugit/thingtime' } }
			}
    ]
  });
	assert.deepEqual(
		plan.sources.map((source) => source.pr),
		[12, 14]
	);
	assert.deepEqual(
		plan.sources.map((source) => source.targets),
		[
			['develop', 'main'],
			['develop', 'main']
		]
	);
  assert.throws(
		() =>
			canonicalFeatureStackPlanFromPullRequests({
				...plan,
				sourcePrNumbers: [12, 14],
				pullRequests: [
					{
						number: 12,
						title: 'Search',
						state: 'open',
						base: { ref: 'develop' },
						head: { ref: 'feature/search', sha: 'a'.repeat(40), repo: { full_name: 'someone/fork' } }
					},
					{
						number: 14,
						title: 'Messenger',
						state: 'open',
						base: { ref: 'develop' },
						head: { ref: 'feature/messenger', sha: 'b'.repeat(40), repo: { full_name: 'lopugit/thingtime' } }
					}
				],
				repository: 'lopugit/thingtime'
			}),
    /not an eligible immutable same-repository PR/
  );
});

test('Feature Stack accepts one source and auto-routes mixed branch families', () => {
  const common = {
    name: 'Product + controller',
    sourcePrNumbers: [21, 22],
    targets: ['main', 'github-actions'],
    repository: 'lopugit/thingtime',
    stackId: 'ci-feature-stack-22222222-2222-4222-8222-222222222222',
		runId: 'feature-stack-run-22222222-2222-4222-8222-222222222222',
    autoDecideBranches: true
  };
  const mixed = canonicalFeatureStackPlanFromPullRequests({
    ...common,
    pullRequests: [
			{
				number: 21,
				title: 'Product',
				state: 'open',
				draft: false,
				base: { ref: 'main' },
				head: { ref: 'feature/product', sha: 'c'.repeat(40), repo: { full_name: common.repository } }
			},
			{
				number: 22,
				title: 'Controller',
				state: 'open',
				draft: false,
				base: { ref: 'github-actions' },
				head: { ref: 'feature/controller', sha: 'd'.repeat(40), repo: { full_name: common.repository } }
			}
    ]
  });
	assert.deepEqual(
		mixed.sources.map((source) => source.targets),
		[['main'], ['github-actions']]
	);
  const single = canonicalFeatureStackPlanFromPullRequests({
    ...common,
    name: 'One feature',
    sourcePrNumbers: [21],
    targets: ['main'],
    pullRequests: [
			{
				number: 21,
				title: 'Product',
				state: 'open',
				draft: false,
				base: { ref: 'main' },
				head: { ref: 'feature/product', sha: 'c'.repeat(40), repo: { full_name: common.repository } }
			}
    ]
  });
  assert.equal(single.sources.length, 1);
  assert.deepEqual(single.sources[0].targets, ['main']);
});

test('Feature Stack auto-routing skips incompatible sources and empty targets without crossing branch families', () => {
	const common = {
		name: 'Product with optional controller target',
		sourcePrNumbers: [31, 32],
		targets: ['main', 'github-actions'],
		repository: 'lopugit/thingtime',
		stackId: 'ci-feature-stack-33333333-3333-4333-8333-333333333333',
		runId: 'feature-stack-run-33333333-3333-4333-8333-333333333333',
		autoDecideBranches: true
	};
	const productOnly = canonicalFeatureStackPlanFromPullRequests({
		...common,
		pullRequests: [
			{
				number: 31,
				title: 'Main product',
				state: 'open',
				base: { ref: 'main' },
				head: { ref: 'feature/main-product', sha: 'e'.repeat(40), repo: { full_name: common.repository } }
			},
			{
				number: 32,
				title: 'Develop product',
				state: 'open',
				base: { ref: 'develop' },
				head: { ref: 'feature/develop-product', sha: 'f'.repeat(40), repo: { full_name: common.repository } }
			}
		]
	});
	assert.deepEqual(
		productOnly.sources.map((source) => source.pr),
		[31, 32]
	);
	assert.deepEqual(productOnly.targets, ['main']);
	assert.deepEqual(
		productOnly.sources.map((source) => source.targets),
		[['main'], ['main']]
	);

	const mainOnly = canonicalFeatureStackPlanFromPullRequests({
		...common,
		targets: ['main'],
		pullRequests: [
			{
				number: 31,
				title: 'Main product',
				state: 'open',
				base: { ref: 'main' },
				head: { ref: 'feature/main-product', sha: 'e'.repeat(40), repo: { full_name: common.repository } }
			},
			{
				number: 32,
				title: 'Controller',
				state: 'open',
				base: { ref: 'github-actions' },
				head: { ref: 'feature/controller', sha: 'f'.repeat(40), repo: { full_name: common.repository } }
			}
		]
	});
	assert.deepEqual(
		mainOnly.sources.map((source) => source.pr),
		[31]
	);
	assert.deepEqual(mainOnly.targets, ['main']);

	assert.throws(
		() =>
			canonicalFeatureStackPlanFromPullRequests({
				...common,
				targets: ['github-actions'],
				sourcePrNumbers: [31],
				pullRequests: [
					{
						number: 31,
						title: 'Main product',
						state: 'open',
						base: { ref: 'main' },
						head: { ref: 'feature/main-product', sha: 'e'.repeat(40), repo: { full_name: common.repository } }
					}
				]
			}),
		/No selected pull request is compatible/
	);
});

test('saved Feature Stack runs omit completed and draft sources while preserving live order', () => {
	const repository = 'lopugit/thingtime';
	const plan = canonicalFeatureStackPlanFromPullRequests({
		name: 'Reusable stack',
		sourcePrNumbers: [40, 41, 42, 43],
		targets: ['main'],
		repository,
		stackId: 'ci-feature-stack-55555555-5555-4555-8555-555555555555',
		runId: 'feature-stack-run-55555555-5555-4555-8555-555555555555',
		autoDecideBranches: true,
		pullRequests: [
			{ number: 40, state: 'closed' },
			{
				number: 41,
				title: 'First live source',
				state: 'open',
				draft: false,
				base: { ref: 'develop' },
				head: { ref: 'feature/first', sha: '1'.repeat(40), repo: { full_name: repository } }
			},
			{
				number: 42,
				title: 'Draft source',
				state: 'open',
				draft: true,
				base: { ref: 'develop' },
				head: { ref: 'feature/draft', sha: '2'.repeat(40), repo: { full_name: repository } }
			},
			{
				number: 43,
				title: 'Second live source',
				state: 'open',
				draft: false,
				base: { ref: 'develop' },
				head: { ref: 'feature/second', sha: '3'.repeat(40), repo: { full_name: repository } }
			}
		]
	});
	assert.deepEqual(plan.sources.map((source) => source.pr), [41, 43]);
	assert.throws(
		() => canonicalFeatureStackPlanFromPullRequests({
			name: 'Completed stack',
			sourcePrNumbers: [40],
			targets: ['main'],
			repository,
			stackId: 'ci-feature-stack-55555555-5555-4555-8555-555555555555',
			runId: 'feature-stack-run-55555555-5555-4555-8555-555555555555',
			autoDecideBranches: true,
			pullRequests: [{ number: 40, state: 'closed' }]
		}),
		/No selected pull request is compatible/
	);
});

test('workflow dispatches enter only through reviewed product branches', () => {
  assert.equal(resolveCiWorkflowEntryRef('feature-stack'), 'develop');
  assert.equal(resolveCiWorkflowEntryRef('resolve-conflicts'), 'develop');
  assert.equal(resolveCiWorkflowEntryRef('rebase-stack', 'develop'), 'develop');
  assert.equal(resolveCiWorkflowEntryRef('promote-features'), 'develop');
  assert.equal(resolveCiWorkflowEntryRef('promote-develop'), 'develop');
  assert.equal(resolveCiWorkflowEntryRef('web-ci'), 'develop');
  assert.equal(resolveCiWorkflowEntryRef('sync-main'), 'main');
  assert.equal(resolveCiWorkflowEntryRef('electron-release', 'main'), 'main');
});

test('workflow dispatches reject arbitrary feature and control-plane refs', () => {
	assert.throws(() => resolveCiWorkflowEntryRef('resolve-conflicts', 'feature/unreviewed-listener'), /must enter through develop/);
	assert.throws(() => resolveCiWorkflowEntryRef('electron-release', 'develop'), /must enter through main/);
	assert.throws(() => resolveCiWorkflowEntryRef('web-ci', 'github-actions'), /must enter through develop/);
});

test('repository maintenance dispatches through the one Lopu manager', () => {
	const featureStackPlan = Buffer.from('{"autoMerge":true,"name":"Search + Messenger","sources":[],"targets":["develop"],"version":1}').toString(
		'base64'
	);
	assert.deepEqual(
		resolveCiWorkflowDispatch('feature-stack', {
    feature_stack_plan_b64: featureStackPlan,
			feature_stack_run_id: 'feature-stack-run-44444444-4444-4444-8444-444444444444',
    unexpected: 'discarded'
		}),
		{
    workflowFile: 'resolve-pr-conflicts.yml',
    inputs: {
      maintenance_operation: 'merge-feature-stack',
      feature_stack_plan_b64: featureStackPlan,
			feature_stack_run_id: 'feature-stack-run-44444444-4444-4444-8444-444444444444'
    }
		}
	);
	assert.deepEqual(
		resolveCiWorkflowDispatch('rebase-stack', {
    pr_number: 202,
    branch: 'feature/example',
    cascade: false,
    unexpected: 'discarded'
		}),
		{
    workflowFile: 'resolve-pr-conflicts.yml',
    inputs: {
      maintenance_operation: 'manage-prs',
      pr_number: '202',
      branch: 'feature/example',
      rebase_cascade: false
    }
		}
	);
	assert.deepEqual(
		resolveCiWorkflowDispatch('promote-features', {
    dry_run: true,
    lookback: 25
		}),
		{
    workflowFile: 'resolve-pr-conflicts.yml',
    inputs: {
      maintenance_operation: 'promote-features',
      promotion_dry_run: true,
      promotion_lookback: '25'
    }
		}
	);
  assert.deepEqual(resolveCiWorkflowDispatch('promote-develop'), {
    workflowFile: 'resolve-pr-conflicts.yml',
    inputs: { maintenance_operation: 'promote-develop' }
  });
  assert.deepEqual(resolveCiWorkflowDispatch('sync-main'), {
    workflowFile: 'resolve-pr-conflicts.yml',
    inputs: { maintenance_operation: 'sync-main-develop' }
  });
});
