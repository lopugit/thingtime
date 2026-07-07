import { Landing } from '~/components/Landing/Landing';

// The front page — the v2-fable launch landing (docs/design/claude-design-
// mockup-v2-fable). The live 'Content' editor that used to render here now
// powers the landing's demo card, so the front page stays a real Thingtime.
export default function Index() {
	return <Landing />;
}
