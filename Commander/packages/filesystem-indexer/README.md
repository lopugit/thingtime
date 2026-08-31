# `@commander/filesystem-indexer`

Typed Node client for the standalone Rust `commander-indexer` process. The
package has no Commander UI dependency, so Electron and future Thingtime
desktop hosts can spawn the same binary and share its JSON-lines contract.

```ts
import { FileSystemIndexerClient } from '@commander/filesystem-indexer';

const indexer = new FileSystemIndexerClient({
  binaryPath: '/path/to/commander-indexer',
  databasePath: '/path/to/files.sqlite3',
});

await indexer.index(
  {
    ...configuration,
    resourceLimits: {
      maxThreads: 2,
      maxParallelism: 2,
      maxOpenDirectories: 16,
      maxCpuPercent: 60,
      maxMemoryMiB: 512,
    },
  },
  undefined,
  (progress) => console.log(progress.sourceId, progress.processed, progress.indexed),
);
const { records } = await indexer.query({ query: 'invoice', kinds: ['file'], limit: 30 });
await indexer.close();
```

Use separate reader and writer clients against the same database if a host
wants searches to continue against the last committed snapshot while a large
background scan is running. SQLite WAL mode makes this safe.

For a dynamic mounted-volume inventory, send stable source IDs and set
`pruneSourcePrefixes` (for example `['filesystem:']`). Once all configured
sources complete successfully, records from that namespace whose source is no
longer present are removed; unrelated namespaces are retained.

Resource limits are optional and use the Rust engine's balanced defaults when
omitted. A completed `IndexReport.resources` records the effective worker count,
logical CPU count, average whole-machine CPU share, peak resident memory,
throttle time, queue capacity, and SQLite cache budget. A host can also supply a
per-call timeout as the second argument to `index(configuration, timeoutMs)`.
An optional third argument receives correlated, per-source progress events while
the long-running index request remains pending. Clients that do not supply it
remain wire-compatible with the final report-only behavior.
