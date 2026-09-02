import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { connectionProviderById, webLink } from './providers.ts';

// The outbound-target guard (providers.ts). Feed sources are USER-SUPPLIED —
// the RSS provider takes any feedUrl, Mastodon/Lemmy take an instance hostname
// — so without this guard any signed-in account could aim the server at the
// deployment's own private network (cloud metadata, internal admin ports,
// databases) and read the answer back as feed content.
//
// The RSS provider is the sharpest expression of the rule (a whole URL, typed
// by the user), so it is what these tests drive. Every provider shares the
// same guarded fetch helpers underneath.
//
// `calls` is the real assertion: a refused target must never reach fetch() at
// all. Checking only the returned error would still pass if the request went
// out and we merely disliked the response.

const rss: any = connectionProviderById('rss');

let calls: string[] = [];
const stubFetch = (impl: (url: string) => Response) => {
  calls = [];
  (globalThis as any).fetch = async (url: unknown) => {
    calls.push(String(url));
    return impl(String(url));
  };
};

const RSS_BODY = `<?xml version="1.0"?><rss version="2.0"><channel><title>Example Feed</title>
<link>https://example.com/</link>
<item><title>Hello</title><link>https://example.com/1</link><guid>1</guid>
<description>body</description><pubDate>Tue, 12 Aug 2025 10:00:00 GMT</pubDate></item>
</channel></rss>`;

const feedResponse = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'application/xml' } });

// Spelling matters: WHATWG URL rewrites `[::ffff:127.0.0.1]` to `::ffff:7f00:1`
// and keeps the brackets on `hostname`, so a guard written against the typed
// form silently misses the address it was written to catch. Both shapes are
// covered here on purpose.
const BLOCKED_TARGETS: [string, string][] = [
  ['cloud metadata (link-local)', 'https://169.254.169.254/latest/meta-data/iam/security-credentials/'],
  ['loopback v4', 'https://127.0.0.1:9200/_cluster/health'],
  ['loopback v6', 'https://[::1]:8080/'],
  ['unspecified v6', 'https://[::]/'],
  ['ipv4-mapped v6, dotted', 'https://[::ffff:127.0.0.1]/'],
  ['ipv4-mapped v6, hex', 'https://[0:0:0:0:0:ffff:c0a8:0101]/'],
  ['ipv4-mapped v6, metadata', 'https://[::ffff:169.254.169.254]/'],
  ['private 10/8', 'https://10.0.0.5/admin'],
  ['private 172.16/12', 'https://172.20.1.1/'],
  ['private 192.168/16', 'https://192.168.1.1/'],
  ['carrier-grade NAT 100.64/10', 'https://100.64.0.1/'],
  ['this-network 0/8', 'https://0.0.0.0/'],
  ['unique-local fc00::/7', 'https://[fd12:3456::1]/'],
  ['link-local fe80::/10', 'https://[fe80::abcd]/'],
  ['multicast ff00::/8', 'https://[ff02::1]/'],
  ['localhost by name', 'https://localhost/feed.xml'],
  ['*.internal', 'https://db.internal/feed.xml'],
  ['*.local', 'https://printer.local/feed.xml'],
  ['plaintext http', 'http://example.com/feed.xml']
];

for (const [label, feedUrl] of BLOCKED_TARGETS) {
  test(`refuses ${label}`, async () => {
    stubFetch(() => feedResponse(RSS_BODY));
    const result = await rss.resolveAccount({ feedUrl });
    assert.equal(result.ok, false, `${feedUrl} must be refused`);
    assert.deepEqual(calls, [], `${feedUrl} must never reach fetch()`);
  });
}

test('a public host cannot redirect the fetch into private space', async () => {
  // Exact match, not a prefix: only the first hop is a legitimate fetch here,
  // so anything else must fall to the INTERNAL-ONLY branch the assertions
  // below are looking for. A `startsWith` prefix would also swallow
  // `https://example.com.attacker.test/…`, quietly weakening the test (and
  // reading as URL sanitization to a scanner that cannot tell a stub from a
  // guard) — the sibling redirect test below matches exactly for the same reason.
  stubFetch((url) =>
    url === 'https://example.com/feed.xml'
      ? new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data/' } })
      : feedResponse('INTERNAL-ONLY-BODY')
  );
  const result = await rss.resolveAccount({ feedUrl: 'https://example.com/feed.xml' });
  assert.equal(result.ok, false, 'a redirect into link-local space must be refused');
  assert.deepEqual(calls, ['https://example.com/feed.xml'], 'only the first public hop may be fetched');
});

