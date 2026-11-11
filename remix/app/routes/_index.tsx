import { LANDING_SECTIONS, LandingShell } from '~/components/Landing/landingSections';

// The front page — the v2-fable launch landing (docs/design/claude-design-
// mockup-v2-fable), rendered as its ordered native SECTION list (see
// components/Landing/landingSections.tsx). The live 'Content' editor that
// used to render here now powers the landing's demo card, so the front page
// stays a real Thingtime. The landing owns its own full-bleed layout, so the
// sections render inside LandingShell rather than a PageShell column —
// pixel-identical to the pre-section page.
export default function Index() {
	return (
		<LandingShell>
			{LANDING_SECTIONS.map((section) => (
				<section.Component key={section.key} />
			))}
		</LandingShell>
	);
}
