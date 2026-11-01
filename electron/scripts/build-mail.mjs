import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'MCP/package.json'));
const { build } = require('esbuild');
await build({
  entryPoints: [path.join(root, 'remix/app/api/utils/mail/provider.ts')],
  outfile: path.join(root, 'electron/dist/mail/provider.cjs'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', legalComments: 'none'
});
