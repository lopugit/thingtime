import { ExplorePage } from '~/components/Explore/ExplorePage';

export default function Explore() {
  return <ExplorePage />;
}


// Optional shared preview copy. Route discovery works without this override.
export const socialPreview = {
  "title": "Explore Thingtime",
  "description": "Discover conversations, photos, polls and useful things worth keeping.",
  "eyebrow": "THINGTIME · EXPLORE",
  "badges": [
    "Trending now",
    "Made by people"
  ],
  "variant": "explore"
} as const;
