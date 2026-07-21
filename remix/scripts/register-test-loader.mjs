// `node --import` entry that registers the ~/-alias + extensionless-TS
// resolver for node --test runs (see tilde-loader.mjs).
import { register } from 'node:module';

register('./tilde-loader.mjs', import.meta.url);
