import { BlobWriter, ZipWriter } from '@zip.js/zip.js';
import { exportOnePasswordItem } from './onePassword';
import type { PasswordStorage } from './storage';
import { iterableStream } from './fileCrypto';
import { backupFilePath, patchBackupFileReferences } from './backupReferences';
// One 1PUX file, with streamed JSON and binary members. Unknown original source
// members remain attached to their archive entry and are included byte-for-byte.
export async function createPasswordBackup(storage: PasswordStorage, signal?: AbortSignal, progress?: (message: string) => void) {
  const writer = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false });
  const encoder = new TextEncoder(), files: { entryId: string; fileId: string; path: string }[] = [];
  const now = Math.floor(Date.now() / 1000);
  const bytes = (value: unknown) => new Blob([JSON.stringify(value)]).stream();
  await writer.add('export.attributes', bytes({ version: 3, description: '1Password Unencrypted Export', createdAt: now }));
  async function* data() {
    yield encoder.encode('{"accounts":[{"attrs":{"accountName":"Thingtime","name":"Thingtime"},"vaults":[{"attrs":{"name":"Passwords","type":"P"},"items":[');
    let cursor: string | undefined, count = 0;
    do {
      signal?.throwIfAborted();
      const page = await storage.exportPage(cursor, signal);
      const records = page.entries;
      await storage.assertFilesAvailable?.([...new Set(records.flatMap(record => [record.id, ...(record.entry.importArchiveId ? [record.entry.importArchiveId] : [])]))], signal);
      const attached = records.length ? await storage.listFiles(records.map(record => record.id), signal, records.flatMap(record => record.entry.importArchiveId ? [record.entry.importArchiveId] : [])) : [];
      for (const record of records) {
        signal?.throwIfAborted(); const item = exportOnePasswordItem(record.entry);
        patchBackupFileReferences(item, attached.filter(file => file.entryId === (record.entry.importArchiveId || record.id)));
        item.details.thingtime.id = record.id;
        item.details.thingtime.files = attached.filter(file => file.entryId === record.id).map(file => {
          const path = backupFilePath(file);
          files.push({ entryId: record.id, fileId: file.id, path });
          return { id: file.id, path, name: file.metadata.name, size: file.metadata.size, archivePath: file.metadata.archivePath, role: file.metadata.role };
        });
        yield encoder.encode(`${count++ ? ',' : ''}${JSON.stringify(item)}`); progress?.(`${count} entries prepared`);
      }
      cursor = page.nextCursor || undefined;
    } while (cursor);
    yield encoder.encode(']}]}]}');
  }
  await writer.add('export.data', iterableStream(data()), { signal });
  for (const [index, file] of files.entries()) {
    signal?.throwIfAborted(); const opened = await storage.openFile(file.entryId, file.fileId, signal);
    await writer.add(file.path, opened.stream, { signal }); progress?.(`${index + 1} of ${files.length} files prepared`);
  }
  return writer.close();
}
