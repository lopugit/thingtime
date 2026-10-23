// Sample schema things — the community half of /schemas, seeded through the
// REAL createThing path (FUNDAMENTALS.md §2: seeded data == real writes).
// Every seed rides a fixed shareId (sample-schema-<slug>) so re-seeding 409s
// into an idempotent skip, exactly like the feed post fixtures.
//
// Constraints (enforced by sanitizeSchemaCrystal — a seed that breaks them
// fails the populate run loudly):
//   name ≤60 chars, description ≤500 chars
//   fields: ≤40 nodes total (children/items count), ≤6 levels deep, names
//     letters/numbers/_/- only; enum ≤30 values × ≤60 chars; unit ≤20 chars
//   render: optional chakra ({ chakra, props, children }) or element
//     ({ tag, props, children }) tree, ≤32KB / ≤600 nodes — drawn only through
//     the sanitising allowlist renderers
//   extended: optional schema-free sidecar payload (any JSON ≤512KB)

import type { SchemaThingField } from '~/schemas/registry';

import { getCoreSchemas } from './schemasCore';
import { getShowcaseSchemas } from './schemasShowcase';

export type SeedSchema = {
  slug: string; // → shareId `sample-schema-<slug>`
  owner: string; // seed username (data/users.ts + data/feed.ts)
  name: string;
  description: string;
  fields: SchemaThingField[];
  // serialised component preview (chakra/element tree)
  render?: Record<string, unknown>;
  tags?: string[];
  // demo sidecar payload — also proves the `extended` pipeline end-to-end
  extended?: Record<string, unknown>;
  // spreads createdAt so the browse feed isn't one timestamp
  ageHours?: number;
};

export const getSampleSchemas = async (): Promise<SeedSchema[]> => [
  ...(await getCoreSchemas()),
  ...(await getShowcaseSchemas())
];
