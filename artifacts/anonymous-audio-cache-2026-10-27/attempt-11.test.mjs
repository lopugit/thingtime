// remix/app/components/Attachments/AudioAttachmentPlayer.browser.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
var origin = process.env.TT_AUDIO_ORIGIN;
var session = process.env.TT_AUDIO_SESSION;
var artifacts = process.env.TT_AUDIO_ARTIFACTS;
var wav = (frequency) => {
  const count = 8e3, bytes = Buffer.alloc(44 + count * 2);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8e3, 24);
  bytes.writeUInt32LE(16e3, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(count * 2, 40);
  for (let n = 0; n < count; n++) bytes.writeInt16LE(Math.round(Math.sin(n * frequency * 2 * Math.PI / 8e3) * 5e3), 44 + n * 2);
  return bytes;
};
test("ordinary audio player fences delayed saves across queue/account changes and keeps exact offline originals", { skip: !origin || !session || !artifacts, timeout: 24e4 }, async () => {
  assert.equal(new URL(origin).hostname, "127.0.0.1");
  const health = await (await fetch(origin + "/api/v1/health/nitro", { redirect: "error" })).json();
  assert.equal(health.testEnvironment.mode, "isolated-agent-test");
  assert.equal(health.testEnvironment.sessionId, session);
  const { chromium } = await import(process.env.TT_SHARED_PLAYWRIGHT_PATH);
  const browser = await chromium.launch({ executablePath: process.env.TT_AUDIO_CHROME, headless: true, chromiumSandbox: true, args: ["--no-proxy-server", "--disable-background-networking"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1e3 } }), admin = await browser.newContext(), author = await browser.newContext(), page = await context.newPage(), adminPage = await admin.newPage(), authorPage = await author.newPage();
  const headers = { Origin: origin }, username = "audio-" + randomUUID().slice(0, 12), password = randomUUID() + randomUUID();
  const servedModules = [], moduleChecks = [];
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (response.ok() && path.startsWith("/assets/") && /\.(?:js|css)$/.test(path)) {
      const check = (async () => {
        const served = await response.body(), packaged = await readFile(resolve("/tmp/app/public", "." + path));
        assert.deepEqual(served, packaged, "Served module must equal this fresh package: " + path);
        servedModules.push({ path, sha256: createHash("sha256").update(served).digest("hex") });
      })();
      moduleChecks.push(check);
      void check.catch(() => {
      });
    }
  });
  const call = (target, path, data) => target.evaluate(async ({ path: path2, data: data2 }) => {
    const response = await fetch(path2, data2 === void 0 ? { signal: AbortSignal.timeout(3e4) } : { signal: AbortSignal.timeout(3e4), method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data2) });
    return { status: response.status, value: await response.json() };
  }, { path, data });
  const errors = [], boundaries = [], ids = [], requests = [], audioResponses = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname === "/api/v1/attachments/content") audioResponses.push({ id: url.searchParams.get("id"), mode: url.searchParams.get("cache"), status: response.status() });
  });
  let postId = "", heldId = "", release, requestHeld, rejectHeld;
  page.setDefaultTimeout(25e3);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/attachments/content" && request.resourceType() === "fetch") requests.push({ id: url.searchParams.get("id"), mode: url.searchParams.get("cache"), expectedActor: request.headers()["x-thingtime-expected-actor"], plane: request.headers()["x-thingtime-expected-data-plane"], serviceWorker: request.serviceWorker()?.url() || null });
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  const online = async (offline) => {
    await context.setOffline(offline);
    await cdp.send("Network.overrideNetworkState", { offline, latency: 1, downloadThroughput: 1e8, uploadThroughput: 1e8, connectionType: "ethernet" });
  };
  const click = (name) => page.getByRole("button", { name, exact: true }).click();
  const source = () => page.locator("audio source").first().getAttribute("src");
  const waitIdentity = async (id) => {
    await page.evaluate(() => dispatchEvent(new Event("thingtime:root-data-refresh")));
    await page.waitForFunction(async (id2) => ((await (await fetch("/api/root-data")).json()).user?.id || null) === id2, id);
    await page.waitForTimeout(300);
  };
  const delayedSave = async (id) => {
    heldId = id;
    const waiting = new Promise((resolve2, reject) => {
      requestHeld = resolve2;
      rejectHeld = reject;
    });
    void waiting.catch(() => {
    });
    await click("Save full file offline");
    await Promise.race([waiting, page.waitForTimeout(3e4).then(() => {
      throw Error("The player did not issue its original-bytes save request; inspect captured DOM and request modes.");
    })]);
  };
  await mkdir(artifacts, { recursive: true });
  try {
    const nativeMedia = await page.evaluate(async (bytes) => {
      const audio = document.createElement("audio"), source2 = document.createElement("source"), url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "audio/wav" }));
      source2.src = url;
      audio.append(source2);
      document.body.append(audio);
      await audio.play();
      audio.pause();
      const before = { currentSrc: audio.currentSrc, readyState: audio.readyState };
      audio.remove();
      audio.removeAttribute("src");
      audio.querySelectorAll("source").forEach((source3) => source3.removeAttribute("src"));
      audio.load();
      await new Promise((resolve2) => setTimeout(resolve2, 100));
      const after = { currentSrc: audio.currentSrc, paused: audio.paused, readyState: audio.readyState, networkState: audio.networkState, srcAttribute: audio.getAttribute("src"), sources: [...audio.querySelectorAll("source")].map((source3) => source3.getAttribute("src")) };
      let playingEvents = 0;
      audio.addEventListener("playing", () => playingEvents++);
      const playback = audio.play().then(() => "played", (error) => error.name);
      const beforeCancellation = await Promise.race([playback, new Promise((resolve2) => setTimeout(() => resolve2("pending without source"), 250))]);
      audio.pause();
      audio.load();
      const playResult = await Promise.race([playback, new Promise((resolve2) => setTimeout(() => resolve2("cancellation timed out"), 1e3))]);
      URL.revokeObjectURL(url);
      return { before, after, beforeCancellation, playResult, playingEvents };
    }, [...wav(110)]);
    await writeFile(resolve(artifacts, "native-media-api.json"), JSON.stringify(nativeMedia, null, 2));
    assert.equal(nativeMedia.after.paused, true);
    assert.equal(nativeMedia.after.readyState, 0);
    assert.equal(nativeMedia.after.networkState, 3);
    assert.equal(nativeMedia.after.srcAttribute, null);
    assert.deepEqual(nativeMedia.after.sources, [null]);
    assert.equal(nativeMedia.beforeCancellation, "pending without source");
    assert.equal(nativeMedia.playResult, "AbortError");
    assert.equal(nativeMedia.playingEvents, 0);
    await online(false);
    const administrator = JSON.parse(await readFile(process.env.TT_AUDIO_ADMIN_FIXTURE, "utf8"));
    const loggedIn = await admin.request.post(origin + "/api/v1/login", { headers, data: { username: administrator.username, password: administrator.password } });
    assert.equal(loggedIn.status(), 200);
    const registration = await context.request.post(origin + "/api/v1/auth/register", { headers, data: { username, email: username + "@example.test", password } });
    assert.equal(registration.status(), 200);
    const ownerId = (await registration.json()).user.id;
    const authorName = "audio-author-" + randomUUID().slice(0, 10);
    const authorRegistration = await author.request.post(origin + "/api/v1/auth/register", { headers, data: { username: authorName, email: authorName + "@example.test", password: randomUUID() + randomUUID() } });
    assert.equal(authorRegistration.status(), 200);
    const authorId = (await authorRegistration.json()).user.id;
    await admin.addCookies((await admin.request.storageState()).cookies);
    await context.addCookies((await context.request.storageState()).cookies);
    await author.addCookies((await author.request.storageState()).cookies);
    await adminPage.goto(origin + "/things");
    await page.goto(origin + "/things");
    await authorPage.goto(origin + "/things");
    assert.equal((await call(adminPage, "/api/root-data")).value.user?.id, administrator.ownerId);
    assert.equal((await call(page, "/api/root-data")).value.user?.id, ownerId);
    assert.equal((await call(authorPage, "/api/root-data")).value.user?.id, authorId);
    assert.equal((await call(adminPage, "/api/v1/admin/users/public-uploads", { userId: authorId, enabled: true, scope: "public" })).status, 200);
    const files = [wav(220), wav(440)];
    for (const [index, bytes] of files.entries()) {
      const start = await call(authorPage, "/api/v1/attachments/uploads", { requestId: randomUUID(), filename: `fixture-track-${index + 1}.wav`, contentType: "audio/wav", sizeBytes: bytes.length, purpose: "post" });
      assert.equal(start.status, 200, JSON.stringify(start.value));
      const uploadId = start.value.upload.id;
      const signed = await call(authorPage, "/api/v1/attachments/uploads/parts", { uploadId, parts: [{ partNumber: 1, checksumSha256: createHash("sha256").update(bytes).digest("base64") }] });
      assert.equal(signed.status, 200);
      const part = signed.value.parts[0];
      assert.equal(new URL(part.url).hostname, "127.0.0.1");
      assert.equal((await author.request.put(part.url, { headers: part.headers, data: bytes })).status(), 200);
      const completed = await call(authorPage, "/api/v1/attachments/uploads/complete", { uploadId });
      assert.equal(completed.status, 200, JSON.stringify(completed.value));
      ids.push(completed.value.attachment.id);
    }
    const seeded = await call(authorPage, "/api/v1/things", { thingtime: ["post"], crystal: { type: "text", text: "Two synthetic ordinary audio tracks." }, visibility: "public", attachmentIds: ids });
    assert.equal(seeded.status, 200, JSON.stringify(seeded.value));
    const post = seeded.value;
    postId = post.thing?.id || post.post?.id || post.id;
    assert.ok(postId);
    await author.close();
    await page.goto(origin + "/post/" + postId);
    await page.getByRole("button", { name: "1. fixture-track-1.wav", exact: true }).waitFor();
    await page.waitForFunction(async () => {
      await navigator.serviceWorker.ready;
      return !!navigator.serviceWorker.controller;
    });
    await context.route("**/api/v1/attachments/content?**", async (route) => {
      const request = route.request(), url = new URL(request.url()), mode = url.searchParams.get("cache");
      if (request.resourceType() !== "fetch" || url.searchParams.get("id") !== heldId || mode !== "original-bytes") return route.continue();
      let response;
      try {
        response = await route.fetch({ timeout: 3e4 });
      } catch (error) {
        audioResponses.push({ id: url.searchParams.get("id"), mode, routeFetchError: error?.name || "Error" });
        rejectHeld?.(Error("Intercepted original audio fetch failed."));
        try {
          await route.abort();
        } catch {
        }
        return;
      }
      audioResponses.push({ id: url.searchParams.get("id"), mode, interceptedStatus: response.status(), serviceWorker: request.serviceWorker()?.url() || null });
      if (response.status() !== 200) {
        rejectHeld?.(Error("Intercepted original audio returned HTTP " + response.status()));
        await route.fulfill({ response });
        return;
      }
      const waiting = new Promise((resolve2) => {
        release = resolve2;
      });
      heldId = "";
      requestHeld?.();
      await waiting;
      try {
        await route.fulfill({ response });
      } catch {
      }
    });
    console.log("Audio checkpoint: independent author/viewer fixture and remote player ready");
    await delayedSave(ids[0]);
    await click("2. fixture-track-2.wav");
    release();
    await page.waitForTimeout(400);
    assert.equal(await source(), "/api/v1/attachments/content?id=" + ids[1]);
    assert.equal(await page.getByRole("button", { name: "Use streaming", exact: true }).count(), 0);
    console.log("Audio checkpoint: delayed track-save fence passed");
    await click("Save full file offline");
    await page.getByRole("button", { name: "Use streaming", exact: true }).waitFor();
    const saved = await source();
    assert.ok(saved?.startsWith("blob:"));
    const exact = Buffer.from(await page.evaluate(async (url) => [...new Uint8Array(await (await fetch(url)).arrayBuffer())], saved));
    assert.deepEqual(exact, files[1]);
    const decoded = await page.locator("audio").first().evaluate(async (audio) => {
      await audio.play();
      return { duration: audio.duration, readyState: audio.readyState, paused: audio.paused };
    });
    assert.equal(decoded.duration, 1);
    assert.ok(decoded.readyState >= 2);
    assert.equal(decoded.paused, false);
    await page.locator("audio").first().evaluate((audio) => audio.pause());
    console.log("Audio checkpoint: exact original saved, decoded and played");
    const sameIdentityReload = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/root-data");
    await page.evaluate(() => dispatchEvent(new Event("thingtime:root-data-refresh")));
    await sameIdentityReload;
    await page.waitForTimeout(300);
    assert.equal(await source(), saved, "Equivalent attachment/identity refresh must preserve the active local Blob");
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1e3 : 844 });
      await page.evaluate(async () => {
        const roots = [document.scrollingElement, ...[...document.querySelectorAll("body *")].filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1)];
        for (const root of roots) {
          if (root.scrollHeight > 4e4) throw Error("Unexpected repeating audio page");
          for (let top = 0; top <= root.scrollHeight; top += Math.max(200, root.clientHeight / 2)) {
            root.scrollTop = top;
            await new Promise(requestAnimationFrame);
            if (document.documentElement.scrollWidth > innerWidth) throw Error("Horizontal overflow");
          }
        }
      });
      const geometry = await page.locator("audio").first().evaluate((audio) => {
        const bounds = audio.getBoundingClientRect();
        return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, left: bounds.left, right: bounds.right, audioWidth: bounds.width };
      });
      assert.equal(geometry.width, geometry.scrollWidth);
      assert.ok(geometry.left >= 0 && geometry.right <= width && geometry.audioWidth > 0);
      boundaries.push(geometry);
      await page.locator("audio").first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(artifacts, `audio-${width}.png`) });
    }
    await click("1. fixture-track-1.wav");
    await delayedSave(ids[0]);
    await page.locator("audio").first().evaluate((audio) => audio.pause());
    assert.equal(await page.getByRole("button", { name: "1. fixture-track-1.wav", exact: true }).getAttribute("aria-current"), "true", "Account-boundary race must retain the selected pending track");
    const logoutPage = await context.newPage();
    const logoutCdp = await context.newCDPSession(logoutPage);
    await logoutCdp.send("Network.enable");
    await logoutCdp.send("Network.overrideNetworkState", { offline: false, latency: 1, downloadThroughput: 1e8, uploadThroughput: 1e8, connectionType: "ethernet" });
    await logoutPage.goto(origin + "/post/" + postId);
    await logoutPage.getByRole("button", { name: "Log out", exact: true }).waitFor();
    assert.equal(await logoutPage.evaluate(() => navigator.onLine), true);
    await writeFile(resolve(artifacts, "logout-tab.json"), JSON.stringify({ url: logoutPage.url(), logoutButtons: await logoutPage.getByRole("button", { name: "Log out", exact: true }).count(), body: await logoutPage.locator("body").innerText() }, null, 2));
    assert.equal(await logoutPage.getByRole("button", { name: "Log out", exact: true }).count(), 1);
    let releaseRoot, rootHeld;
    const rootGate = new Promise((resolve2) => {
      releaseRoot = resolve2;
    }), pendingRoot = new Promise((resolve2) => {
      rootHeld = resolve2;
    });
    await page.route("**/api/root-data", async (route) => {
      rootHeld();
      await rootGate;
      try {
        await route.continue();
      } catch {
      }
    });
    await page.evaluate(() => {
      window.__audioBeforeIdentity = document.querySelector("audio");
    });
    const pendingDiagnostic = () => page.evaluate(() => {
      const old = window.__audioBeforeIdentity;
      return { body: document.body.innerText, mountedAudioCount: document.querySelectorAll("audio").length, sourceCount: document.querySelectorAll("audio source[src]").length, old: old ? { connected: old.isConnected, paused: old.paused, currentSrc: old.currentSrc, srcAttribute: old.getAttribute("src"), sources: [...old.querySelectorAll("source")].map((source2) => source2.getAttribute("src")), readyState: old.readyState, networkState: old.networkState } : null };
    });
    await writeFile(resolve(artifacts, "before-pending-root.json"), JSON.stringify(await pendingDiagnostic(), null, 2));
    await logoutPage.getByRole("button", { name: "Log out", exact: true }).click();
    await Promise.race([pendingRoot, page.waitForTimeout(3e4).then(() => {
      throw Error("Main page did not start its pending root refresh after real second-tab logout.");
    })]);
    await writeFile(resolve(artifacts, "pending-root-start.json"), JSON.stringify(await pendingDiagnostic(), null, 2));
    try {
      await page.waitForFunction(() => {
        const old = window.__audioBeforeIdentity;
        return !document.querySelector("audio source[src]") && old.paused && old.readyState === 0 && old.networkState === 3 && !old.getAttribute("src") && !old.querySelector("source[src]");
      }, void 0, { timeout: 5e3 });
    } catch (error) {
      await writeFile(resolve(artifacts, "pending-root-failed.json"), JSON.stringify(await pendingDiagnostic(), null, 2));
      throw error;
    }
    const pendingState = await pendingDiagnostic();
    assert.equal(pendingState.sourceCount, 0);
    assert.equal(pendingState.old?.paused, true);
    assert.equal(pendingState.old?.readyState, 0);
    assert.equal(pendingState.old?.networkState, 3);
    assert.equal(pendingState.old?.srcAttribute, null);
    assert.deepEqual(pendingState.old?.sources, [null]);
    const retiredPlayback = await page.evaluate(async () => {
      const old = window.__audioBeforeIdentity;
      let playingEvents = 0;
      old.addEventListener("playing", () => playingEvents++);
      const playback = old.play().then(() => "played", (error) => error.name);
      const beforeCancellation = await Promise.race([playback, new Promise((resolve2) => setTimeout(() => resolve2("pending without source"), 250))]);
      const nativeState = { readyState: old.readyState, networkState: old.networkState, srcAttribute: old.getAttribute("src"), sources: [...old.querySelectorAll("source")].map((source2) => source2.getAttribute("src")) };
      old.pause();
      old.load();
      const playResult = await Promise.race([playback, new Promise((resolve2) => setTimeout(() => resolve2("cancellation timed out"), 1e3))]);
      return { beforeCancellation, nativeState, playResult, playingEvents, paused: old.paused };
    });
    await writeFile(resolve(artifacts, "retired-playback.json"), JSON.stringify(retiredPlayback, null, 2));
    assert.equal(retiredPlayback.beforeCancellation, "pending without source");
    assert.equal(retiredPlayback.nativeState.readyState, 0);
    assert.equal(retiredPlayback.nativeState.networkState, 3);
    assert.equal(retiredPlayback.nativeState.srcAttribute, null);
    assert.deepEqual(retiredPlayback.nativeState.sources, [null]);
    assert.equal(retiredPlayback.playResult, "AbortError");
    assert.equal(retiredPlayback.playingEvents, 0);
    assert.equal(retiredPlayback.paused, true);
    release();
    await page.waitForTimeout(300);
    assert.equal(await page.locator("audio source[src]").count(), 0, "Late saved bytes cannot reopen a source while identity is unresolved");
    await writeFile(resolve(artifacts, "pending-root.json"), JSON.stringify(pendingState, null, 2));
    console.log("Audio checkpoint: pending root has no native source");
    releaseRoot();
    await page.unroute("**/api/root-data");
    await logoutPage.close();
    await waitIdentity(null);
    await page.waitForTimeout(300);
    assert.ok(!(await source())?.startsWith("blob:"));
    assert.equal(await page.getByRole("button", { name: "Use streaming", exact: true }).count(), 0);
    await click("2. fixture-track-2.wav");
    assert.equal(await page.getByRole("button", { name: "Use offline copy", exact: true }).count(), 0, "Anonymous playback cannot adopt the owner cache");
    await click("Save full file offline");
    await page.getByRole("button", { name: "Use streaming", exact: true }).waitFor();
    assert.ok((await source())?.startsWith("blob:"), "Ordinarily authorized public audio remains saveable anonymously");
    await online(true);
    await page.reload();
    await page.getByRole("button", { name: "2. fixture-track-2.wav", exact: true }).click();
    await click("Use offline copy");
    assert.ok((await source())?.startsWith("blob:"));
    const offlineDecoded = await page.locator("audio").first().evaluate(async (audio) => {
      await audio.play();
      return { duration: audio.duration, readyState: audio.readyState, paused: audio.paused };
    });
    assert.equal(offlineDecoded.duration, 1);
    assert.ok(offlineDecoded.readyState >= 2);
    assert.equal(offlineDecoded.paused, false);
    await page.locator("audio").first().evaluate((audio) => audio.pause());
    await online(false);
    assert.equal((await call(page, "/api/v1/login", { username, password })).status, 200);
    await waitIdentity(ownerId);
    await click("2. fixture-track-2.wav");
    await click("Use offline copy");
    assert.ok((await source())?.startsWith("blob:"));
    await click("Remove offline copy");
    await page.getByRole("button", { name: "Save full file offline", exact: true }).waitFor();
    assert.ok(!(await source())?.startsWith("blob:"));
    assert.deepEqual(errors, []);
    await Promise.all(moduleChecks);
    assert.ok(servedModules.some((module) => module.path.endsWith(".js")));
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return { status: document.fonts.status, bodyFamily: getComputedStyle(document.body).fontFamily, faces: [...document.fonts].map((face) => ({ family: face.family, status: face.status })) };
    });
    await writeFile(resolve(artifacts, "served-modules.json"), JSON.stringify({ servedModules, fonts }, null, 2));
    await writeFile(resolve(artifacts, "verification.json"), JSON.stringify({ postId, attachments: ids, selectedTrackRaceFenced: true, ownerToAnonymousRaceFenced: true, pendingRootSourceRemoved: true, equivalentRefreshPreserved: true, exactOriginalSha256: createHash("sha256").update(files[1]).digest("hex"), anonymousPublicSave: true, offlineReloadPlayback: true, decoded, offlineDecoded, removal: true, boundaries, requests, audioResponses, errors }, null, 2));
  } catch (error) {
    release?.();
    await Promise.allSettled(moduleChecks);
    await writeFile(resolve(artifacts, "served-modules-partial.json"), JSON.stringify({ servedModules }, null, 2));
    await page.screenshot({ path: resolve(artifacts, "failure.png"), fullPage: true }).catch(() => {
    });
    await writeFile(resolve(artifacts, "failure.json"), JSON.stringify({ message: String(error), body: await page.locator("body").innerText().catch(() => ""), postId, ids, requests, audioResponses, errors }, null, 2));
    throw error;
  } finally {
    await author.close();
    await admin.close();
    await context.close();
    await browser.close();
  }
});
