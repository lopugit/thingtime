import assert from 'node:assert/strict';
import test from 'node:test';
import { connectionBrand } from '~/connections/providerIcons';
import { createProviderIconCache } from './providerIcons';
import { declaredBrandImages, resolvePublicPageIcon } from '../passwords/websiteIcons';

const docsMark = 'https://www.gstatic.com/images/branding/productlogos/docs_2026/v2/web/192px.svg';

test('only fixed provider brands resolve, and aliases share in-flight, positive and failed probes', async () => {
  for (const id of ['https://localhost/', 'https://user:password@example.com', '__proto__', 'constructor', 'mastodon.example', 'rss', 'demo']) {
    assert.equal(connectionBrand(id), undefined);
  }
  assert.notEqual(connectionBrand('google-docs')?.site, connectionBrand('google-sheets')?.site);
  let clock = 0, calls = 0;
  const image = Buffer.from('cached image');
  const icon = createProviderIconCache(async brand => {
    calls++;
    if (calls > 1) throw new Error('provider unavailable');
    assert.equal(brand.id, 'facebook');
    assert.equal(brand.site, 'https://www.facebook.com/');
    return image;
  }, () => clock);
  assert.equal(await icon('https://127.0.0.1/'), null);
  assert.deepEqual(await Promise.all([icon('facebook-account'), icon('facebook')]), [image, image]);
  assert.equal(calls, 1);
  assert.equal(await icon('instagram'), null);
  clock = 10;
  assert.equal(await icon('instagram'), null);
  assert.equal(calls, 2);
  clock += 24 * 60 * 60 * 1000;
  assert.equal(await icon('facebook'), image);
  assert.equal(await icon('facebook-account'), image);
  assert.equal(calls, 3);
});

test('product metadata selects only official image sources and rejects a non-image response before decoding', async () => {
  const html = `<img src="${docsMark}"><img src="${docsMark}"><img src="${docsMark.replace('gstatic.com','example.com')}">
    <img src="${docsMark.replace('docs_', 'sheets_')}"><link rel="icon" href="/google.png">`;
  const discover = (markup: string) => declaredBrandImages(markup, url => url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/images/branding/productlogos/docs_'));
  assert.deepEqual(discover(html), [docsMark]);
  const seen: string[] = [];
  const page = 'https://workspace.google.com/products/docs/';
  const icon = await resolvePublicPageIcon(page, new AbortController().signal, {
    discover, useOriginFavicon: false,
    acceptedImageType: type => type === 'image/svg+xml',
    deps: {
      fetch: async url => {
        seen.push(url);
        return { status: 200, type: 'text/html', url, bytes: Buffer.from(html) };
      },
      decode: async () => assert.fail('HTML must never reach the decoder'),
    },
  });
  assert.equal(icon, null);
  assert.deepEqual(seen, [page, docsMark]);
});
