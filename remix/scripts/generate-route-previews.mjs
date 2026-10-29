import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));
const variants = new Set(['app', 'invite', 'feed', 'explore', 'docs', 'collection', 'text-post', 'image-post', 'gallery', 'poll', 'listing', 'thingtime', 'share', 'comment', 'reply', 'media-image', 'media-video', 'media-audio', 'media-file', 'webpage', 'profile', 'thing']);
const copyFields = new Set(['title', 'description', 'eyebrow', 'pageTitle', 'revision']);
const unwrap = (node) => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node))) node = node.expression;
  return node;
};
const literal = (node) => {
  node = unwrap(node);
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
};
const property = (node, key) => node.properties.find((entry) => ts.isPropertyAssignment(entry) && (ts.isIdentifier(entry.name) ? entry.name.text : literal(entry.name)) === key)?.initializer;
const safeCopy = (value) => typeof value === 'string' && !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character === '\u2028' || character === '\u2029');

// Only explicitly exported literal data is read. Never evaluate component code,
// browser loaders, JSX text, imports, getters, spreads or interpolated strings.
const previewOverride = (source) => {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'socialPreview') continue;
      const object = unwrap(declaration.initializer);
      if (!object || !ts.isObjectLiteralExpression(object)) continue;
      const result = {};
      for (const entry of object.properties) {
        if (!ts.isPropertyAssignment(entry)) continue;
        const key = ts.isIdentifier(entry.name) ? entry.name.text : literal(entry.name);
        const value = literal(entry.initializer);
        if (copyFields.has(key) && safeCopy(value)) result[key] = value;
        if (key === 'variant' && variants.has(value)) result.variant = value;
        if (key === 'badges') {
          const array = unwrap(entry.initializer);
          if (array && ts.isArrayLiteralExpression(array) && array.elements.every((item) => safeCopy(literal(item)))) result.badges = array.elements.map(literal);
        }
      }
      return result;
    }
  }
  return {};
};

