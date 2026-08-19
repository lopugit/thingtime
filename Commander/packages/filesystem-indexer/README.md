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

await indexer.index(configuration);
const { records } = await indexer.query({ query: 'invoice', kinds: ['file'], limit: 30 });
await indexer.close();
```

Use separate reader and writer clients against the same database if a host
wants searches to continue against the last committed snapshot while a large
background scan is running. SQLite WAL mode makes this safe.
