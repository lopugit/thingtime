import { chatGptConnector } from './chatgpt.js';
import { claudeConnector } from './claude.js';
import { manifestConnector } from './manifest.js';
import { normalizedConnector } from './normalized.js';
import type { Connector } from './types.js';

export const connectors: Connector[] = [normalizedConnector, manifestConnector, chatGptConnector, claudeConnector];

export function selectConnector(input: unknown, requested?: string): Connector {
  if (requested) {
    const connector = connectors.find((entry) => entry.id === requested);
    if (!connector) throw new Error(`Unknown connector: ${requested}`);
    return connector;
  }
  const ranked = connectors.map((connector) => ({ connector, score: connector.detect(input) })).sort((a, b) => b.score - a.score);
  if (!ranked[0]?.score) throw new Error('Archive format not recognized. Use the portable ai-desktop-manifest-v1 format.');
  return ranked[0].connector;
}

export type { ConnectorContext } from './types.js';
