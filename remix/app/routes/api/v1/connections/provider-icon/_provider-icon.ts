import { connectionBrand } from '~/connections/providerIcons';
import { loadProviderIcon } from '~/api/utils/connections/providerIcons';

export const loader = async ({ request }: { request: Request }) => {
  const provider = new URL(request.url).searchParams.get('provider') || '';
  if (!connectionBrand(provider)) return new Response(null, { status: 404, headers: { 'Cache-Control': 'public, max-age=300' } });
  const png = await loadProviderIcon(provider);
  if (!png) return new Response(null, { status: 204, headers: { 'Cache-Control': 'public, max-age=300' } });
  return new Response(new Uint8Array(png), { headers: {
    'Content-Type': 'image/png',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
  } });
};
