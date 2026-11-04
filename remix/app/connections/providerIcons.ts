export const CONNECTION_ICON_FEATURE = 'api.connections-provider-icon';
export const CONNECTION_ICON_VERSION = '1.0.0';
export const CONNECTION_ICON_FALLBACK = '/connection-provider-fallback.svg';
export const CONNECTION_ICON_PATH = '/api/v1/connections/provider-icon';

type PublicBrand = { site: string; workspaceProduct?: string; publishedIcon?: string };
const workspace = (product: string): PublicBrand => ({ site: `https://workspace.google.com/products/${product}/`, workspaceProduct: product });
const brands = new Map<string, PublicBrand>(Object.entries({
  google: { site: 'https://www.google.com/' },
  'google-gmail': workspace('gmail'),
  'google-drive': workspace('drive'),
  'google-docs': workspace('docs'),
  'google-sheets': workspace('sheets'),
  'google-calendar': workspace('calendar'),
  'google-contacts': {
    site: 'https://contacts.google.com/',
    publishedIcon: 'https://www.gstatic.com/images/branding/product/2x/contacts_48dp.png',
  },
  facebook: { site: 'https://www.facebook.com/' },
  instagram: {
    site: 'https://www.instagram.com/',
    // Instagram publishes this icon in its public HTML, but some anonymous
    // requests get redirected to Facebook's unsupported-browser page.
    publishedIcon: 'https://static.cdninstagram.com/rsrc.php/yr/r/rzWiSjZRxk5.webp',
  },
  youtube: { site: 'https://www.youtube.com/' },
  reddit: { site: 'https://redditinc.com/' },
  mastodon: { site: 'https://joinmastodon.org/' },
  bluesky: { site: 'https://bsky.app/' },
  lemmy: { site: 'https://join-lemmy.org/' },
  github: { site: 'https://github.com/' },
  hackernews: { site: 'https://news.ycombinator.com/' },
  tiktok: { site: 'https://www.tiktok.com/' },
  spotify: { site: 'https://open.spotify.com/' },
  x: { site: 'https://x.com/' },
  twitch: { site: 'https://www.twitch.tv/' },
  tumblr: { site: 'https://www.tumblr.com/' },
  pinterest: { site: 'https://www.pinterest.com/' },
  linkedin: { site: 'https://www.linkedin.com/' },
}));

// Only built-in public sites participate. Never use a configured server,
// an OAuth URL, a connected account field, or a user-entered feed URL.
const sharedAccountBrands = new Set(['facebook-account', 'youtube-account', 'reddit-account', 'bluesky-account', 'mastodon-account']);

export const connectionBrand = (provider: string) => {
  const id = sharedAccountBrands.has(provider) ? provider.slice(0, -'-account'.length) : provider;
  const brand = brands.get(id);
  return brand ? { id, ...brand } : undefined;
};

export function connectionIconUrl(provider: string, enabled: boolean) {
  const brand = connectionBrand(provider);
  return enabled && brand ? `${CONNECTION_ICON_PATH}?${new URLSearchParams({ provider: brand.id })}` : CONNECTION_ICON_FALLBACK;
}
