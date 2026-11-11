import type { SavedPasswordFile } from './files.client';

export function backupFilePath(file: SavedPasswordFile) {
  const original = file.metadata.archivePath?.split('/').at(-1);
  const name = original?.includes('___') ? original.slice(original.indexOf('___') + 3) : file.metadata.name;
  return `files/${file.id}___${name.replace(/[\\/]/g, '_')}`;
}

// Standard 1PUX document/icon references use the filename's id prefix. Rebase
// these references while preserving the untouched source in the vendor entry.
export function patchBackupFileReferences(item: any, files: SavedPasswordFile[]) {
  const ids = new Map<string, string>(), paths = new Map<string, string>();
  for (const file of files) {
    const original = file.metadata.archivePath, name = original?.split('/').at(-1);
    if (original) paths.set(original, backupFilePath(file));
    if (name?.includes('___')) ids.set(name.slice(0, name.indexOf('___')), file.id);
  }
  const visit = (value: any) => {
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (key === 'thingtime') continue;
      const field = value[key];
      if (typeof field === 'string' && /^(documentid|fileid|iconid|icon|avatar|path)$/i.test(key)) value[key] = paths.get(field) || ids.get(field) || field;
      else if (field && typeof field === 'object') visit(field);
    }
  };
  visit(item);
}
