// remix/app/local-workspace/accountSearchDiscovery.browser.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
var origin = process.env.TT_SEARCH_ORIGIN;
var session = process.env.TT_SEARCH_SESSION;
var artifacts = process.env.TT_SEARCH_ARTIFACTS;
test("normal account Search retains scoped cached people, subspaces and Things with truthful offline coverage", { skip: !origin || !session || !artifacts, timeout: 24e4 }, async () => {
  assert.equal(new URL(origin).origin, origin);
  assert.equal(new URL(origin).hostname, "127.0.0.1");
  const health = await (await fetch(origin + "/api/v1/health/nitro", { redirect: "error" })).json();
  assert.equal(health.testEnvironment.mode, "isolated-agent-test");
  assert.equal(health.testEnvironment.sessionId, session);
  const { default: puppeteer } = await import(process.env.TT_SEARCH_PUPPETEER);
  const { request } = await import(process.env.TT_SHARED_PLAYWRIGHT_PATH);
  const browser = await puppeteer.launch({ executablePath: process.env.TT_SEARCH_CHROME, headless: true, pipe: true, args: ["--no-proxy-server", "--disable-background-networking"] });
  assert.ok(!browser.process().spawnargs.includes("--no-sandbox"));
  const context = await browser.createBrowserContext(), page = await context.newPage(), api = await request.newContext({ baseURL: origin });
  page.setDefaultTimeout(25e3);
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  let offline = false;
  const writes = [], errors = [], bounds = [], ids = [];
  const connectivity = async (value) => {
    offline = value;
    await page.setOfflineMode(value);
    await cdp.send("Network.overrideNetworkState", { offline: value, latency: 1, downloadThroughput: 1e8, uploadThroughput: 1e8, connectionType: "ethernet" });
  };
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(r.method()) && offline) writes.push({ method: r.method(), path: new URL(r.url()).pathname });
  });
  await mkdir(artifacts, { recursive: true });
  try {
    await connectivity(false);
    const username = "search_" + randomUUID().slice(0, 12).replaceAll("-", ""), headers = { Origin: origin };
    const registered = await api.post("/api/v1/auth/register", { headers, data: { username, email: username + "@example.test", password: randomUUID() + randomUUID() } });
    assert.equal(registered.status(), 200);
    const ownerId = (await registered.json()).user.id;
    const state = await api.storageState();
    await context.setCookie(...state.cookies);
    await page.goto(origin + "/things", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(async (id) => (await (await fetch("/api/root-data")).json()).user?.id === id, {}, ownerId);
    assert.equal(await page.evaluate(() => navigator.onLine), true);
    const identity = await page.evaluate(async () => {
      const r = await (await fetch("/api/root-data")).json();
      return { ownerId: r.user.id, dataPlane: r.dataPlane, temporary: r.user.temporary };
    });
    assert.equal(identity.ownerId, ownerId);
    assert.equal(identity.dataPlane, "home");
    assert.notEqual(identity.temporary, true);
    const needle = username;
    const fixtures = await page.evaluate(async ({ needle: needle2 }) => {
      const create = async (path, body) => {
        const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        return { status: r.status, body: await r.json() };
      };
      return {
        thing: await create("/api/v1/things", { thingtime: ["data"], crystal: { name: needle2 + " private Thing" }, acl: ["tt:user"] }),
        subspace: await create("/api/v1/subspaces", { slug: needle2, name: needle2 + " discovery subspace", description: "Synthetic isolated discovery fixture", access: "public" })
      };
    }, { needle });
    assert.equal(fixtures.thing.status, 200);
    assert.equal(fixtures.subspace.status, 201, JSON.stringify(fixtures.subspace.body));
    ids.push(fixtures.thing.body.thing?.id || fixtures.thing.body.id);
    const profile = `a[href="/profile/${username}"]`, subspace = `[data-testid="search-subspaces"] a[href="/s/${username}"]`;
    await page.goto(origin + "/search?source=online&q=" + encodeURIComponent(needle), { waitUntil: "domcontentloaded" });
    await page.waitForSelector(profile);
    await page.waitForSelector(subspace);
    await page.waitForFunction((text) => document.body.innerText.includes(text), {}, needle + " private Thing");
    await page.waitForFunction(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) return false;
      for (const key of await caches.keys()) if (key.startsWith("thingtime:offline-shell:") && await (await caches.open(key)).match("/__thingtime_offline_shell_complete__")) return true;
      return false;
    }, { timeout: 9e4 });
    const online = await page.evaluate(async (needle2) => {
      const paths = ["/api/v1/users/search?q=" + encodeURIComponent(needle2), "/api/v1/subspaces?q=" + encodeURIComponent(needle2)];
      return await Promise.all(paths.map(async (path) => {
        const r = await fetch(path);
        return { path, status: r.status, body: await r.json() };
      }));
    }, needle);
    assert.ok(online.every((row) => row.status === 200), JSON.stringify(online));
    await writeFile(resolve(artifacts, "online-checkpoint.json"), JSON.stringify({ identity, online, body: await page.$eval("body", (el) => el.innerText) }, null, 2));
    await connectivity(true);
    assert.equal(await page.evaluate(() => navigator.onLine), false);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(profile);
    await page.waitForSelector(subspace);
    await page.waitForFunction(() => [...document.querySelectorAll("button")].every((el) => el.textContent?.trim() !== "Searching\u2026"));
    await writeFile(resolve(artifacts, "offline-checkpoint.json"), JSON.stringify({ body: await page.$eval("body", (el) => el.innerText), url: page.url() }, null, 2));
    const offlineState = await page.evaluate(({ needle: needle2, profile: profile2, subspace: subspace2 }) => ({ body: document.body.innerText, person: !!document.querySelector(profile2), subspace: !!document.querySelector(subspace2), thing: document.body.innerText.includes(needle2 + " private Thing"), alerts: [...document.querySelectorAll('[role="alert"]')].map((el) => el.textContent) }), { needle, profile, subspace });
    assert.ok(offlineState.person && offlineState.subspace && offlineState.thing);
    for (const width of [1440, 390, 320]) {
      await page.setViewport({ width, height: width === 1440 ? 1e3 : 844 });
      const geometry = await page.evaluate(async () => {
        const roots = [document.scrollingElement, ...[...document.querySelectorAll("body *")].filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1)];
        for (const root of roots) {
          if (root.scrollHeight > 4e4) throw Error("Unexpected repeated search");
          root.scrollTop = 0;
          for (let top = 0; top <= root.scrollHeight; top += Math.max(200, root.clientHeight / 2)) {
            root.scrollTop = top;
            await new Promise(requestAnimationFrame);
            if (document.documentElement.scrollWidth > innerWidth) throw Error("Horizontal overflow");
          }
        }
        return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, visibleControls: [...document.querySelectorAll("button")].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width && r.bottom > 0 && r.top < innerHeight;
        }).length };
      });
      assert.equal(geometry.width, geometry.scrollWidth);
      assert.ok(geometry.visibleControls > 0);
      bounds.push(geometry);
      await page.screenshot({ path: resolve(artifacts, `search-bottom-${width}.png`) });
      await page.evaluate(() => {
        document.scrollingElement.scrollTop = 0;
        for (const el of document.querySelectorAll("body *")) if (/auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop = 0;
      });
      await page.screenshot({ path: resolve(artifacts, `search-${width}.png`) });
    }
    assert.deepEqual(writes, []);
    await connectivity(false);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(profile);
    assert.equal(await page.evaluate(async () => (await fetch("/api/v1/auth/logout", { method: "POST" })).status), 200);
    await page.goto(origin + "/search?source=online", { waitUntil: "domcontentloaded" });
    await page.waitForFunction((text) => !document.body.innerText.includes(text), {}, needle + " private Thing");
    assert.equal(await page.$(profile), null);
    assert.equal(await page.$(subspace), null);
    await connectivity(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    assert.equal(await page.$(profile), null);
    assert.equal(await page.$(subspace), null);
    assert.deepEqual(errors, []);
    const searchNotice = offlineState.alerts.join(" ");
    await writeFile(resolve(artifacts, "verification.json"), JSON.stringify({ identity, fixtures: { thingId: ids[0], subspaceId: fixtures.subspace.body.subspace.id }, online, cachedOfflineSections: true, offlineState, offlineWrites: writes, logoutIsolation: true, bounds, errors, searchNotice }, null, 2));
    assert.match(searchNotice, /cached|partial|saved.*device|connection.*results|results.*connection/i, "Search must truthfully identify its offline cached/partial results");
  } catch (error) {
    await writeFile(resolve(artifacts, "failure.json"), JSON.stringify({ message: String(error), body: await page.$eval("body", (el) => el.innerText), ids, writes, errors }, null, 2));
    await page.screenshot({ path: resolve(artifacts, "failure.png") }).catch(() => {
    });
    throw error;
  } finally {
    await api.dispose();
    await browser.close();
  }
});
