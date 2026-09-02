import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { connectionProviderById, parseRssOrAtom, stripHtml } from './providers.ts';

// The RSS/Atom reader (providers.ts). Feed XML is ATTACKER-FETCHED: the RSS
// provider takes any https URL a signed-in user types, and Mastodon/Lemmy take
// any instance host, so the bytes parsed here are chosen by whoever owns that
// host — the same threat model the outbound-target guard and the response-size
// cap in outboundTarget.test.ts exist for.
//
// Those two bound what we CONNECT to and how much we READ. This file bounds
// what parsing COSTS. The scanning helpers were regex-based and backtracked
// from every occurrence of an opening tag whose closing tag never arrived, so
// cost grew with the SQUARE of the body: measured on the pre-fix code, 256KB of
// `<title>` took ~3.1s and the 3MB response cap extrapolated to ~7 minutes of
// blocked event loop — from one POST /api/v1/connections, on a bucket that
// allows 60 a minute. Node is single-threaded, so that is the whole deployment.
//
// The scaling assertions below are the real regression guard: a correctness-only
// test passes just as happily against a quadratic parser.

// --- behaviour ---------------------------------------------------------------

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
<title>Example Feed</title><link>https://example.com/</link>
<item><title>First</title><link>https://example.com/1</link><guid>g1</guid>
<description>&lt;p&gt;body one&lt;/p&gt;</description>
<enclosure url="https://example.com/a.jpg" type="image/jpeg"/>
<pubDate>Tue, 12 Aug 2025 10:00:00 GMT</pubDate></item>
<item><title>Second</title><link>https://example.com/2</link><guid>g2</guid>
<description><![CDATA[body two]]></description>
<dc:creator>Ada</dc:creator></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<title>Atom Feed</title>
<link rel="self" href="https://example.com/self"/>
<link rel="alternate" href="https://example.com/home"/>
<entry><id>tag:example,2025:1</id><title>Entry One</title>
<link href="https://example.com/e1"/>
<media:thumbnail url="https://example.com/t.jpg"/>
<summary>entry body</summary><name>Grace</name>
<published>2025-08-12T10:00:00Z</published></entry>
</feed>`;

test('parses an RSS channel, its items, and their metadata', () => {
  const feed = parseRssOrAtom(RSS);
  assert.ok(feed);
  assert.equal(feed.title, 'Example Feed');
  assert.equal(feed.link, 'https://example.com/');
  assert.equal(feed.items.length, 2);
  assert.equal(feed.items[0].externalId, 'g1');
  assert.equal(feed.items[0].title, 'First');
  assert.equal(feed.items[0].text, 'body one', 'double-escaped HTML unescapes then strips');
  assert.deepEqual(feed.items[0].images, ['https://example.com/a.jpg'], 'the image enclosure is selected by type');
  assert.equal(feed.items[1].text, 'body two', 'CDATA bodies unwrap');
  assert.equal(feed.items[1].author.name, 'Ada');
});

test('parses an Atom feed and prefers the alternate link', () => {
  const feed = parseRssOrAtom(ATOM);
  assert.ok(feed);
  assert.equal(feed.title, 'Atom Feed');
  // rel="self" comes FIRST in the document, so returning it would mean the
  // scanner is taking the first <link> rather than the one `where` selects
  assert.equal(feed.link, 'https://example.com/home');
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].externalId, 'tag:example,2025:1');
  assert.equal(feed.items[0].url, 'https://example.com/e1');
  assert.deepEqual(feed.items[0].images, ['https://example.com/t.jpg']);
  assert.equal(feed.items[0].author.name, 'Grace');
});

test('a tag name must end where it ends', () => {
  // `<titlepage>` is not `<title>`; matching on prefix would title the feed
  // "not the title" here
  const feed = parseRssOrAtom('<rss><channel><titlepage>not the title</titlepage><title>real</title></channel></rss>');
  assert.ok(feed);
  assert.equal(feed.title, 'real');
});

test('tag names match case-insensitively', () => {
  // Real feeds spell tags in mixed case and the scanners lowercase the
  // document to compare — so the NAME has to be lowered too. `pubDate` is the
  // one that bites: miss it and every RSS item silently loses its publish
  // time, which is what the feed sorts and cursors on, so posts would all land
  // at sync time instead of their own.
  const feed = parseRssOrAtom(
    '<RSS><CHANNEL><TITLE>Up</TITLE><LINK>https://up.test/</LINK>' +
      '<ITEM><GUID>g</GUID><TITLE>i</TITLE><pubDate>Tue, 12 Aug 2025 10:00:00 GMT</pubDate></ITEM></CHANNEL></RSS>'
  );
  assert.ok(feed);
  assert.equal(feed.title, 'Up');
  assert.equal(feed.items[0].publishedAt?.toISOString(), '2025-08-12T10:00:00.000Z');
});

test('an attribute must be its own attribute', () => {
  // `data-url="…"` must not answer a request for `url`
  const feed = parseRssOrAtom(
    '<rss><channel><item><guid>g</guid><media:thumbnail data-url="https://evil.test/x.jpg"/></item></channel></rss>'
  );
  assert.ok(feed);
  assert.deepEqual(feed.items[0].images, []);
});

test('a quoted attribute value may contain a raw >', () => {
  // XML only requires `<` and `&` to be escaped inside an attribute value, so
  // a raw `>` there is legal and must not be read as the end of the tag. The
  // scanner tracks quotes for this; ending the tag at the first raw `>` would
  // truncate it and silently drop the attribute.
  // Asserted on the entry permalink rather than an image: httpsImage
  // separately refuses `>` in an image URL, which would mask the parse.
  const feed = parseRssOrAtom(
    '<feed><title>T</title><entry><id>1</id><title>i</title><link href="https://t.test/1?a=1>2"/></entry></feed>'
  );
  assert.ok(feed);
  assert.equal(feed.items[0].url, 'https://t.test/1?a=1>2');
});

test('non-feed input is refused rather than half-parsed', () => {
  assert.equal(parseRssOrAtom('<html><body>hello</body></html>'), null);
});

test('stripHtml keeps text, drops markup, and survives unterminated tags', () => {
  assert.equal(stripHtml('<p>hello <b>world</b></p>'), 'hello world');
  assert.equal(stripHtml('<script>alert(1)</script>keep'), 'keep');
  assert.equal(stripHtml('a<>b'), 'a<>b', 'an empty tag has nothing to strip');
  assert.equal(stripHtml('a<b'), 'a<b', 'an unterminated tag stays literal text');
});

// --- cost --------------------------------------------------------------------
// Quadratic growth is the failure being guarded against, so each case measures
// two sizes and asserts on the RATIO. An absolute millisecond budget would
// either be flaky on a loaded CI runner or so loose it would pass against the
// original code; the ratio is what distinguishes O(n) from O(n²) and it is
// machine-independent.
//
// The step is 4×, and that matters. QUADRUPLING the input costs a linear
// scanner ~4× and a quadratic one ~16×, so a bar at 8× sits cleanly between the
// two. A 2× step would not: it separates 2× from only 4×, and the regex
// versions measured almost exactly 4× per doubling — a 2× step with a bar
// anywhere above 4 passes against the very code these tests exist to reject.

const elapsed = (fn: () => void): number => {
  const started = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - started) / 1e6;
};

// A floor keeps the ratio meaningful: sub-millisecond timings are dominated by
// scheduler noise, and dividing two of them proves nothing either way. It can
// only make the measured factor SMALLER, so it never manufactures a failure —
// on the fixed code both runs are fast and the ratio is uninformative but
// safely under the bar, while a quadratic implementation is far too slow at the
// large size for the floor to rescue it.
const STEP = 4;
const growthFactor = (run: (size: number) => void, small: number): number => {
  run(small); // warm the JIT so the first timed run is not the slow one
  const first = Math.max(elapsed(() => run(small)), 0.5);
  const second = elapsed(() => run(small * STEP));
  return second / first;
};

test('an unclosed tag does not make parsing quadratic', () => {
  // The exact shape that stalled: a body that opens <title> forever and never
  // closes it. The feed is otherwise well-formed enough to reach the parser.
  const hostile = (bytes: number) => `<?xml version="1.0"?><rss version="2.0"><channel>${'<title>'.repeat(Math.floor(bytes / 7))}`;
  const factor = growthFactor((size) => void parseRssOrAtom(hostile(size)), 64 * 1024);
  assert.ok(factor < 8, `4× the body must not cost 16× the work (grew ${factor.toFixed(1)}× for ${STEP}× input)`);
});

test('an unterminated tag does not make attribute lookup quadratic', () => {
  // Attribute lookup is the ATOM branch (feed link, entry link, media
  // thumbnail), so this body has to be Atom to reach it at all — an <rss> body
  // of the same shape never calls tagAttr and would pass against any
  // implementation. The tag is left open (`<link ` with no `>` anywhere) so
  // the old `[^>]*` ran to the end of the document and backtracked from every
  // occurrence.
  const hostile = (bytes: number) => `<?xml version="1.0"?><feed>${'<link '.repeat(Math.floor(bytes / 6))}`;
  const factor = growthFactor((size) => void parseRssOrAtom(hostile(size)), 64 * 1024);
  assert.ok(factor < 8, `attribute scanning must stay linear (grew ${factor.toFixed(1)}× for ${STEP}× input)`);
});

test('bare angle brackets do not make text stripping quadratic', () => {
  // stripHtml caps its own input at 100KB, but the cap alone did not save it:
  // 100KB of `<` measured ~8.4s before the fix, and a feed body can carry many
  // such fields.
  const factor = growthFactor((size) => void stripHtml('<'.repeat(size)), 12 * 1024);
  assert.ok(factor < 8, `tag stripping must stay linear (grew ${factor.toFixed(1)}× for ${STEP}× input)`);
});

test('a hostile feed body does not stall a connect request', () => {
  // End to end through the real provider — the path an attacker actually
  // drives: POST /api/v1/connections with a feedUrl they control.
  const rss: any = connectionProviderById('rss');
  const body = `<?xml version="1.0"?><rss version="2.0"><channel>${'<title>'.repeat(Math.floor((512 * 1024) / 7))}`;
  (globalThis as any).fetch = async () =>
    new Response(body, { status: 200, headers: { 'content-type': 'application/xml' } });
  return (async () => {
    const started = process.hrtime.bigint();
    await rss.resolveAccount({ feedUrl: 'https://example.com/feed.xml' });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    // 512KB took ~12s before the fix and is milliseconds after it. A whole
    // second is generous headroom for a loaded runner while still failing
    // loudly on any return to quadratic scanning.
    assert.ok(ms < 1000, `a 512KB hostile feed must not stall the request (took ${ms.toFixed(0)}ms)`);
  })();
});
