import { apiEndpointDocs, type ApiEndpointDoc } from '~/docs/apiDocs';
import { thingtimeSchemas } from '~/schemas/registry';

import { designEntries } from './designEntries';
import { designSystemEntries } from './design-system/entries';
import { conceptEntries } from './concepts/entries';
import { embedGuideSections } from './embedSections';
import { mcpDemoScenarios } from './mcpDemoCore';

// The /docs drawer search index. Everything registry-backed (API endpoints,
// schemas, mockups, components, concepts) is derived from the live registries,
// so those stay in sync automatically — including the embed guide's section
// spine, shared with the page via embedSections.ts. Only the handwritten
// Overview page carries a static digest of its on-page copy below — update it
// when that page's sections change.

export type DocsSearchArea = 'Page' | 'Guide' | 'API' | 'Schema' | 'Mockup' | 'Component' | 'Concept';

export type DocsSearchDoc = {
  id: string;
  area: DocsSearchArea;
  title: string;
  // mono subtitle shown under the title: endpoint, slug, or route
  meta: string;
  description: string;
  sectionTitles: string[];
  content: string;
  to: string;
};

export type DocsSearchSnippet = {
  field: 'section' | 'description' | 'content';
  text: string;
};

export type DocsSearchResult = {
  doc: DocsSearchDoc;
  score: number;
  snippet: DocsSearchSnippet;
};

export const docsSearchAreaColors: Record<DocsSearchArea, { bg: string; color: string }> = {
  Page: { bg: '#eef2f7', color: '#374151' },
  Guide: { bg: '#fde2f1', color: '#8a2f61' },
  API: { bg: 'var(--tt-docs-accent-soft, #d7f5df)', color: 'var(--tt-docs-accent-ink, #0f5132)' },
  Schema: { bg: '#e8e9ff', color: '#2f356b' },
  Mockup: { bg: '#fef3c7', color: '#78350f' },
  Component: { bg: '#e8e9ff', color: '#2f356b' },
  Concept: { bg: '#fde2f1', color: '#8a2f61' }
};

// --- Handwritten page digests ----------------------------------------------

// Section ids must match the card ids rendered by routes/docs/index.tsx.
const overviewSections = [
  {
    title: 'Limitless MCP Lab',
    content:
      'Explore the live MCP contract through five composable workflows and the exact shipped review App ' +
      'using synthetic non-mutating preview data.'
  },
  {
    title: 'API reference',
    content:
      'Browse every Thingtime API endpoint with request steps, payload examples, response shapes, ' +
      'and curl, wget, Node.js, Python, and Ruby snippets generated from the live docs registry.'
  },
  {
    title: 'Thingtime Schemas',
    content:
      'Everything is a thing: the root Thing schema, crystal sub-schemas applied via the thingtime ' +
      'array, and every collection schema — fields tables, examples, and versions.'
  },
  {
    title: 'Design browser',
    content: 'Navigate the design exports, load each standalone HTML bundle, open multiple previews at once.'
  },
  {
    title: 'Design system',
    content:
      'Storybook-style component library: live stories, API reference, usage guidelines, ' +
      'accessibility notes, and theme tokens for Thingtime components.'
  },
  {
    title: 'Data viewer concepts',
    content:
      'Live interactive concepts for making nested data friendly — Focus cards, Finder-style ' +
      'columns, document and form views, an orbiting galaxy, the kind-renderer gallery, and the ' +
      'JSON-to-page pipeline.'
  },
  { title: 'Reference map', content: 'Every reference surface linked from one list.' }
];

// --- Index construction -----------------------------------------------------

const joinText = (parts: Array<string | undefined | null>) => parts.filter(Boolean).join(' ');

const apiDocContent = (doc: ApiEndpointDoc) =>
  joinText([
    doc.detail,
    doc.auth.description,
    doc.methods.join(' '),
    ...doc.steps,
    ...(doc.notes || []),
    ...doc.requestExamples.map((example) => `${example.name} ${example.description}`),
    ...doc.responseExamples.map((example) => example.description)
  ]);

