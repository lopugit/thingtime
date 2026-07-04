export type DesignEntryKind = 'Launch' | 'Explorer' | 'App' | 'Direction';

export type DesignEntry = {
  slug: string;
  title: string;
  kind: DesignEntryKind;
  summary: string;
  notes: string;
};

export const DESIGN_ASSET_BASE = '/docs/design-bundles';

export const designKindColors: Record<DesignEntryKind, { bg: string; color: string }> = {
  Launch: { bg: '#d7f5df', color: '#0f5132' },
  Explorer: { bg: '#e8e9ff', color: '#2f356b' },
  App: { bg: '#fef3c7', color: '#78350f' },
  Direction: { bg: '#eef2f7', color: '#374151' }
};

export const designEntries: DesignEntry[] = [
  {
    slug: 'claude-design-mockup-v1',
    title: 'Claude design mockup v1',
    kind: 'Launch',
    summary: 'Launch page prototype with reader and developer modes.',
    notes: 'Includes the editable design source, questionnaire answers, and a self-contained preview bundle.'
  },
  {
    slug: 'thingtime-launch-celebration',
    title: 'Thingtime launch celebration',
    kind: 'Launch',
    summary: 'Launch-day celebration page with campaign calls to action.',
    notes: 'A compact standalone HTML bundle with confetti interaction.'
  },
  {
    slug: 'thingtime-directions',
    title: 'Thingtime directions',
    kind: 'Explorer',
    summary: 'Scrollable exploration canvas with eight landing-page directions.',
    notes: 'Anchors 1a through 1h are also split into individual standalone entries below.'
  },
  {
    slug: 'claude-design-mockup-v2-fable',
    title: 'Claude design mockup v2 fable',
    kind: 'Launch',
    summary: 'Built-out landing page with nav, hero, demo, use cases, ecosystem, and FAQ.',
    notes: 'Cross-links to the Thingtime app mockup entry.'
  },
  {
    slug: 'thingtime-app',
    title: 'Thingtime app',
    kind: 'App',
    summary: 'Thing editor app mockup with interactive path-bar commands.',
    notes: 'Cross-links back to the v2 fable landing page.'
  },
  {
    slug: 'thingtime-landing-1a-classic-centered',
    title: 'Landing 1A classic centered',
    kind: 'Direction',
    summary: 'Waitlist-first centered landing page with warm copy.',
    notes: 'Split from the directions canvas with the card width preserved.'
  },
  {
    slug: 'thingtime-landing-1b-product-split',
    title: 'Landing 1B product split',
    kind: 'Direction',
    summary: 'Product-led split layout where the demo is the hero.',
    notes: 'Split from the directions canvas with the card width preserved.'
  },
  {
    slug: 'thingtime-landing-1c-crowdfund-campaign',
    title: 'Landing 1C crowdfund campaign',
    kind: 'Direction',
    summary: 'Backers-first campaign direction with rallying copy.',
    notes: 'Split from the directions canvas with the card width preserved.'
  },
  {
    slug: 'thingtime-landing-1d-developer-first',
    title: 'Landing 1D developer first',
    kind: 'Direction',
    summary: 'Developer-first dark API hero with terse copy.',
    notes: 'Split from the directions canvas with the card width preserved.'
  },
  {
    slug: 'thingtime-landing-1e-typographic-story',
    title: 'Landing 1E typographic story',
    kind: 'Direction',
    summary: 'Use-case-led narrative direction built around typography.',
    notes: 'Split from the directions canvas with the card width preserved.'
  },
  {
    slug: 'thingtime-landing-1f-ecosystem-map',
    title: 'Landing 1F ecosystem map',
    kind: 'Direction',
    summary: 'Systems copy around one brain across every surface.',
    notes: 'Split from the directions canvas with the card width preserved.'
  },
  {
    slug: 'thingtime-landing-1g-magic-path-bar',
    title: 'Landing 1G magic path bar',
    kind: 'Direction',
    summary: 'Novel UX hero centered on the path bar interaction.',
    notes: 'Split from the directions canvas with the card width preserved.'
  },
  {
    slug: 'thingtime-landing-1h-ultra-minimal-voxel',
    title: 'Landing 1H ultra-minimal voxel',
    kind: 'Direction',
    summary: 'Quiet minimal voxel direction with the lightest copy.',
    notes: 'Split from the directions canvas with the card width preserved.'
  }
];

export const getDesignEntryBySlug = (slug?: string | null) =>
  designEntries.find((entry) => entry.slug === slug);

export const getDesignEntryPreviewSrc = (entry: DesignEntry) =>
  `${DESIGN_ASSET_BASE}/${entry.slug}/index.html`;
