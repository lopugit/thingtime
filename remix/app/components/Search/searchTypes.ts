// Client-side shapes for /search — mirrors the API's PublicThing/PublicPost
// projections (the server module imports node builtins, so the client keeps
// its own lean types, same as Feed's feedTypes.ts).

import type { PublicPost } from '~/components/Feed/feedTypes';

export type SearchAuthor = {
  id: string;
  username: string;
  displayName: string | null;
  temporary?: boolean;
  avatarUrl: string | null;
};

export type SearchThing = {
  id: string;
  thingtime: string[];
  author: SearchAuthor | null;
  visibility: string;
  acl: string[];
  targetId: string | null;
  crystal: Record<string, any>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type SearchPost = PublicPost;

// public profile projection from /api/v1/users/search (the People rail)
export type SearchPerson = {
  id: string;
  username: string;
  displayName: string | null;
  temporary?: boolean;
  bio: string | null;
  avatarUrl: string | null;
};

export type SearchResponse = {
  ok: boolean;
  error?: string;
  things: SearchThing[];
  posts: Record<string, SearchPost>;
  nextCursor: string | null;
  total: number | null;
  totalCapped: boolean;
  ranked: boolean;
};

// value coercion hint per condition row — "proper developer datatype searches"
// (dates travel as ISO strings, so 'text' covers them)
export type RowValueType = 'auto' | 'text' | 'number' | 'boolean' | 'null';

// One GUI row of the query builder. `between` is UI sugar that compiles to a
// gte+lte pair; everything else maps 1:1 onto the API operator grammar.
export type ConditionRow = {
  id: string;
  field: string;
  op: string;
  value: string;
  value2: string; // between upper bound
  valueType: RowValueType;
  // prefilled meta from a schema field definition (enum options, number
  // range/unit) — display sugar only, never sent to the API
  meta?: {
    values?: string[];
    min?: number;
    max?: number;
    unit?: string;
    type?: string;
    description?: string;
  };
};

export type SchemaSource = {
  key: string;
  name: string;
  description: string;
  origin: 'builtin' | 'community';
  // community schemas remember their author + thing id for display/deep-links
  author?: string | null;
  shareId?: string;
  usageCount?: number;
  reactions?: number;
  fields: {
    // dotted crystal path (nested object/array fields flatten to paths)
    name: string;
    type: string;
    description?: string;
    values?: string[];
    min?: number;
    max?: number;
    unit?: string;
    maxLength?: number;
  }[];
};
