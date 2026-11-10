import { useCurrentUser } from '~/hooks/useCurrentUser';
import { WELCOME_SECTIONS, WelcomeShell } from '~/components/Welcome/welcomeSections';

// /welcome renders the SAME section list its site doc seeds (see
// Builder/nativeSections.tsx + components/Welcome/welcomeSections.tsx) — the
// page IS its block composition, pixel-identically, with one source of
// truth. The page is full-bleed (no PageShell): this route keeps its own
// centering wrapper exactly as before and composes the sections inside it.
export default function Welcome() {
	const user = useCurrentUser();

	if (!user) return null;

	return (
		<WelcomeShell>
			{WELCOME_SECTIONS.map(({ key, Component }) => (
				<Component key={key} />
			))}
		</WelcomeShell>
	);
}
