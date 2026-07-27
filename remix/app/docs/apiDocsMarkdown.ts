import { apiEndpointDocs, buildPlatformExamples } from './apiDocs';
import type { ApiEndpointDoc } from './apiDocs';

// Render the whole API doc catalog (docs/apiDocs.ts — the same single source
// of truth behind /docs/api and every <endpoint>-docs JSON route) as one
// Markdown document, served by GET /api/docs. Written for a reader with no
// other context — an AI that found "/api/docs" in a route list should be able
// to integrate from this file alone.

const fence = (value: unknown) =>
  value === undefined ? '' : '```json\n' + JSON.stringify(value, null, 2) + '\n```\n';

const anchor = (doc: ApiEndpointDoc) => doc.id;

const renderEndpoint = (doc: ApiEndpointDoc, origin: string): string => {
  const lines: string[] = [];
  lines.push(`### ${doc.title}\n`);
  lines.push(`\`${doc.methods.join(' | ')} ${doc.endpoint}\`\n`);
  lines.push(`${doc.summary}\n`);
  lines.push(`**Auth:** ${doc.auth.mode} — ${doc.auth.description}\n`);
  lines.push(`${doc.detail}\n`);

  if (doc.steps.length) {
    lines.push('**Steps:**\n');
    for (const step of doc.steps) lines.push(`1. ${step}`);
    lines.push('');
  }

  for (const example of doc.requestExamples) {
    lines.push(`**Request — ${example.name}:** ${example.description}\n`);
    const query = Object.entries(example.query || {})
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
    lines.push(`\`${example.method} ${doc.endpoint}${query ? `?${query}` : ''}\``);
    if (example.body !== undefined) lines.push(fence(example.body));
    lines.push('');
  }

  for (const example of doc.responseExamples) {
    lines.push(`**Response ${example.status}:** ${example.description}\n`);
    if (example.body !== undefined) lines.push(fence(example.body));
  }

  if (doc.notes?.length) {
    lines.push('**Notes:**\n');
    for (const note of doc.notes) lines.push(`- ${note}`);
    lines.push('');
  }

  lines.push('**curl:**\n');
  lines.push('```shell\n' + buildPlatformExamples(doc, origin).curl + '\n```\n');
  lines.push(`Machine-readable version: \`GET ${doc.docsEndpoint}\`\n`);

  return lines.join('\n');
};

const groupOrder = (docs: ApiEndpointDoc[]): Array<{ group: string; docs: ApiEndpointDoc[] }> => {
  const groups: Array<{ group: string; docs: ApiEndpointDoc[] }> = [];
  for (const doc of docs) {
    const existing = groups.find((entry) => entry.group === doc.group);
    if (existing) existing.docs.push(doc);
    else groups.push({ group: doc.group, docs: [doc] });
  }
  return groups;
};

export const renderApiDocsMarkdown = (origin = 'https://thingtime.com'): string => {
  const groups = groupOrder(apiEndpointDocs);
  const lines: string[] = [];

  lines.push('# Thingtime API reference\n');
  lines.push(
    `Every Thingtime API endpoint, in one Markdown document. Generated from the same catalog that powers ` +
      `the browser docs at ${origin}/docs/api — each endpoint below also serves its own JSON doc at ` +
      `\`<endpoint>-docs\` (e.g. \`GET /api/v1/things-docs\`).\n`
  );
  lines.push(
    '**Auth in one line:** browser sessions ride an httpOnly cookie (login via `POST /api/v1/login`); API ' +
      'clients send `Authorization: Bearer <token>`; embedded apps ("Login with Thingtime", the `embed` ' +
      'group) use app-scoped Bearer tokens minted by the consent popup — see `/api/v1/oauth/authorize`.\n'
  );

  lines.push('## Contents\n');
  for (const { group, docs } of groups) {
    lines.push(`- **${group}**: ${docs.map((doc) => `[${doc.endpoint}](#${anchor(doc)})`).join(' · ')}`);
  }
  lines.push('');

  for (const { group, docs } of groups) {
    lines.push(`## ${group}\n`);
    for (const doc of docs) {
      lines.push(`<a id="${anchor(doc)}"></a>\n`);
      lines.push(renderEndpoint(doc, origin));
      lines.push('---\n');
    }
  }

  return lines.join('\n');
};