const buildDocs = (): DocsSearchDoc[] => {
  const docs: DocsSearchDoc[] = [];

  docs.push(
    {
      id: 'page-overview',
      area: 'Page',
      title: 'Overview',
      meta: '/docs',
      description: 'Docs home — a browser documentation surface for product reference pages and design artifacts.',
      sectionTitles: overviewSections.map((section) => section.title),
      content: joinText(overviewSections.map((section) => section.content)),
      to: '/docs'
    },
    {
      id: 'page-mcp',
      area: 'Guide',
      title: 'Limitless MCP Lab',
      meta: '/docs/mcp',
      description: 'Live Thingtime MCP contract, composable use cases, and the embedded review UI.',
      sectionTitles: mcpDemoScenarios.map((scenario) => scenario.title),
      content: joinText(
        mcpDemoScenarios.flatMap((scenario) => [
          scenario.summary,
          scenario.prompt,
          scenario.result,
          ...scenario.steps.flatMap((step) => [step.title, step.detail, step.tool])
        ])
      ),
      to: '/docs/mcp'
    },
    {
      id: 'page-api',
      area: 'Page',
      title: 'API reference',
      meta: '/docs/api',
      description: `Endpoint docs — ${apiEndpointDocs.length} endpoints with JSON -docs routes.`,
      sectionTitles: [...new Set(apiEndpointDocs.map((doc) => doc.group))],
      content:
        'Request steps, payload examples, response shapes, and curl, wget, Node.js, Python, and Ruby ' +
        'snippets generated from the live docs registry. /api/docs returns the whole reference as Markdown.',
      to: '/docs/api'
    },
    {
      id: 'page-embed',
      area: 'Page',
      title: 'Login with Thingtime',
      meta: '/docs/embed',
      description: 'Embed SDK + SSO guide — add one button and Thingtime becomes the identity provider.',
      sectionTitles: embedGuideSections.map((section) => section.title),
      content:
        'Your platform gets a revocable, permission-scoped token to recognise the user, read the ' +
        'profile they chose to share, and store your app data in their Thingtime account. OAuth SSO ' +
        'login popup, sandbox tokens, permission scopes, app-data storage.',
      to: '/docs/embed'
    },
    {
      id: 'page-schemas',
      area: 'Page',
      title: 'Schemas',
      meta: '/docs/schemas',
      description: `Reference for every Thingtime Schema kind — ${thingtimeSchemas.length} schemas from the live registry.`,
      sectionTitles: ['Root schema', 'Crystal schemas', 'Collection schemas'],
      content:
        'The root Thing schema, crystal sub-schemas applied via the thingtime array, and collection ' +
        'schemas — fields tables, examples, and versions.',
      to: '/docs/schemas'
    },
    {
      id: 'page-design',
      area: 'Page',
      title: 'Design mockups',
      meta: '/docs/design',
      description: `Standalone previews — ${designEntries.length} self-contained design bundles.`,
      sectionTitles: [],
      content: 'Navigate the design exports, load each standalone HTML bundle, and open multiple previews at once.',
      to: '/docs/design'
    },
    {
      id: 'page-design-system',
      area: 'Page',
      title: 'Design system',
      meta: '/docs/design-system',
      description: 'Component library — storybook-style entries for Thingtime components.',
      sectionTitles: designSystemEntries.map((entry) => entry.title),
      content: 'Live stories, API reference, usage guidelines, accessibility notes, and theme tokens.',
      to: '/docs/design-system'
    },
    {
      id: 'page-concepts',
      area: 'Page',
      title: 'Data viewer concepts',
      meta: '/docs/concepts',
      description: `Nested viewers + kind renderers — ${conceptEntries.length} live concepts.`,
      sectionTitles: conceptEntries.map((entry) => entry.title),
      content:
        'Alternative nested data viewer and editor concepts, each running the real components with ' +
        'desktop and phone frames.',
      to: '/docs/concepts'
    }
  );

  for (const section of embedGuideSections) {
    docs.push({
      id: `embed-${section.id}`,
      area: 'Guide',
      title: section.title,
      meta: `/docs/embed#${section.id}`,
      description: 'Login with Thingtime — embed SDK + SSO guide.',
      sectionTitles: [],
      content: section.blurb,
      to: `/docs/embed#${section.id}`
    });
  }

  for (const doc of apiEndpointDocs) {
    docs.push({
      id: `api-${doc.id}`,
      area: 'API',
      title: doc.title,
      meta: `${doc.methods.join('/')} ${doc.endpoint}`,
      description: doc.summary,
      sectionTitles: doc.requestExamples.map((example) => example.name),
      content: apiDocContent(doc),
      to: `/docs/api/${doc.group}/${doc.id}`
    });
  }

  for (const schema of thingtimeSchemas) {
    docs.push({
      id: `schema-${schema.id}`,
      area: 'Schema',
      title: schema.title,
      meta: `${schema.kind} schema · ${schema.id}`,
      description: schema.summary,
      sectionTitles: schema.fields.map((field) => field.name),
      content: joinText([
        schema.detail,
        ...schema.fields.map((field) =>
          joinText([field.name, field.type, field.description, ...(field.values || [])])
        )
      ]),
      to: `/docs/schemas#schema-${schema.id}`
    });
  }

  for (const entry of designEntries) {
    docs.push({
      id: `design-${entry.slug}`,
      area: 'Mockup',
      title: entry.title,
      meta: entry.slug,
      description: entry.summary,
      sectionTitles: [],
      content: joinText([entry.kind, entry.notes]),
      to: `/docs/design?entry=${encodeURIComponent(entry.slug)}`
    });
  }

  for (const entry of designSystemEntries) {
    docs.push({
      id: `component-${entry.slug}`,
      area: 'Component',
      title: entry.title,
      meta: entry.slug,
      description: entry.summary,
      sectionTitles: entry.propTables.map((table) => table.title),
      content: joinText([
        entry.notes,
        ...entry.anatomy,
        entry.guidelines.intro,
        ...entry.guidelines.dos,
        ...entry.guidelines.donts,
        ...entry.accessibility,
        ...entry.propTables.flatMap((table) => table.rows.map((row) => `${row.name} ${row.description}`)),
        ...entry.tokens.map((token) => `${token.token} ${token.usedFor}`),
        ...entry.adoption
      ]),
      to: `/docs/design-system?component=${encodeURIComponent(entry.slug)}`
    });
  }

  for (const entry of conceptEntries) {
    docs.push({
      id: `concept-${entry.slug}`,
      area: 'Concept',
      title: `${entry.emoji} ${entry.title}`,
      meta: entry.slug,
      description: entry.summary,
      sectionTitles: [],
      content: joinText([
        entry.why,
        ...entry.desktop,
        ...entry.mobile,
        ...entry.editing,
        entry.adoption,
        entry.source
      ]),
      to: `/docs/concepts?concept=${encodeURIComponent(entry.slug)}`
    });
  }

  return docs;
};

