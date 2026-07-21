// Minimal ESM resolve hook so plain `node` can run the TypeScript API-test
// modules directly (Node strips the types; this only fixes specifier
// resolution). Two gaps versus the Vite/tsconfig resolver:
//   1. the `~/…` path alias → the app/ directory
//   2. extensionless relative imports (`./apiTestRunner`) → the `.ts` file
// Scope is deliberately tiny: it exists to run app/tests/api/* headlessly, not
// to be a general loader.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

const appDir = fileURLToPath(new URL('../app/', import.meta.url));

export async function resolve(specifier, context, nextResolve) {
  // ~/x → <app>/x
  if (specifier.startsWith('~/')) {
    const target = `${appDir}${specifier.slice(2)}`;
    const withExt = existsSync(target) ? target : existsSync(`${target}.ts`) ? `${target}.ts` : target;
    return nextResolve(pathToFileURL(withExt).href, context);
  }

  // extensionless relative import that is actually a .ts file on disk
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]s$/.test(specifier)) {
    const resolvedUrl = new URL(specifier, context.parentURL);
    if (existsSync(`${fileURLToPath(resolvedUrl)}.ts`)) {
      return nextResolve(`${specifier}.ts`, context);
    }
  }

  return nextResolve(specifier, context);
}
