// `node --import ./scripts/register-alias-loader.mjs …` — registers the `~/`
// + extensionless-TS resolve hook (tt-alias-loader.mjs) for node --test runs.
import { register } from 'node:module';

register(new URL('./tt-alias-loader.mjs', import.meta.url), import.meta.url);
