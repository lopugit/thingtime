import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Read-only release acceptance against Nitro or a deployed public origin.
// Pass specific public paths after the origin to override the default matrix; no cookies/credentials.
const origin = new URL(process.argv[2] || 'http://localhost:10000').origin;
const templates = ['editorial', 'colour-blocks', 'editorial-white', 'pink-invitation', 'night-garden'];
const layouts = ['auto', 'text', 'photo', 'gallery'];
const paths = process.argv.length > 3 ? process.argv.slice(3) : [
  '/', '/invite', '/feed', '/things', '/branding', '/settings', '/post/missing-social-smoke',
  ...templates.map((template) => `/invite?previewTheme=${template}&previewLayout=text&token=preview-smoke-secret#private-fragment`),
  ...layouts.map((layout) => `/feed?previewTheme=colour-blocks&previewLayout=${layout}`),
  '/invite?previewTheme=untrusted&previewLayout=%7Bquery.secret%7D'
];
const agents = ['Mozilla/5.0', 'facebookexternalhit/1.1', 'Mozilla/5.0 (compatible; Applebot/0.1)'];
const decode = (value) => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const checkedImages = new Set();
const themedImages = new Map();
const canonicalFor = (path) => {
  const target = new URL(path, origin);
  const canonical = new URL(target.pathname === '/index.html' ? '/' : target.pathname, origin);
  if (target.searchParams.getAll('previewTheme').length === 1 && templates.includes(target.searchParams.get('previewTheme'))) canonical.searchParams.set('previewTheme', target.searchParams.get('previewTheme'));
  if (target.searchParams.getAll('previewLayout').length === 1 && layouts.includes(target.searchParams.get('previewLayout'))) canonical.searchParams.set('previewLayout', target.searchParams.get('previewLayout'));
  return canonical;
};
const manifestResponse = await fetch(`${origin}/.well-known/thingtime-capabilities.json`, { signal: AbortSignal.timeout(25000) });
assert.equal(manifestResponse.status, 200, 'origin capability manifest');
const manifest = await manifestResponse.json();
assert.equal(manifest.origin, origin);
for (const [feature, expected] of [['api.social-previews', '1.2.0'], ['api.social-card', '1.4.0']]) {
  const declared = manifest.features[feature];
  const actual = typeof declared === 'string' ? declared : declared?.version;
  const [major, minor, patch] = String(actual).split('.').map(Number);
  const [requiredMajor, requiredMinor, requiredPatch] = expected.split('.').map(Number);
  assert.ok(major === requiredMajor && (minor > requiredMinor || (minor === requiredMinor && patch >= requiredPatch)), `${feature} requires compatible ${expected}, got ${actual}`);
}
for (const path of paths) {
  assert.ok(path.startsWith('/') && !path.startsWith('//') && !path.includes('\\'), 'Only local paths are accepted');
  const expectedCanonical = canonicalFor(path);
  let htmlImage;
  for (const agent of agents) {
    const response = await fetch(`${origin}${path}`, { headers: { 'User-Agent': agent }, signal: AbortSignal.timeout(25000) });
    assert.equal(response.status, 200, `${path} HTML`);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const html = await response.text();
    const tags = [...html.matchAll(/<meta (?:name|property)="([^"]+)" content="([^"]*)"\s*\/?\s*>/g)].map(([, key, value]) => [key, decode(value)]);
    const meta = new Map(tags);
    for (const key of ['og:image', 'og:url', 'og:title', 'description', 'robots']) assert.equal(tags.filter(([name]) => name === key).length, 1, `${path} unique ${key}`);
    assert.equal(decode(html.match(/<title>(.*?)<\/title>/s)[1]), meta.get('og:title'));
    const canonical = [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)];
    assert.equal(canonical.length, 1);
    assert.equal(decode(canonical[0][1]), meta.get('og:url'));
    assert.equal(meta.get('og:url'), expectedCanonical.href);
    assert.doesNotMatch(html, /preview-smoke-secret|private-fragment|query\.secret/);
    const schemas = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)];
    assert.equal(schemas.length, 1);
    const schema = JSON.parse(schemas[0][1]);
    assert.equal(schema['@context'], 'https://schema.org');
    assert.equal(schema['@graph'][1].url, meta.get('og:url'));
    assert.equal(meta.get('og:image'), meta.get('twitter:image'));
    assert.equal(meta.get('og:image:alt'), meta.get('twitter:image:alt'));
    assert.equal(meta.get('twitter:card'), 'summary_large_image');
    assert.equal(meta.get('og:image:width'), '1200');
    assert.equal(meta.get('og:image:height'), '630');
    if (['/invite', '/things', '/settings', '/post/missing-social-smoke'].includes(path)) {
      assert.match(meta.get('robots'), /noindex/);
      assert.equal(schema['@graph'][1].mainEntity, undefined);
    }
    if (new URL(path, origin).pathname === '/invite') {
      assert.equal(meta.get('og:title'), 'You’re invited to Thingtime');
      assert.equal(meta.get('og:description'), 'Make yourself at home.');
      const cardUrl = new URL(meta.get('og:image'));
      assert.equal(cardUrl.pathname, '/social-card');
      assert.equal(cardUrl.searchParams.get('path'), '/invite');
      assert.equal(cardUrl.searchParams.get('v'), 'invite-20261105');
      assert.equal(cardUrl.searchParams.get('r'), 'design-20261105');
      assert.match(meta.get('robots'), /noindex/);
      assert.equal(schema['@graph'][1].mainEntity, undefined);
    }
    const image = meta.get('og:image');
    htmlImage = image;
    assert.equal(new URL(image).origin, origin);
    const cardUrl = new URL(image);
    assert.equal(cardUrl.pathname, '/social-card', 'Every page, including home and fallback, uses the chosen dynamic renderer');
    assert.equal(cardUrl.searchParams.get('path'), expectedCanonical.pathname);
    assert.equal(cardUrl.searchParams.get('r'), 'design-20261105');
    for (const key of ['previewTheme', 'previewLayout']) assert.equal(cardUrl.searchParams.get(key), expectedCanonical.searchParams.get(key));
    assert.ok([...cardUrl.searchParams.keys()].every((key) => ['path', 'r', 'v', 'previewTheme', 'previewLayout'].includes(key)));
    const imageCheck = `${agent}|${image}`;
    if (!checkedImages.has(imageCheck)) {
      const pngResponse = await fetch(image, { headers: { 'User-Agent': agent }, signal: AbortSignal.timeout(25000) });
      assert.equal(pngResponse.status, 200, `${path} image`);
      assert.match(pngResponse.headers.get('content-type'), /^image\/png/);
      const png = Buffer.from(await pngResponse.arrayBuffer());
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(png.readUInt32BE(16), 1200);
      assert.equal(png.readUInt32BE(20), 630);
      assert.ok(png.length < 10 * 1024 * 1024);
      if (expectedCanonical.pathname === '/invite' && expectedCanonical.searchParams.get('previewLayout') === 'text') themedImages.set(expectedCanonical.searchParams.get('previewTheme'), createHash('sha256').update(png).digest('hex'));
      checkedImages.add(imageCheck);
    }
  }
  const metadataResponse = await fetch(`${origin}/api/v1/social-previews?path=${encodeURIComponent(path)}`, { signal: AbortSignal.timeout(25000) });
  assert.equal(metadataResponse.status, 200, `${path} JSON metadata`);
  const metadata = await metadataResponse.json();
  assert.equal(metadata.ok, true);
  assert.equal(metadata.url, expectedCanonical.href);
  assert.equal(metadata.image.url, htmlImage);
  assert.ok(templates.includes(metadata.design.template));
  assert.ok(['text', 'photo', 'gallery'].includes(metadata.design.layout));
  assert.deepEqual(metadata.choices.templates.map((choice) => choice.id), templates);
  assert.deepEqual(metadata.choices.layouts.map((choice) => choice.id), layouts);
  assert.doesNotMatch(JSON.stringify(metadata), /preview-smoke-secret|private-fragment|query\.secret/);
  console.log(`PASS ${path}: browser + Meta + Apple agent HTML, JSON-LD and PNG`);
}
if (themedImages.size === templates.length) assert.equal(new Set(themedImages.values()).size, templates.length, 'Every selected theme must reach the PNG renderer as a distinct design');
console.log(`Verified ${paths.length} paths, ${agents.length} user agents, ${checkedImages.size} image fetches at ${origin}`);