// --- credentials across a redirect -------------------------------------------
// Redirects are walked by hand here, so the credential-stripping `fetch` does
// for free on `redirect: 'follow'` has to be done by hand too. Every
// token-bearing call in providers.ts is a GET, which is precisely the case
// that DOES follow a redirect — so without this, one 302 out of a provider
// (an open redirect on its own domain, a hijacked API subdomain) hands that
// user's OAuth access token to the host named in Location, and that host only
// has to be public to pass the target guard.

const mastodonAccount: any = connectionProviderById('mastodon-account');

// Same shape as stubFetch, but keeps each hop's Authorization header — the
// header is the whole assertion here, so recording only URLs would pass while
// the token leaked.
let hops: { url: string; authorization: string | null }[] = [];
const stubFetchWithHeaders = (impl: (url: string) => Response) => {
  hops = [];
  (globalThis as any).fetch = async (url: unknown, init?: any) => {
    hops.push({ url: String(url), authorization: new Headers(init?.headers).get('authorization') });
    return impl(String(url));
  };
};

const timeline = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const mastodonStatuses = [{ id: '1', url: 'https://example.com/@a/1', content: 'hi', account: { acct: 'a' } }];

test('an authenticated GET keeps its token on a same-origin redirect', async () => {
  stubFetchWithHeaders((url) =>
    url.startsWith('https://example.com/api/v1/timelines/home')
      ? new Response(null, { status: 302, headers: { location: 'https://example.com/api/v2/timelines/home' } })
      : timeline(mastodonStatuses)
  );
  const result = await mastodonAccount.fetchFeed(
    { config: { instance: 'example.com' } },
    { limit: 5, tokens: { accessToken: 'secret-token' } }
  );
  assert.equal(result.ok, true);
  assert.equal(hops.length, 2, 'the same-origin redirect must be followed');
  assert.equal(hops[0].authorization, 'Bearer secret-token');
  assert.equal(hops[1].authorization, 'Bearer secret-token', 'a same-origin hop must keep the token');
});

test('an authenticated GET drops its token on a cross-origin redirect', async () => {
  stubFetchWithHeaders((url) =>
    url.startsWith('https://example.com/api/v1/timelines/home')
      ? new Response(null, { status: 302, headers: { location: 'https://attacker.test/collect' } })
      : timeline([])
  );
  await mastodonAccount.fetchFeed(
    { config: { instance: 'example.com' } },
    { limit: 5, tokens: { accessToken: 'secret-token' } }
  );
  assert.equal(hops.length, 2, 'the cross-origin hop is still made — only the credential is withheld');
  assert.equal(hops[0].authorization, 'Bearer secret-token');
  assert.equal(hops[1].authorization, null, "the user's provider token must never reach another origin");
});

test('a token dropped cross-origin is not reinstated by a redirect back', async () => {
  // Stripping keyed to the ORIGINAL origin instead of the previous hop would
  // hand the token back here, so the round trip is the test.
  stubFetchWithHeaders((url) => {
    if (url.startsWith('https://example.com/api/v1/timelines/home')) {
      return new Response(null, { status: 302, headers: { location: 'https://attacker.test/bounce' } });
    }
    if (url === 'https://attacker.test/bounce') {
      return new Response(null, { status: 302, headers: { location: 'https://example.com/api/v1/back' } });
    }
    return timeline([]);
  });
  await mastodonAccount.fetchFeed(
    { config: { instance: 'example.com' } },
    { limit: 5, tokens: { accessToken: 'secret-token' } }
  );
  assert.equal(hops.length, 3);
  assert.equal(hops[1].authorization, null);
  assert.equal(hops[2].authorization, null, 'a bounce back to the start must not restore the token');
});

test('redirects between public hosts still work', async () => {
  stubFetch((url) =>
    url === 'https://example.com/feed.xml'
      ? new Response(null, { status: 301, headers: { location: 'https://example.org/real.xml' } })
      : feedResponse(RSS_BODY)
  );
  const result = await rss.resolveAccount({ feedUrl: 'https://example.com/feed.xml' });
  assert.equal(result.ok, true, 'a public → public redirect must still connect');
  assert.deepEqual(calls, ['https://example.com/feed.xml', 'https://example.org/real.xml']);
});

test('an ordinary public feed still connects', async () => {
  stubFetch(() => feedResponse(RSS_BODY));
  const result = await rss.resolveAccount({ feedUrl: 'https://example.com/feed.xml' });
  assert.equal(result.ok, true, 'public feeds must be unaffected by the guard');
  assert.equal(result.account.handle, 'example.com');
  assert.equal(result.account.displayName, 'Example Feed');
  assert.deepEqual(calls, ['https://example.com/feed.xml']);
});

