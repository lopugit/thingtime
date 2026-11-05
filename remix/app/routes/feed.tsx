import { FeedPage } from '~/components/Feed/Feed';

export default function Feed() {
  return <FeedPage />;
}


// Optional shared preview copy. Route discovery works without this override.
export const socialPreview = {
  "title": "Your Thingtime feed",
  "description": "Posts, photos, polls, finds and little moments from your people.",
  "eyebrow": "THINGTIME · FEED",
  "badges": [
    "Fresh things",
    "People you follow"
  ],
  "variant": "feed"
} as const;
