import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const fixture = process.env.TT_CATALOGUE_BROWSER_FIXTURE;
const puppeteerPath = process.env.TT_CATALOGUE_PUPPETEER;
const chrome = process.env.TT_CATALOGUE_CHROME;
const artifacts = process.env.TT_CATALOGUE_ARTIFACTS;
test("native IndexedDB catalogue staging admits large streams, preserves edits, rolls back and reloads", {
  skip: !fixture || !puppeteerPath || !chrome || !artifacts,
  timeout: 18e4
}, async () => {
  assert.equal(process.env.TT_CATALOGUE_NETWORK_NONE, "verified", "Requires runner-verified browser/backend network-none boundary");
  assert.ok(process.env.TT_CATALOGUE_SESSION, "Requires task-owned manager session");
  const bundle = await readFile(fixture);
  const server = http.createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/fixture.js" ? "application/javascript" : "text/html");
    response.end(request.url === "/fixture.js" ? bundle : '<!doctype html><title>Catalogue browser storage acceptance</title><script src="/fixture.js"><\/script>');
  });
  await new Promise((resolve2) => server.listen(18726, "127.0.0.1", resolve2));
  const { default: puppeteer } = await import(puppeteerPath);
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, pipe: true, args: ["--no-proxy-server", "--disable-background-networking"] });
    assert.ok(!browser.process().spawnargs.includes("--no-sandbox"));
    const page = await browser.newPage(), errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:18726/");
    const result = [];
    for (const domain of ["themes", "algorithms"]) result.push(await page.evaluate((domain2) => window.catalogueAcceptance.run(domain2), domain));
    await page.reload();
    const reload = [];
    for (const domain of ["themes", "algorithms"]) reload.push(await page.evaluate((domain2) => window.catalogueAcceptance.reload(domain2), domain));
    assert.deepEqual(errors, []);
    await mkdir(artifacts, { recursive: true });
    await writeFile(resolve(artifacts, "verification.json"), JSON.stringify({ scope: "Browser storage adapter acceptance with synthetic stream, no server/UI acceptance claim", result, reload, errors }, null, 2));
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise((resolve2) => server.close(() => resolve2()));
  }
});
