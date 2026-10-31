import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const keys = ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_CONTENT', 'DEVELOPMENT_TEAM', 'PRODUCT_BUNDLE_IDENTIFIER', 'WATCH_BUNDLE_IDENTIFIER', 'IOS_DISTRIBUTION_CERTIFICATE_ID', 'IOS_DISTRIBUTION_CERT_P12', 'IOS_DISTRIBUTION_CERT_P12_PASSWORD'];
for (const key of keys) {
  const value = process.env[key];
  if (typeof value !== 'string' || !value || /[\r\n\0]/.test(value)) throw new Error(`Missing or invalid ${key}`);
  process.stdout.write(`::add-mask::${value.replaceAll('%', '%25')}\n`);
  const delimiter = `RELEASE_${randomUUID()}`;
  appendFileSync(process.env.GITHUB_ENV, `${key}<<${delimiter}\n${value}\n${delimiter}\n`, { mode: 0o600 });
}
for (const line of Buffer.from(process.env.ASC_KEY_CONTENT, 'base64').toString('utf8').split(/\r?\n/).filter(Boolean)) {
  process.stdout.write(`::add-mask::${line.replaceAll('%', '%25')}\n`);
}
