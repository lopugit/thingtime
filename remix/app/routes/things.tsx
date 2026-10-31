import { ThingsPage } from '~/components/Things/ThingsPage';

export default function Things() {
  return <ThingsPage />;
}


// Optional shared preview copy. Route discovery works without this override.
export const socialPreview = {
  "title": "Your Things",
  "description": "A place for the files, notes, ideas and tiny details you want to keep close.",
  "eyebrow": "THINGTIME · THINGS",
  "badges": [
    "Everything is a thing",
    "Made for keeping"
  ],
  "variant": "collection"
} as const;
