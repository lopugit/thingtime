import { SchemasBrowsePage } from '~/components/Schemas/SchemasBrowsePage';

// /schemas — browse, react to, save, fork, and create Thingtime schemas.
// The registry reference docs moved to /docs/schemas.
export default function Schemas() {
  return <SchemasBrowsePage />;
}


// Optional shared preview copy. Route discovery works without this override.
export const socialPreview = {
  "title": "Thingtime schemas",
  "description": "Browse the building blocks that make every kind of thing understandable.",
  "eyebrow": "THINGTIME · SCHEMAS",
  "badges": [
    "Open building blocks",
    "Make it yours"
  ],
  "variant": "collection"
} as const;
