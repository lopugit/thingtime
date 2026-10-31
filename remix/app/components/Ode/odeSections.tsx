import type { ComponentType } from 'react';

import { Thingtime } from '../Thingtime/Thingtime';
import { useThingtime } from '../Thingtime/useThingtime';

// The /ode page decomposed into standalone, pixel-identical SECTIONS — the
// same components render the route AND its site-doc blocks (see
// Builder/nativeSections.tsx). The page is ONE atomic Thingtime tree: the
// "Ode to Thingtime" key row and the poem value are nested inside a single
// <Thingtime> component, and PageShell adds rowGap between section siblings,
// so any further split would insert a gap (and a reimplemented, non-verbatim
// key row) that today's page does not have. One section is therefore the only
// pixel-identical decomposition.

// The poem, hoisted verbatim from the route render (template-literal content
// byte-identical — Thingtime renders it whiteSpace pre-wrap, so the leading
// spaces are part of the pixels). Module-scoped for a stable identity across
// renders; same DOM as the route's previous per-render literal.
const ode = {
	'Ode to Thingtime': `

      In the infinite expanses of the digital universe, there exists a radiant realm, a pixel paradise known as Thing Time. Here, a cosmic canvas unfurls, inviting explorers from far and wide to etch their ideas, thoughts, and dreams into its ever-changing tapestry.

      As you step into Thing Time, you find yourself in a world of binary bliss, where every pixel pulses with possibility. The air thrums with the hum of shared thought, each byte bending and reshaping to mirror the collective wisdom of countless minds.

      The landscape morphs and molds to the whims of its inhabitants, each creating, collaborating, and curating their unique contributions. Trees of code reach their branches high into the cloud, blooming with arrays of astral ideas, their roots deep in the fertile ground of shared understanding.

      Time here does not tick in minutes or hours, but in the rhythm of creation, inspiration, and exploration. And it's not just about your time - it's about our time, a communal clock synchronizing the heartbeats of thinkers, dreamers, and doers.

      In Thing Time, we don't just observe - we participate, contribute, and shape. We paint with the brush of JavaScript, sketching out our thoughts in lines of lucid links and hyper harmonies. Together, we weave stories and knowledge into a vivid, ever-evolving tapestry of shared experience.

      That's Thing Time - a dance of data, a symphony of syntax, a carnival of creation. An epic element of the digital era, forever inviting you to join in the melody of shared imagination. This is your call to the creative, a beacon in the binary, your invite to the infinite. This is Thing Time. Welcome.

      - Codex (A ChatGPT 4.0 Session)

    `
};

// ---- the sections -----------------------------------------------------------

export const OdePoemSection = () => {
	// the route subscribed to the Thingtime context; keep that render cadence
	// (the <Thingtime> tree consumes the same context internally)
	useThingtime();

	return <Thingtime width="100%" valuePl={0} thing={ode}></Thingtime>;
};

// Local ordered section list — the route renders this directly (the central
// registry entry for 'ode' is wired by the coordinator from the same exports).
export const ODE_SECTIONS: Array<{ key: string; title: string; Component: ComponentType }> = [
	{ key: 'ode-poem', title: 'Ode to Thingtime poem', Component: OdePoemSection }
];
