import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { snapshotSchema, type Attachment, type Snapshot } from './model.js';
import { requireAllowedFile } from './security.js';

export type ImportSummary = {
  id: string;
  sourceApp: string;
  connector: string;
  importedAt: string;
  conversationCount: number;
  messageCount: number;
  attachmentCount: number;
};

export class SnapshotStore {
  readonly root: string;
  constructor(root = process.env.THINGTIME_MCP_STATE_DIR || join(homedir(), '.thingtime', 'mcp')) {
    this.root = resolve(root);
  }

  private importDir(id: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Invalid import id');
    return join(this.root, 'imports', id);
  }

  async save(snapshot: Snapshot): Promise<ImportSummary> {
    this.assertBounds(snapshot);
    const id = randomUUID();
    const dir = this.importDir(id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const staged = structuredClone(snapshot);
    await this.materializeAttachments(staged, dir);
    await writeFile(join(dir, 'snapshot.json'), `${JSON.stringify(staged, null, 2)}\n`, { mode: 0o600 });
    const summary = this.summary(id, staged);
    await writeFile(join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
    return summary;
  }

  async list(): Promise<ImportSummary[]> {
    const base = join(this.root, 'imports');
    const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
    const summaries = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const raw = await readFile(join(base, entry.name, 'summary.json'), 'utf8').catch(() => 'null');
      return JSON.parse(raw) as ImportSummary | null;
    }));
    return summaries.filter((entry): entry is ImportSummary => !!entry).sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }

  async get(id: string): Promise<Snapshot> {
    return snapshotSchema.parse(JSON.parse(await readFile(join(this.importDir(id), 'snapshot.json'), 'utf8')));
  }

  async delete(id: string): Promise<void> {
    await rm(this.importDir(id), { recursive: true, force: true });
  }

  private summary(id: string, snapshot: Snapshot): ImportSummary {
    return {
      id,
      sourceApp: snapshot.sourceApp,
      connector: snapshot.connector,
      importedAt: snapshot.importedAt,
      conversationCount: snapshot.conversations.length,
      messageCount: snapshot.conversations.reduce((sum, conversation) => sum + conversation.messages.length, 0),
      attachmentCount: snapshot.files.length + snapshot.conversations.reduce((sum, conversation) => sum + conversation.attachments.length + conversation.messages.reduce((messageSum, message) => messageSum + message.attachments.length, 0), 0)
    };
  }

  private assertBounds(snapshot: Snapshot): void {
    if (snapshot.conversations.length > 100_000) throw new Error('Import has too many conversations');
    let messages = 0;
    let attachments = snapshot.files.length;
    for (const conversation of snapshot.conversations) {
      messages += conversation.messages.length;
      attachments += conversation.attachments.length;
      for (const message of conversation.messages) attachments += message.attachments.length;
    }
    if (messages > 1_000_000) throw new Error('Import has too many messages');
    if (attachments > 100_000) throw new Error('Import has too many attachments');
    if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > 256 * 1024 * 1024) {
      throw new Error('Normalized import exceeds the 256 MiB staging limit');
    }
  }

  private async materializeAttachments(snapshot: Snapshot, importDir: string): Promise<void> {
    const attachments = [
      ...snapshot.files,
      ...snapshot.conversations.flatMap((conversation) => [
        ...conversation.attachments,
        ...conversation.messages.flatMap((message) => message.attachments)
      ])
    ];
    const copied = new Map<string, Pick<Attachment, 'sourcePath' | 'sha256' | 'sizeBytes'>>();
    for (const attachment of attachments) {
      if (!attachment.sourcePath) continue;
      const sourceBase = snapshot.conversations[0]?.provenance.sourcePath;
      const candidate = isAbsolute(attachment.sourcePath)
        ? attachment.sourcePath
        : sourceBase
          ? resolve(dirname(sourceBase), attachment.sourcePath)
          : null;
      if (!candidate) continue;
      try {
        const source = await requireAllowedFile(candidate);
        const existing = copied.get(source);
        if (existing) {
          Object.assign(attachment, existing);
          continue;
        }
        const attachmentsDir = join(importDir, 'attachments');
        await mkdir(attachmentsDir, { recursive: true, mode: 0o700 });
        const safeName = basename(attachment.name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'attachment';
        const destination = join(attachmentsDir, `${randomUUID()}-${safeName}`);
        await copyFile(source, destination);
        const bytes = await readFile(destination);
        const captured = {
          sourcePath: destination,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          sizeBytes: (await stat(destination)).size
        };
        Object.assign(attachment, captured, { metadata: { ...attachment.metadata, thingtimeCapture: { status: 'copied' } } });
        copied.set(source, captured);
      } catch {
        attachment.metadata = { ...attachment.metadata, thingtimeCapture: { status: 'not-copied' } };
      }
    }
  }
}
