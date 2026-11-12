import { ConnectionsFeedPage } from '~/components/Connections/ConnectionsFeed';

export default function ConnectionsFeed() {
  return <ConnectionsFeedPage />;
}


// Optional shared preview copy. Route discovery works without this override.
export const socialPreview = {
  "pageTitle": "Connections"
} as const;
