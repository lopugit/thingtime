import { PageShell } from '../components/Layout/PageShell';
import { getNativePage, NativeSectionView } from '../components/Builder/nativeSections';

// /status renders the SAME section list its site doc seeds (see
// Builder/nativeSections.tsx + components/Status/statusSections.tsx) — the
// page IS its block composition, pixel-identically, with one source of
// truth. Data comes from the sections' shared module-cached hook
// (optimistic: cached state paints instantly, a background refetch
// reconciles) instead of a navigation-blocking route loader.
export default function StatusPage() {
	const page = getNativePage('status')!;
	return (
		<PageShell width={page.shellWidth === 'full' ? undefined : page.shellWidth}>
			{page.sections.map((section) => (
				<NativeSectionView key={section.key} sectionKey={section.key} />
			))}
		</PageShell>
	);
}
