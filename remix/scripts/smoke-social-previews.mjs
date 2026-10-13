import assert from 'node:assert/strict';

// Read-only release acceptance against Nitro or a deployed public origin.
// Pass specific public paths after the origin to override the default matrix; no cookies/credentials.
const origin = new URL(process.argv[2] || 'http://localhost:10000').origin;
const paths = process.argv.length > 3 ? process.argv.slice(3) : ['/', '/invite', '/feed', '/things', '/branding', '/settings', '/post/missing-social-smoke'];
const agents = ['Mozilla/5.0', 'facebookexternalhit/1.1', 'Mozilla/5.0 (compatible; Applebot/0.1)'];
const decode = (value) => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const checkedImages = new Set();
for (const path of paths) {
  assert.ok(path.startsWith('/') && !path.startsWith('//') && !path.includes('\\'), 'Only local paths are accepted');
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
    assert.equal(meta.get('og:url'), `${origin}${new URL(path, origin).pathname}`);
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
    const image = meta.get('og:image');
    assert.equal(new URL(image).origin, origin);
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
      checkedImages.add(imageCheck);
    }
  }
  console.log(`PASS ${path}: browser + Meta + Apple agent HTML, JSON-LD and PNG`);
}
console.log(`Verified ${paths.length} paths, ${agents.length} user agents, ${checkedImages.size} image fetches at ${origin}`);
