import { PageShell } from '../components/Layout/PageShell';
import { MONGODB_STATUS_SECTIONS } from '../components/MongoDB/mongodbStatusSections';

// /mongodb-status renders the SAME section list its site doc seeds (see
// components/MongoDB/mongodbStatusSections.tsx) — the page IS its block
// composition, pixel-identically, with one source of truth. Data comes from
// the sections' shared module-cached hook (optimistic: cached state paints
// instantly, a background refetch reconciles) instead of a
// navigation-blocking route loader.
export default function MongoStatusPage() {
  return (
    <PageShell width={760}>
      {MONGODB_STATUS_SECTIONS.map((section) => (
        <section.Component key={section.key} />
      ))}
    </PageShell>
  );
}