export const extractRoutePreviews = ({ root = defaultRoot, routesFile = resolve(root, 'app/routes.tsx'), read = (file) => readFileSync(file, 'utf8') } = {}) => {
  const appRoot = resolve(root, 'app');
  const files = new Set([routesFile]);
  const parse = (file) => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const source = parse(routesFile);
  const imports = new Map();
  const routerBindings = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = literal(statement.moduleSpecifier);
    const clause = statement.importClause;
    if (!specifier || !clause) continue;
    if (clause.name) imports.set(clause.name.text, specifier);
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const binding of clause.namedBindings.elements) {
      imports.set(binding.name.text, specifier);
      if (specifier === 'react-router' && (binding.propertyName?.text || binding.name.text) === 'createBrowserRouter') routerBindings.add(binding.name.text);
    }
  }
  const moduleFile = (specifier) => {
    if (!specifier || !(specifier.startsWith('.') || specifier.startsWith('~/'))) return null;
    const base = specifier.startsWith('~/') ? resolve(appRoot, specifier.slice(2)) : resolve(dirname(routesFile), specifier);
    const local = relative(appRoot, base);
    if (local.startsWith('..') || isAbsolute(local)) return null;
    const candidates = [base, ...['.tsx', '.ts', '.jsx', '.js'].map((suffix) => base + suffix), ...['index.tsx', 'index.ts'].map((name) => resolve(base, name))];
    const found = candidates.find((file) => extname(file) && existsSync(file));
    // A developer can save the route import before its new module. Watching
    // the unresolved candidates makes the subsequent file-add update previews.
    if (!found) for (const file of candidates) if (extname(file)) files.add(file);
    return found || null;
  };
  const overrides = new Map();
  const readOverride = (specifier) => {
    const file = moduleFile(specifier);
    if (!file) return {};
    files.add(file);
    if (!overrides.has(file)) overrides.set(file, previewOverride(parse(file)));
    return overrides.get(file);
  };
  const routeModule = (route) => {
    const element = unwrap(property(route, 'element'));
    const tag = element && (ts.isJsxSelfClosingElement(element) ? element.tagName : ts.isJsxElement(element) ? element.openingElement.tagName : null);
    if (tag && ts.isIdentifier(tag)) return imports.get(tag.text);
    const lazy = property(route, 'lazy');
    let specifier;
    const visit = (node) => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) specifier ||= literal(node.arguments[0]);
      ts.forEachChild(node, visit);
    };
    if (lazy) visit(lazy);
    return specifier;
  };
  const entries = [];
  const walk = (array, parent = '/') => {
    array = unwrap(array);
    if (!array || !ts.isArrayLiteralExpression(array)) return;
    for (const entry of array.elements) {
      const route = unwrap(entry);
      if (!ts.isObjectLiteralExpression(route)) continue;
      const path = literal(property(route, 'path'));
      const index = property(route, 'index')?.kind === ts.SyntaxKind.TrueKeyword;
      if (path === undefined && !index) { walk(property(route, 'children'), parent); continue; }
      const pattern = path?.startsWith('/') ? path : [parent.replace(/\/$/, ''), path || ''].join('/').replace(/\/$/, '') || '/';
      const specifier = routeModule(route);
      // Splat values and unknown pages never become preview text. The normal
      // public Thing/page resolver can still resolve supported dynamic content.
      if (!pattern.includes('*')) {
        const label = pattern.split('/').filter((segment) => segment && !segment.startsWith(':')).map((segment) => segment.replace(/\?$/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase()).replace(/\b(?:Api|Sdk|Mcp|Ui|Url|Id)\b/g, (word) => word.toUpperCase())).join(' ') || 'Home';
        entries.push({ pattern, label, ...(index ? { index: true } : {}), ...(property(route, 'caseSensitive')?.kind === ts.SyntaxKind.TrueKeyword ? { caseSensitive: true } : {}), preview: readOverride(specifier) });
      }
      walk(property(route, 'children'), pattern);
    }
  };
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && routerBindings.has(node.expression.text)) walk(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!entries.length) throw new Error('Could not discover the application route tree.');
  // Stable sorting preserves the router's first-match order for equal patterns.
  entries.sort((left, right) => left.pattern.localeCompare(right.pattern, 'en'));
  return { entries, files: [...files] };
};

export const generateRoutePreviews = (options = {}) => {
  const root = options.root || defaultRoot;
  const target = options.target || resolve(root, 'app/utils/automaticRoutePreviews.generated.json');
  const result = extractRoutePreviews(options);
  const content = JSON.stringify(result.entries, null, 2) + '\n';
  const changed = !existsSync(target) || readFileSync(target, 'utf8') !== content;
  if (changed) writeFileSync(target, content);
  return { ...result, target, changed };
};

export const automaticRoutePreviewsPlugin = () => {
  let current = generateRoutePreviews();
  return {
    name: 'thingtime-automatic-route-previews',
    buildStart() {
      current = generateRoutePreviews();
      for (const file of current.files) this.addWatchFile(file);
    },
    configureServer(server) {
      server.watcher.add(current.files);
      const refresh = (file) => {
        if (!current.files.includes(file)) return;
        try { current = generateRoutePreviews(); server.watcher.add(current.files); }
        catch (error) { server.config.logger.error(`[route previews] ${error.message}`); }
      };
      server.watcher.on('change', refresh);
      server.watcher.on('add', refresh);
      server.watcher.on('unlink', refresh);
      server.httpServer?.once('close', () => {
        server.watcher.off('change', refresh);
        server.watcher.off('add', refresh);
        server.watcher.off('unlink', refresh);
      });
    }
  };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = generateRoutePreviews();
  console.log(`Generated automatic previews for ${result.entries.length} routes${result.changed ? '' : ' (unchanged)'}.`);
}
