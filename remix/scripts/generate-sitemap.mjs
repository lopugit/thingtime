#!/usr/bin/env node
// Offline sitemap generator — the same engine as GET /sitemap.xml, run as a
// script so the crawl frontier can be produced programmatically (CI, cron,
// mirrors, static hosts) without a browser or a server in the loop.
//
//   npm --prefix remix run sitemap:generate                        # static section + robots.txt for https://thingtime.com
//   npm --prefix remix run sitemap:generate -- --origin https://preview.example --out ./sitemap-out
//   npm --prefix remix run sitemap:generate -- --fetch             # also mirror every UGC section from <origin>/api/v1/sitemap
//   npm --prefix remix run sitemap:generate -- --stdout            # print the static urlset instead of writing files
//
// Without --fetch nothing touches the network or the database: the static
// section and robots.txt come straight from app/api/utils/seo/sitemapCore.ts
// (node strips the types on import, like generate-branding-assets.mjs) plus
// the committed branding manifest. With --fetch the live API is the source of
// truth for posts/pages/profiles, so this script never re-implements the
// anonymous acl walk — it only mirrors what the server would already serve.
//
// Output files (never written into public/: a static /sitemap.xml there would
// shadow the live route through Vercel's filesystem-first routing):
//   <out>/sitemap.xml                         index (rewritten to point at the mirrored files when --fetch)
//   <out>/sitemap-static.xml
//   <out>/sitemap-posts-<n>.xml, sitemap-pages-<n>.xml, sitemap-profiles.xml   (--fetch)
//   <out>/robots.txt

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	SITEMAP_API_PATH,
	SITEMAP_PATH,
	buildRobotsTxt,
	normaliseSitemapOrigin,
	renderSitemapIndex,
	renderUrlset,
	staticSitemapUrls
} from '../app/api/utils/seo/sitemapCore.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(HERE, '..', 'app', 'components', 'Branding', 'brandingAssets.generated.json');
const DEFAULT_ORIGIN = 'https://thingtime.com';
const DEFAULT_OUT = path.join(HERE, '..', 'sitemap-out');

const args = process.argv.slice(2);
const flag = (name) => {
	const index = args.indexOf(`--${name}`);
	return index === -1 ? undefined : args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : true;
};

if (flag('help')) {
	console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((line) => line.startsWith('//')).map((line) => line.slice(3)).join('\n'));
	process.exit(0);
}

const origin = normaliseSitemapOrigin(String(flag('origin') || DEFAULT_ORIGIN));
const outDir = path.resolve(String(flag('out') || DEFAULT_OUT));
const shouldFetch = flag('fetch') === true;
const toStdout = flag('stdout') === true;
const generatedAt = new Date().toISOString();

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const staticXml = renderUrlset(staticSitemapUrls(origin, manifest, generatedAt));

if (toStdout) {
	process.stdout.write(staticXml);
	process.exit(0);
}

mkdirSync(outDir, { recursive: true });
const write = (name, body) => {
	writeFileSync(path.join(outDir, name), body);
	console.log(`[sitemap] wrote ${path.relative(process.cwd(), path.join(outDir, name))} (${Buffer.byteLength(body)} bytes)`);
};

write('robots.txt', buildRobotsTxt(origin));
write('sitemap-static.xml', staticXml);

// Section URL (?section=…&page=…) → mirrored file name.
const fileNameFor = (loc) => {
	const url = new URL(loc);
	const section = url.searchParams.get('section') || 'static';
	const page = url.searchParams.get('page');
	return `sitemap-${section}${page ? `-${page}` : ''}.xml`;
};

const fetchText = async (url) => {
	const response = await fetch(url, { headers: { accept: 'application/xml, text/plain' } });
	if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
	return response.text();
};

if (shouldFetch) {
	const apiIndexUrl = `${origin}${SITEMAP_API_PATH}`;
	const indexXml = await fetchText(apiIndexUrl);
	const locs = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].replace(/&amp;/g, '&'));
	const mirrored = [];
	for (const loc of locs) {
		const name = fileNameFor(loc);
		if (name === 'sitemap-static.xml') {
			mirrored.push(name);
			continue;
		}
		// Pull through the API path so the mirror and the live route share one implementation.
		const apiLoc = loc.replace(SITEMAP_PATH, SITEMAP_API_PATH);
		write(name, await fetchText(apiLoc));
		mirrored.push(name);
	}
	write('sitemap.xml', renderSitemapIndex(mirrored.map((name) => ({ loc: `${origin}/${name}`, lastmod: generatedAt }))));
} else {
	write('sitemap.xml', renderSitemapIndex([{ loc: `${origin}/sitemap-static.xml`, lastmod: generatedAt }]));
	console.log('[sitemap] static section only — pass --fetch to mirror posts/pages/profiles from the live API.');
}
