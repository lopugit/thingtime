import { snapshotSchema } from '../model.js';
import type { Connector } from './types.js';

export const normalizedConnector: Connector = {
  id: 'thingtime-normalized-v1',
  app: 'Thingtime',
  description: 'Thingtime normalized snapshot (schemaVersion 1).',
  detect(input) {
    const raw = input as any;
    return raw?.schemaVersion === 1 && Array.isArray(raw?.conversations) ? 100 : 0;
  },
  normalize(input) {
    return snapshotSchema.parse(input);
  }
};
