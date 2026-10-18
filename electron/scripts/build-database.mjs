import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'MCP/package.json'));
const { build } = require('esbuild');
await build({
	stdin: { contents: "export { MongoClient } from 'mongodb';", resolveDir: path.join(root, 'remix') },
	outfile: path.join(root, 'electron/dist/database/driver.cjs'),
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'node22',
	legalComments: 'none',
	// Optional cloud authentication/encryption extensions are not used to
	// bootstrap this app-owned MongoDB server.
	external: ['kerberos', '@mongodb-js/zstd', '@aws-sdk/credential-providers', 'gcp-metadata', 'snappy', 'socks', 'mongodb-client-encryption']
});
