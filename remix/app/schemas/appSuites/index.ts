// The installable APP suites — whole apps rebuilt as behaviour suites
// (schemas + components + actions + data + pages). Importing this module
// registers them, so every consumer that materialises, seeds, installs, or
// lists suites imports from HERE and iterates ALL_SUITES: the demo originals
// keep `demo-` slugs, the apps get `app-` slugs (behaviourSuites.suiteSlug).

import { BEHAVIOUR_SUITES, registerAppSuite, type BehaviourSuite } from '../behaviourSuites.ts';
import { pokeworldSuite } from './pokeworld.ts';
import { starsalignSuite } from './starsalign.ts';
import { dustedSuite } from './dusted.ts';
import { thingmonSuite } from './thingmon.ts';
import { snapquestSuite } from './snapquest.ts';
import { branchwoodSuite } from './branchwood.ts';

registerAppSuite(pokeworldSuite);
registerAppSuite(starsalignSuite);
registerAppSuite(dustedSuite);
registerAppSuite(thingmonSuite);
registerAppSuite(snapquestSuite);
registerAppSuite(branchwoodSuite);

export const APP_SUITE_LIST: BehaviourSuite[] = [pokeworldSuite, starsalignSuite, dustedSuite, thingmonSuite, snapquestSuite, branchwoodSuite];

export const ALL_SUITES: BehaviourSuite[] = [...BEHAVIOUR_SUITES, ...APP_SUITE_LIST];

export { pokeworldSuite, starsalignSuite, dustedSuite, thingmonSuite, snapquestSuite, branchwoodSuite };
