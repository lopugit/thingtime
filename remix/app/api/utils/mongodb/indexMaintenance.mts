// Supervised canonical index reconciliation, without a new remote API or secret.
// Run from remix with its existing home/gateway environment already loaded.
import { ensureIndexes } from './collections.ts';
import { indexExecutionPolicy } from './indexLifecycle.ts';

const args = process.argv.slice(2);
const names = new Map([
  ['--command-timeout-ms', 'commandMaxTimeMS'], ['--lease-ms', 'leaseMs'], ['--wait-ms', 'waitMs']
]);
const options: Record<string, number> = {};
try {
  for (let i = 0; i < args.length; i += 2) {
    const name = names.get(args[i]);
    const value = Number(args[i + 1]);
    if (!name || !Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid index-maintenance option.');
    options[name] = value;
  }
  const policy = indexExecutionPolicy(options);
  console.log(`[mongodb] Reconciling canonical index plan; command budget ${policy.commandMaxTimeMS}ms, renewable lease ${policy.leaseMs}ms.`);
  await ensureIndexes({ force: true, ...policy });
  console.log('[mongodb] Canonical index plan is ready.');
  process.exit(0);
} catch {
  // Driver errors may contain a credential-bearing URI; never echo them here.
  console.error('[mongodb] Index reconciliation failed. Verify the selected home/gateway environment and lease, inspect protected server diagnostics, and retry with a command budget fitting within one third of the lease (including 5s margin).');
  process.exit(1);
}