type IndexedDoc = {
  doc: DocsSearchDoc;
  titleLower: string;
  metaLower: string;
  descriptionLower: string;
  sectionTitlesLower: string[];
  contentLower: string;
};

const indexedDocs: IndexedDoc[] = buildDocs().map((doc) => ({
  doc,
  titleLower: doc.title.toLowerCase(),
  metaLower: doc.meta.toLowerCase(),
  descriptionLower: doc.description.toLowerCase(),
  sectionTitlesLower: doc.sectionTitles.map((title) => title.toLowerCase()),
  contentLower: doc.content.toLowerCase()
}));

// --- Ranking ----------------------------------------------------------------

// Field weights, strongest first: title, section titles, meta (endpoint/slug),
// description, then content. Every query term must land somewhere (AND), with
// a phrase bonus when the whole query appears verbatim.

export const tokenizeDocsQuery = (rawQuery: string): string[] =>
  rawQuery.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const wordStartPattern = (term: string) => new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(term)}`);

const countOccurrences = (text: string, term: string) => {
  let count = 0;
  let cursor = text.indexOf(term);

  while (cursor !== -1 && count < 5) {
    count += 1;
    cursor = text.indexOf(term, cursor + term.length);
  }

  return count;
};

const scoreTitleLike = (text: string, term: string, wordStart: RegExp, weights: [number, number, number, number]) => {
  if (text === term) return weights[0];
  if (text.startsWith(term)) return weights[1];
  if (wordStart.test(text)) return weights[2];
  if (text.includes(term)) return weights[3];
  return 0;
};

const excerptAround = (text: string, matchIndex: number, matchLength: number) => {
  const radius = 56;
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(text.length, matchIndex + matchLength + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';

  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
};

const buildSnippet = (indexed: IndexedDoc, terms: string[]): DocsSearchSnippet => {
  const sectionIndex = indexed.sectionTitlesLower.findIndex((section) =>
    terms.some((term) => section.includes(term))
  );

  if (sectionIndex !== -1) {
    return { field: 'section', text: indexed.doc.sectionTitles[sectionIndex] };
  }

  if (terms.some((term) => indexed.descriptionLower.includes(term))) {
    return { field: 'description', text: indexed.doc.description };
  }

  for (const term of terms) {
    const matchIndex = indexed.contentLower.indexOf(term);

    if (matchIndex !== -1) {
      return { field: 'content', text: excerptAround(indexed.doc.content, matchIndex, term.length) };
    }
  }

  return { field: 'description', text: indexed.doc.description };
};

export const searchDocsIndex = (rawQuery: string, limit = 12): DocsSearchResult[] => {
  const terms = tokenizeDocsQuery(rawQuery);

  if (terms.length === 0) {
    return [];
  }

  const phrase = terms.length > 1 ? terms.join(' ') : null;
  const results: DocsSearchResult[] = [];

  for (const indexed of indexedDocs) {
    let score = 0;
    let matchedEveryTerm = true;

    for (const term of terms) {
      const wordStart = wordStartPattern(term);
      let best = scoreTitleLike(indexed.titleLower, term, wordStart, [140, 110, 90, 70]);

      for (const section of indexed.sectionTitlesLower) {
        best = Math.max(best, scoreTitleLike(section, term, wordStart, [85, 65, 55, 45]));
      }

      if (indexed.metaLower.includes(term)) {
        best = Math.max(best, wordStart.test(indexed.metaLower) ? 60 : 40);
      }

      if (indexed.descriptionLower.includes(term)) {
        best = Math.max(best, wordStart.test(indexed.descriptionLower) ? 40 : 28);
      }

      if (indexed.contentLower.includes(term)) {
        const base = wordStart.test(indexed.contentLower) ? 18 : 10;
        best = Math.max(best, base + countOccurrences(indexed.contentLower, term) * 2);
      }

      if (best === 0) {
        matchedEveryTerm = false;
        break;
      }

      score += best;
    }

    if (!matchedEveryTerm) {
      continue;
    }

    if (phrase) {
      if (indexed.titleLower.includes(phrase)) score += 100;
      else if (indexed.sectionTitlesLower.some((section) => section.includes(phrase))) score += 50;
      else if (indexed.descriptionLower.includes(phrase)) score += 30;
      else if (indexed.contentLower.includes(phrase)) score += 15;
    }

    results.push({ doc: indexed.doc, score, snippet: buildSnippet(indexed, terms) });
  }

  return results
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.doc.title.length - b.doc.title.length ||
        a.doc.title.localeCompare(b.doc.title)
    )
    .slice(0, limit);
};
