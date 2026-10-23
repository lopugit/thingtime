import { LANDING_SECTIONS, LandingShell } from './landingSections';

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

// The v2-fable launch landing, composed from its native SECTION list — the
// markup moved VERBATIM into landingSections.tsx (nav+hero, demo, use cases,
// ecosystem, developers, back-the-launch, FAQ, footer) so the same components
// render this page AND its site-doc blocks. The tree is pixel-identical to
// the pre-section Landing: LandingShell carries the full-bleed chrome and the
// sections render in the same order.
export const Landing = () => (
	<LandingShell>
		{/* ConfettiCanvas is now mounted app-wide in root.tsx (one canvas for all pages). */}
		{LANDING_SECTIONS.map((section) => (
			<section.Component key={section.key} />
		))}
	</LandingShell>
);
