import { PageShell } from '../components/Layout/PageShell';
import { ODE_SECTIONS } from '../components/Ode/odeSections';

// /ode renders its native SECTION list (components/Ode/odeSections.tsx) —
// the page IS its block composition, pixel-identically. The list is imported
// locally (not through Builder/nativeSections.tsx) until the coordinator
// wires the central registry + seed entry for 'ode'.
export default function Index() {
	return (
		<PageShell width={680}>
			{ODE_SECTIONS.map((section) => (
				<section.Component key={section.key} />
			))}
		</PageShell>
	);
}
