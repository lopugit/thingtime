import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const ariaUrl = 'https://www.w3.org/TR/wai-aria-1.2/';
const htmlUrl = 'https://html.spec.whatwg.org/multipage/indices.html';
const inputUrl = 'https://html.spec.whatwg.org/multipage/input.html';
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');
const attr = (node, key) => node.attrs?.find(a => a.name === key)?.value;
const matches = (node, query) => [...(query(node) ? [node] : []), ...(node.childNodes || []).flatMap(child => matches(child, query))];
const plain = node => text(node).replace(/\s+/g, ' ').trim();
const classes = (node, name) => attr(node, 'class')?.split(/\s+/).includes(name);
const unique = values => [...new Set(values)];
const sorted = entries => Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b, 'en')));
const keyword = /^[a-z0-9_][a-z0-9_*+./-]*$/i;

export async function writeInspectorCatalog(features, currentCss, parse, htmlBody, ariaBody, inputBody, cssSource) {
 const html = parse(htmlBody);
 const input = parse(inputBody);
 const aria = parse(ariaBody);
 const attributes = {};
 const table = matches(html, node => attr(node, 'id') === 'attributes-1')[0];
 if (!table || !matches(aria, node => attr(node, 'id') === 'state_prop_def').length) {
  throw new Error('The source attribute indexes changed; inspect the standards before updating the catalog.');
 }
 for (const row of matches(table, node => node.tagName === 'tr')) {
  const [name, elements, , definition] = (row.childNodes || []).filter(node => ['th', 'td'].includes(node.tagName));
  if (!definition) continue;
  const names = matches(name, node => node.tagName === 'code').map(plain);
  const tags = /HTML elements/.test(plain(elements)) ? ['*'] : matches(elements, node => node.tagName === 'code').map(plain);
  if (!tags.length) continue;
  // The index uses code elements for possible literals and links for
  // non-finite microsyntaxes (URL, integer, text, token lists, etc.).
  const syntax = plain(definition).replace(/\*$/, '');
  const isBoolean = syntax === 'Boolean attribute';
  const values = isBoolean ? ['true', 'false'] : unique(matches(definition, node => node.tagName === 'code').map(plain).filter(value => keyword.test(value)));
  for (const key of names) (attributes[key] ??= []).push([unique(tags), values, syntax, isBoolean || undefined].filter(x => x !== undefined));
 }
 for (const node of matches(aria, node => node.tagName === 'section' && /^aria-[a-z-]+$/.test(attr(node, 'id') || '') && (classes(node, 'state') || classes(node, 'property')))) {
  const key = attr(node, 'id');
  const syntax = matches(node, n => classes(n, 'property-value') || classes(n, 'state-value'))[0];
  const values = matches(node, n => classes(n, 'value-name')).map(n => plain(n).replace(/\s*\(default\)$/, '')).filter(value => keyword.test(value));
  attributes[key] = [[['*'], unique(values), syntax ? plain(syntax) : 'ARIA state or property']];
 }
 // The HTML index links to this separate normative enumerated attribute.
 const inputTypes = matches(input, node => attr(node, 'id') === 'attr-input-type-keywords')[0];
 const inputTypeRow = attributes.type?.find(([tags]) => tags.includes('input'));
 if (!inputTypes || !inputTypeRow) throw new Error('Input type keyword index missing');
 inputTypeRow[1] = unique(matches(inputTypes, node => attr(node, 'data-dfn-for') === 'input/type' &&
  attr(node, 'data-dfn-type') === 'attr-value').map(plain).filter(value => keyword.test(value)));
 const roles = matches(aria, node => node.tagName === 'section' && classes(node, 'role') && attr(node, 'id'))
  .filter(node => !matches(node, n => classes(n, 'role-abstract')).some(n => plain(n).toLowerCase() === 'true'))
  .map(node => attr(node, 'id')).filter(role => keyword.test(role));
 attributes.role = [[['*'], unique(roles).sort(), 'ARIA role']];
 if (Object.keys(attributes).length < 180 || roles.length < 50) throw new Error(`Incomplete HTML / ARIA extraction (${Object.keys(attributes).length} attributes, ${roles.length} roles)`);
 const properties = {}, types = {};
 for (const {language, kind, name, syntax, initial} of features) {
  if (language !== 'css') continue;
  if (kind === 'property' && /^-?[a-z][a-z0-9-]*$/.test(name)) properties[name] = [syntax || '', initial || ''];
  if ((kind === 'type' || kind === 'function') && syntax) types[name] = syntax;
 }
 // The published inventory establishes the coverage. The pinned current
 // grammar fills omissions and supplies modern alternatives for known names.
 for (const { name, syntax, initial } of currentCss.properties) {
  if (!/^-?[a-z][a-z0-9-]*$/.test(name)) continue;
  const [publishedSyntax, publishedInitial] = properties[name] || [];
  properties[name] = [syntax || publishedSyntax || '', initial || publishedInitial || ''];
 }
 for (const { name, syntax } of [...currentCss.types, ...currentCss.functions]) if (syntax) types[name] = syntax;
 if (Object.keys(properties).length < 800 || Object.keys(types).length < 250) throw new Error('Incomplete CSS extraction');
 const sha256 = body => createHash('sha256').update(body).digest('hex');
 const sources = { css: cssSource, html: { url: htmlUrl, sha256: sha256(htmlBody) }, aria: { url: ariaUrl, sha256: sha256(ariaBody) }, input: { url: inputUrl, sha256: sha256(inputBody) } };
 const catalog = { sources, properties: sorted(properties), types: sorted(types), attributes: sorted(attributes) };
 const output = new URL('../app/webPlatform/generated/inspector.json', import.meta.url);
 await writeFile(output, JSON.stringify(catalog) + '\n');
 console.log(JSON.stringify({ cssProperties: Object.keys(properties).length, cssTypesAndFunctions: Object.keys(types).length, htmlAndAriaAttributes: Object.keys(attributes).length, ariaRoles: roles.length }));
}

export async function readInspectorSources() {
 return Promise.all([htmlUrl, ariaUrl, inputUrl].map(async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.text();
 }));
}
