/** Synthetic transport only; never contacts a production API or creates real data. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ThingtimeProvider } from '../app/Providers/ThingtimeProvider';
import { CurrentPageBuilderFixture } from './lib/CurrentPageBuilderFixture';
import { PlatformReportingSettings } from '../app/components/Admin/PlatformReportingSettings';
import { JobScheduleSettings } from '../app/components/Admin/JobScheduleSettings';
import { SCHEDULED_HTTP_JOBS, defaultPolicy } from '../app/api/utils/automation/scheduledJobs';
import { rootIdentity } from '../app/utils/rootIdentity';
const owner = { id: 'synthetic-admin', username: 'synthetic-admin', isAdmin: true, accountKind: 'user', temporary: false };
const jobs = SCHEDULED_HTTP_JOBS.map(defaultPolicy);
const groups = [{ id: 'synthetic-group', name: 'Synthetic administrators' }];
let config: any = null, saves = 0, groupCreates = 0, reportingReads = 0, groupReads = 0, failGroup = false, delayProfile = false;
const layouts = new Map<string, any>();
const payload = () => ({ ok: true, status: config ? config.enabled ? 'enabled' : 'disabled' : 'unconfigured', config,
  owner: config ? { id: 'synthetic-platform-owner', username: 'thingtime' } : null,
  character: config ? { id: 'synthetic-platform-character', username: 'thingtime-platform' } : null,
  group: config ? groups.find(group => group.id === config.groupId) : null, lastReport: null });
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
  init?.signal?.throwIfAborted();
  if (url.origin !== location.origin) throw new Error('External requests are unavailable in this synthetic fixture.');
  if (url.pathname === '/.well-known/thingtime-capabilities.json') return Response.json({ schemaVersion: 1, origin: location.origin, features: Object.fromEntries(['api.admin-job-schedules', 'api.admin-platform-reporting', 'api.groups', 'api.users-profile', 'api.things', 'api.webpages-resolve', 'api.actions-run', 'api.mongodb-endpoint'].map(feature => [feature, { version: '1.99.0' }])) });
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  if (url.pathname === '/api/v1/admin/job-schedules') {
    if (body) {
      const row = jobs.find(job => job.id === body.id);
      if (!row || row.revision !== body.revision) return Response.json({ ok: false }, { status: 409 });
      Object.assign(row, body, { revision: crypto.randomUUID() });
    }
    return Response.json({ ok: true, jobs });
  }
  if (url.pathname === '/api/v1/admin/platform-reporting') {
    reportingReads++;
    if (new Headers(init?.headers).get('X-Thingtime-Expected-Actor') !== owner.id) return Response.json({ ok: false, error: 'Wrong expected actor' }, { status: 409 });
    if (body) { saves++; config = { ...body, updatedBy: owner.id, revision: `synthetic-revision-${saves}` }; }
    return Response.json(payload());
  }
  if (url.pathname === '/api/v1/groups') {
    groupReads++;
    if (body) {
      groupCreates++;
      const group = { id: `synthetic-group-${groupCreates}`, name: body.name }; groups.push(group);
      if (failGroup) { failGroup = false; throw new Error('Synthetic response lost after creation'); }
      return Response.json({ ok: true, group }, { status: 201 });
    }
    return Response.json({ ok: true, groups });
  }
  if (url.pathname === '/api/v1/users/profile') {
    if (delayProfile) await new Promise(resolve => setTimeout(resolve, 250));
    init?.signal?.throwIfAborted();
    const username = url.searchParams.get('username');
    return Response.json({ ok: true, profile: { id: username === 'thingtime' ? 'synthetic-platform-owner' : 'synthetic-platform-character', username } });
  }
  if (url.pathname === '/api/v1/webpages/resolve') {
    const page = layouts.get(url.searchParams.get('id') || '');
    return page ? Response.json({ ok: true, source: 'user', page, components: [], refs: {} }) : Response.json({ ok: false }, { status: 404 });
  }
  if (url.pathname === '/api/v1/things' && body) {
    const page = { id: body.id || body.shareId, author: { id: owner.id }, crystal: structuredClone(body.crystal), updatedAt: new Date().toISOString() };
    layouts.set(body.crystal.pageKey, page); return Response.json({ ok: true, thing: page });
  }
  return Response.json({ ok: false, error: 'Unsupported synthetic request' }, { status: 404 });
};
(window as any).platformReportingFixture = {
  snapshot: () => ({ saves, groupCreates, reportingReads, groupReads, config, groups }),
  failNextGroup: () => { failGroup = true; },
  externalChange: () => { config = { ...config, revision: 'external-revision', enabled: !config.enabled }; },
  holdProfiles: () => { delayProfile = true; },
  invalidate: () => rootIdentity.changed(),
  confirm: () => rootIdentity.confirm(rootIdentity.read().generation)
};
const data = { user: owner, dataPlane: new URLSearchParams(location.search).has('custom') ? `custom-${'a'.repeat(64)}` : 'home' };
const router = createMemoryRouter([{ id: 'root', path: '*', element: <CurrentPageBuilderFixture><main style={{ maxWidth: 800, margin: 'auto', padding: 16 }}>{new URLSearchParams(location.search).has('jobs') ? <JobScheduleSettings /> : <PlatformReportingSettings />}</main></CurrentPageBuilderFixture>, loader: () => data }], { hydrationData: { loaderData: { root: data } } });
createRoot(document.getElementById('root')!).render(<ChakraProvider><ThingtimeProvider storageKey="synthetic-platform-reporting" persistLocal={false} exposeGlobals={false}><RouterProvider router={router} /></ThingtimeProvider></ChakraProvider>);
