#!/usr/bin/env node
// Owner-run one-shot: register the Thingtime deployment webhook with Vercel.
// Creating a webhook is a standing account configuration change, so it is NOT
// done automatically by any deploy/build step — run this once, deliberately.
//
// Usage:
//   VERCEL_API_TOKEN=... [VERCEL_TEAM_ID=team_...] [VERCEL_PROJECT_ID=prj_...] \
//     node remix/scripts/vercel/create-webhook.mjs https://<prod-host>/api/v1/vercel/webhook
//
// The response includes the webhook signing secret EXACTLY ONCE. Set it as
// VERCEL_WEBHOOK_SECRET in the Vercel project env (all environments that
// should record status) and redeploy. Until that env var exists the endpoint
// answers 404 and the footer keeps using API polling.

const DEFAULT_PROJECT_ID = 'prj_ZAX9FhGC2alHMXMwTHX96ql3EQ8v';
const DEFAULT_TEAM_ID = 'team_JsKhM6fVg9uo701feA0fLh9V';

const EVENTS = [
  'deployment.created',
  'deployment.succeeded',
  'deployment.promoted',
  'deployment.error',
  'deployment.canceled'
];

const main = async () => {
  const url = process.argv[2];
  const token = process.env.VERCEL_API_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID || DEFAULT_TEAM_ID;
  const projectId = process.env.VERCEL_PROJECT_ID || DEFAULT_PROJECT_ID;

  if (!url || !url.startsWith('https://')) {
    console.error('Usage: node create-webhook.mjs https://<host>/api/v1/vercel/webhook');
    process.exit(1);
  }
  if (!token) {
    console.error('VERCEL_API_TOKEN is required (do not paste it into chat/logs).');
    process.exit(1);
  }

  const endpoint = new URL('https://api.vercel.com/v1/webhooks');
  if (teamId) endpoint.searchParams.set('teamId', teamId);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ url, events: EVENTS, projectIds: [projectId] })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error(`Vercel API returned ${response.status}:`, JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log('Webhook created:');
  console.log(`  id:      ${data.id}`);
  console.log(`  url:     ${data.url}`);
  console.log(`  events:  ${(data.events || []).join(', ')}`);
  console.log('');
  console.log('Signing secret (shown by Vercel ONCE — set it now, never commit it):');
  console.log(`  VERCEL_WEBHOOK_SECRET=${data.secret}`);
  console.log('');
  console.log('Next: add VERCEL_WEBHOOK_SECRET to the Vercel project env and redeploy.');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
