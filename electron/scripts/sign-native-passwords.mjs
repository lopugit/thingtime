import { parseOptions, signRelease } from './password-provider-release.mjs';
const options = parseOptions(process.argv.slice(2), ['--manifest', '--sha256', '--output']);
const result = await signRelease({ manifest: options['--manifest'], sha256: options['--sha256'], output: options['--output'] });
console.log(`Verified signed companion staged at ${result.app}; no app was installed or launched.`);
