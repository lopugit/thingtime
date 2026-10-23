export const ADMIN_TABS = [
  { slug: 'users', label: 'Users' },
  { slug: 'apps', label: 'Apps' },
  { slug: 'moderation', label: 'Moderation' },
  { slug: 'tiers', label: 'Tiers' },
  { slug: 'ci-control', label: 'CI Control' },
  { slug: 'external-integrations', label: 'External integrations' },
  { slug: 'marketing', label: 'Marketing' },
  { slug: 'ai-providers', label: 'AI Providers' },
  { slug: 'lopu', label: 'Lopu' },
  { slug: 'platform', label: 'Platform' },
  { slug: 'access', label: 'Access & limits' }
] as const;

export type AdminTabSlug = (typeof ADMIN_TABS)[number]['slug'];

export const adminTabIndex = (slug: string | null | undefined, hash = ''): number | null => {
  if (!slug) return 0;
  if (slug === 'system') slug = hash.startsWith('#lopu') ? 'lopu' : 'ai-providers';
  const index = ADMIN_TABS.findIndex((tab) => tab.slug === slug);
  return index < 0 ? null : index;
};

export const adminTabPath = (index: number): string => {
  const tab = ADMIN_TABS[index] ?? ADMIN_TABS[0];
  return `/admin/${tab.slug}`;
};
