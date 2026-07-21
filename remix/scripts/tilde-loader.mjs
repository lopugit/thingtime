// Node resolve hook that maps the Vite `~/` alias to remix/app/, so the
// API test definitions (written for the browser bundle) import cleanly under
// plain `node` (type-stripping handles the .ts files themselves).
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');

const withExtension = (basePath) => {
  const candidates = [basePath, `${basePath}.ts`, `${basePath}.tsx`, `${basePath}.mts`, path.join(basePath, 'index.ts')];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return basePath;
};

export const resolve = (specifier, context, nextResolve) => {
  if (specifier.startsWith('~/')) {
    const mapped = withExtension(path.join(appDir, specifier.slice(2)));
    return nextResolve(pathToFileURL(mapped).href, context);
  }
  // relative imports inside app/ may also be extensionless TS
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.includes('/app/')) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const mapped = withExtension(path.resolve(parentDir, specifier));
    if (mapped !== path.resolve(parentDir, specifier)) {
      return nextResolve(pathToFileURL(mapped).href, context);
    }
  }
  return nextResolve(specifier, context);
};
