import { useSearchParams } from 'react-router';
import { ErrorLogsPage } from '~/components/Things/ErrorLogsPage';
import { ThingsPage } from '~/components/Things/ThingsPage';

export default function Things() {
  const [params] = useSearchParams();
  return params.get('logs') === '1' ? <ErrorLogsPage /> : <ThingsPage />;
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
