// Registers the ~/ alias + extensionless-.ts resolve hook for `node --test`
// runs, so unit suites can import app modules the way Vite/tsconfig resolve
// them. Use via: node --import ./scripts/register-ts-hook.mjs --test <files>
import { register } from 'node:module';

register('./ts-alias-loader.mjs', import.meta.url);
