import { ComponentsBrowsePage } from '~/components/ComponentsLibrary/ComponentsBrowsePage';

// /components — the UI-first sibling of /schemas: browse Thingtime UI
// components, tweak their args live, expand the underlying schema, and save
// versions to your Things.
export default function Components() {
	return <ComponentsBrowsePage />;
}


// Optional shared preview copy. Route discovery works without this override.
export const socialPreview = {
  "title": "Thingtime components",
  "description": "Reusable interface pieces, ready to explore and make your own.",
  "eyebrow": "THINGTIME · COMPONENTS",
  "badges": [
    "Composable",
    "Shareable"
  ],
  "variant": "collection"
} as const;
