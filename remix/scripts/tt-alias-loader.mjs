// ESM resolve hook: maps the app's `~/*` import alias (tsconfig paths) onto
// remix/app/* so Node can import app TypeScript modules directly (Node ≥ 23
// strips types natively). Registered by scripts/run-api-tests.mjs.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const CANDIDATE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'];

const resolveWithSuffixes = (base, context, nextResolve) => {
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    if (existsSync(candidate)) {
      return nextResolve(pathToFileURL(candidate).href, context);
    }
  }
  return null;
};

export const resolve = (specifier, context, nextResolve) => {
  if (specifier.startsWith('~/')) {
    const resolved = resolveWithSuffixes(join(appDir, specifier.slice(2)), context, nextResolve);
    if (resolved) return resolved;
  }

  // TS-style extensionless relative imports (./apiTestRunner) inside app code.
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    const base = fileURLToPath(new URL(specifier, context.parentURL));
    if (!existsSync(base)) {
      const resolved = resolveWithSuffixes(base, context, nextResolve);
      if (resolved) return resolved;
    }
  }

  return nextResolve(specifier, context);
};
