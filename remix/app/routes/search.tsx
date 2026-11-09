import { SearchPage } from '~/components/Search/SearchPage';

export default function Search() {
  return <SearchPage />;
}


// Optional shared preview copy. Route discovery works without this override.
export const socialPreview = {
  "title": "Search Thingtime",
  "description": "Find the people, posts and things that matter to you.",
  "eyebrow": "THINGTIME · SEARCH",
  "badges": [
    "People",
    "Posts",
    "Things"
  ],
  "variant": "collection"
} as const;
