import { connectionBrand } from '~/connections/providerIcons';
import { declaredBrandImages, declaredWebsiteIcons, resolvePublicPageIcon } from '../passwords/websiteIcons';

const goodFor = 24 * 60 * 60 * 1000;
const retryAfter = 5 * 60 * 1000;
const knownImageTypes = new Set(['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']);

const resolveProviderIcon = (brand: NonNullable<ReturnType<typeof connectionBrand>>) => {
  const product = brand.workspaceProduct;
  return resolvePublicPageIcon(brand.site, AbortSignal.timeout(6500), {
    // Workspace's rel=icon is the same Google mark on every product page.
    ...(brand.publishedIcon && {
      publishedIcon: brand.publishedIcon,
      useOriginFavicon: false,
      discover: (html: string, base: string) => new URL(base).origin === new URL(brand.site).origin ? declaredWebsiteIcons(html, base) : [],
    }),
    ...(product && {
      useOriginFavicon: false,
      discover: (html: string) => declaredBrandImages(html, url => url.origin === 'https://www.gstatic.com' &&
        url.pathname.startsWith(`/images/branding/productlogos/${product}_`) && /\.(?:svg|png)$/.test(url.pathname)),
    }),
    acceptedImageType: type => knownImageTypes.has(type),
  });
};

export function createProviderIconCache(resolve = resolveProviderIcon, now = Date.now) {
  const cache = new Map<string, { image: Buffer | null; expires: number; pending?: Promise<Buffer | null> }>();
  return async (provider: string) => {
    const brand = connectionBrand(provider);
    if (!brand) return null;
    const entry = cache.get(brand.id) ?? { image: null, expires: 0 };
    if (entry.pending) return entry.pending;
    if (entry.expires > now()) return entry.image;
    entry.pending = Promise.resolve().then(() => resolve(brand)).catch(() => null).then(image => {
      // Preserve the last known brand during an upstream outage.
      if (image) entry.image = image;
      entry.expires = now() + (image ? goodFor : retryAfter);
      entry.pending = undefined;
      return entry.image;
    });
    cache.set(brand.id, entry);
    return entry.pending;
  };
}

export const loadProviderIcon = createProviderIconCache();
