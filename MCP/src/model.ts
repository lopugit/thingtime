import { z } from 'zod';

export const attachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string().nullable().default(null),
  sizeBytes: z.number().int().nonnegative().nullable().default(null),
  sourcePath: z.string().nullable().default(null),
  sourceUrl: z.string().nullable().default(null),
  sha256: z.string().nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const messagePartSchema = z.object({
  type: z.enum(['text', 'json', 'file', 'image', 'audio', 'tool-call', 'tool-result', 'unknown']),
  text: z.string().nullable().default(null),
  data: z.unknown().optional()
});

export const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system', 'tool', 'unknown']),
  authorName: z.string().nullable().default(null),
  createdAt: z.string().datetime().nullable().default(null),
  updatedAt: z.string().datetime().nullable().default(null),
  parts: z.array(messagePartSchema).default([]),
  attachments: z.array(attachmentSchema).default([]),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const conversationSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string(),
  source: z.object({
    app: z.string(),
    connector: z.string(),
    accountId: z.string().nullable().default(null),
    workspaceId: z.string().nullable().default(null)
  }),
  title: z.string(),
  createdAt: z.string().datetime().nullable().default(null),
  updatedAt: z.string().datetime().nullable().default(null),
  participants: z.array(z.object({ id: z.string(), name: z.string(), role: z.string().nullable().default(null) })).default([]),
  messages: z.array(messageSchema).default([]),
  attachments: z.array(attachmentSchema).default([]),
  settings: z.record(z.string(), z.unknown()).default({}),
  metadata: z.record(z.string(), z.unknown()).default({}),
  provenance: z.object({
    importedAt: z.string().datetime(),
    sourcePath: z.string().nullable().default(null),
    sourceSha256: z.string().nullable().default(null)
  })
});

export const snapshotSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  sourceApp: z.string(),
  connector: z.string(),
  exportedAt: z.string().datetime().nullable().default(null),
  importedAt: z.string().datetime(),
  conversations: z.array(conversationSchema),
  files: z.array(attachmentSchema).default([]),
  settings: z.record(z.string(), z.unknown()).default({}),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export type Attachment = z.infer<typeof attachmentSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
