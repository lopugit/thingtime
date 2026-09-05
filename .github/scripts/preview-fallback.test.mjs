import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fallbackPage, fallbackResponseIssue, publishedPreviewResponseIssue, verifyPublishedPreview, fallbackDeploymentIssue, installFallbackAliases } from './preview-fallback.mjs';
const config = { repository: 'example/project', projectId: 'prj_example', suffixes: ['previews.dev.example.com', 'previews.example.com'] };
const page = fallbackPage(config);
const deployment = { id: 'dpl_fallback', projectId: config.projectId, target: null, readyState: 'READY',
  meta: { thingtimePreviewFallback: '1', thingtimePreviewFallbackContent: page.digest } };

test('static fallback uses a marked root soft-404, real nested 404s and no credential access', () => {
  assert.equal(page.output.version, 3);
  assert.deepEqual(page.output.routes.map(({src,dest,status}) => ({src,dest,status})), [
    {src:'/',dest:'/missing.html',status:200}, {src:'/(.*)',dest:'/missing.html',status:404}
  ]);
  const headers = page.headers;
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.match(headers['Content-Security-Policy'], /default-src 'none';.*script-src 'sha256-/);
  assert.doesNotMatch(page.html, /fetch\(|setInterval|setTimeout|VERCEL_|TOKEN|<iframe/);
  assert.equal(fallbackPage({...config,rootStatus:404}).output.routes[0].status,404);
  assert.throws(() => fallbackPage({...config,rootStatus:302}), /Invalid/);
  for (const suffixes of [['example.com', 'dev.example.com'], ['previews.example.com', 'previews.example.com']]) {
    assert.throws(() => fallbackPage({ ...config, suffixes }), /Invalid/);
  }
  assert.throws(() => fallbackPage({ ...config, repository: 'evil/"><script>' }), /Invalid/);
});

test('page links only an exact preview hostname to its PR and retries only on a user click', () => {
  // Extract our generated inline-script fixture; this is not an HTML sanitizer.
  const scriptStart = page.html.indexOf('<script>');
  const scriptEnd = page.html.indexOf('</script>', scriptStart);
  assert.ok(scriptStart >= 0 && scriptEnd > scriptStart);
  const generatedScript = page.html.slice(scriptStart + '<script>'.length, scriptEnd);
  for (const [hostname, expected] of [['pr-596.previews.dev.example.com', '596'], ['pr-611.previews.example.com', '611'],
    ['pr-596.previews.dev.example.com.attacker.test', null], ['pr-0.previews.example.com', null], ['controller-fallback-probe.previews.example.com', null]]) {
    const elements = { context: {}, 'pull-request': {}, retry: { addEventListener: (name, fn) => { assert.equal(name, 'click'); elements.click = fn; } } };
    let reloads = 0;
    vm.runInNewContext(generatedScript, {
      window: { location: { hostname, reload: () => reloads++ } }, document: { getElementById: (id) => elements[id] }
    });
    assert.equal(elements['pull-request'].href, expected ? `https://github.com/example/project/pull/${expected}` : undefined);
    assert.equal(reloads, 0);
    elements.click();
    assert.equal(reloads, 1);
  }
});

test('a missing-build response or arbitrary 404 cannot be accepted as a published preview', () => {
  const response = { status: 404, headers: new Headers(page.headers) };
  assert.equal(fallbackResponseIssue(response, page.html), null);
  assert.equal(publishedPreviewResponseIssue(response), 'missing-build');
  assert.equal(publishedPreviewResponseIssue({ status: 404, headers: new Headers() }), 'http-404');
  assert.equal(fallbackResponseIssue({ ...response, status: 200 }, page.html), null);
  assert.equal(publishedPreviewResponseIssue({ ...response, status: 200 }), 'missing-build');
  assert.equal(fallbackResponseIssue({ ...response, status: 302 }, page.html), 'unexpected-status');
  assert.equal(fallbackResponseIssue(response, '<h1>Thingtime live site</h1>'), 'wrong-page');
  for (const status of [200, 302, 401, 403]) assert.equal(publishedPreviewResponseIssue({ status, headers: new Headers() }), null);
});

function fixture() {
  const domains = config.suffixes.map((suffix, index) => ({ name: `*.${suffix}`, projectId: config.projectId,
    verified: true, gitBranch: index === 0 ? 'develop' : null, customEnvironmentId: null }));
  const aliases = new Map(domains.map((domain) => [domain.name, { alias: domain.name, projectId: config.projectId, deploymentId: 'dpl_previous' }]));
  const writes = [];
  let loseResponse = false;
  const request = async (path, init = {}) => {
    if (init.method) writes.push({ path, ...init });
    let result;
    if (path.includes('/domains/')) {
      const domain = domains.find((entry) => entry.name === decodeURIComponent(path.split('/domains/')[1]));
      assert.ok(domain, 'only exact preview wildcards may change');
      if (init.method === 'PATCH') domain.gitBranch = init.body.gitBranch;
      result = domain;
    } else if (init.method === 'POST') {
      assert.equal(path, '/v2/deployments/dpl_fallback/aliases');
      const alias = aliases.get(init.body.alias);
      assert.ok(alias);
      alias.deploymentId = deployment.id;
      result = alias;
    } else result = aliases.get(decodeURIComponent(path.split('/aliases/')[1].split('?')[0]));
    if (init.method && loseResponse) { loseResponse = false; throw new Error('response lost'); }
    return structuredClone(result);
  };
  return { request, domains, aliases, writes, loseResponse: () => { loseResponse = true; } };
}

test('installation fences both wildcard targets before writes and refuses production/foreign deployments', async () => {
  const api = fixture();
  api.domains[1].projectId = 'prj_other';
  await assert.rejects(installFallbackAliases({ ...api, config, deployment, digest: page.digest }), /wrong-domain/);
  assert.equal(api.writes.length, 0);
  assert.equal(fallbackDeploymentIssue({ ...deployment, target: 'production' }, config, page.digest), 'not-safe-ready-preview');
  assert.equal(fallbackDeploymentIssue({ ...deployment, meta: {} }, config, page.digest), 'wrong-content');
});

test('wildcard installation reconciles uncertain writes and reruns as a read-only no-op', async () => {
  const api = fixture();
  api.loseResponse();
  await installFallbackAliases({ ...api, config, deployment, digest: page.digest });
  assert.equal(api.writes.length, 4);
  assert.ok(api.domains.every((domain) => domain.gitBranch === 'github-actions'));
  await installFallbackAliases({ ...api, config, deployment, digest: page.digest });
  assert.equal(api.writes.length, 4);
  assert.ok([...api.aliases.values()].every((alias) => alias.deploymentId === deployment.id));
});

test('publisher HTTP probe tolerates propagation briefly but never accepts the missing page', async () => {
  let calls = 0;
  await verifyPublishedPreview('https://pr-596.previews.dev.example.com', { pause: async () => {}, fetcher: async () => {
    calls++; return { status: calls < 2 ? 404 : 200, headers: new Headers() };
  } });
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(verifyPublishedPreview('https://pr-596.previews.dev.example.com', { pause: async () => {}, fetcher: async () => {
    calls++; return { status: 404, headers: new Headers(page.headers) };
  } }), /missing-build/);
  assert.equal(calls, 5);
});
