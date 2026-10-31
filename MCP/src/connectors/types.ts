import type { Snapshot } from '../model.js';

export type ConnectorContext = {
  sourcePath: string | null;
  sourceSha256: string | null;
  includeRawMetadata: boolean;
  now: string;
};

export type Connector = {
  id: string;
  app: string;
  description: string;
  detect(input: unknown): number;
  normalize(input: unknown, context: ConnectorContext): Snapshot;
};