test('a global-unicast IPv6 literal is not collateral damage', async () => {
  stubFetch(() => feedResponse(RSS_BODY));
  const result = await rss.resolveAccount({ feedUrl: 'https://[2606:4700:4700::1111]/feed.xml' });
  assert.equal(result.ok, true, 'public v6 addresses must still be reachable');
  assert.deepEqual(calls, ['https://[2606:4700:4700::1111]/feed.xml']);
});

// --- response size cap -------------------------------------------------------
// The same reason the target guard exists applies to the response: the feed
// host is whatever the user typed, so it can answer with an endless body. The
// cap therefore has to bound what is READ. Measuring `await resp.text()`
// afterwards is a check the attacker has already won — the bytes are in the
// heap by then. `served`/`cancelled` are the real assertions: the transfer
// must stop near the cap rather than being drained and then rejected.

const endlessBody = (chunkBytes: number) => {
  const chunk = new Uint8Array(chunkBytes).fill(0x61); // 'a'
  let served = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      served += chunk.byteLength;
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    }
  });
  return { stream, served: () => served, cancelled: () => cancelled };
};

test('refuses a body past the response cap, and stops reading it', async () => {
  const endless = endlessBody(256 * 1024);
  stubFetch(() => new Response(endless.stream, { status: 200, headers: { 'content-type': 'application/xml' } }));
  const result = await rss.resolveAccount({ feedUrl: 'https://example.com/feed.xml' });
  assert.equal(result.ok, false, 'an oversized feed body must be refused');
  assert.ok(endless.cancelled(), 'the transfer must be cancelled, not drained');
  // the cap is 3MB; allow generous slack for stream buffering, but nothing
  // like the unbounded read a whole-body buffer would have performed
  assert.ok(endless.served() < 8_000_000, `the read must stop near the cap (served ${endless.served()} bytes)`);
});

test('refuses an oversized body on its declared content-length, without draining it', async () => {
  const chunk = 256 * 1024;
  const endless = endlessBody(chunk);
  stubFetch(
    () => new Response(endless.stream, { status: 200, headers: { 'content-type': 'application/xml', 'content-length': '9000000' } })
  );
  const result = await rss.resolveAccount({ feedUrl: 'https://example.com/feed.xml' });
  assert.equal(result.ok, false, 'a body that declares itself oversized must be refused');
  assert.ok(endless.cancelled(), 'the transfer must be cancelled');
  // A ReadableStream pre-buffers one chunk of its own accord (highWaterMark),
  // so "never pulled" is not observable — but the cap path above needs ~12
  // chunks to reach 3MB, so staying inside two proves this one short-circuited
  // on the header instead of streaming up to the cap.
  assert.ok(endless.served() <= chunk * 2, `content-length must short-circuit the read (served ${endless.served()} bytes)`);
});

// --- link scheme guard -------------------------------------------------------
// A feed item's permalink and its third-party author URL are rendered as real
// <a href> targets by PostCard. The provider behind them can be any RSS feed
// or fediverse instance the user named, so a hostile source that returns
// `javascript:` would otherwise store working XSS on a post that other
// Thingtime accounts can open by permalink.

test('webLink keeps real web links', () => {
  assert.equal(webLink('https://example.com/post/1'), 'https://example.com/post/1');
  assert.equal(webLink('http://example.com/post/1'), 'http://example.com/post/1');
  assert.equal(webLink('  https://example.com/x  '), 'https://example.com/x');
});

test('webLink refuses script-bearing and non-web schemes', () => {
  assert.equal(webLink('javascript:alert(document.cookie)'), null);
  assert.equal(webLink('JavaScript:alert(1)'), null);
  assert.equal(webLink('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(webLink('vbscript:msgbox(1)'), null);
  assert.equal(webLink('file:///etc/passwd'), null);
  assert.equal(webLink('/relative/path'), null);
  assert.equal(webLink(''), null);
  assert.equal(webLink(null), null);
  assert.equal(webLink(42), null);
});

test('webLink decodes entity-escaped schemes before judging them', () => {
  // RSS bodies routinely arrive entity-encoded; judging the raw string would
  // let &#106;avascript: through as "not a javascript: URL".
  assert.equal(webLink('&#106;avascript:alert(1)'), null);
});

test('webLink bounds the stored length', () => {
  assert.equal(webLink(`https://example.com/${'a'.repeat(2000)}`), null);
});
