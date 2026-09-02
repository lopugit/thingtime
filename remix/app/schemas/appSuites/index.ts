// The installable APP suites — whole apps rebuilt as behaviour suites
// (schemas + components + actions + data + pages). Importing this module
// registers them, so every consumer that materialises, seeds, installs, or
// lists suites imports from HERE and iterates ALL_SUITES: the demo originals
// keep `demo-` slugs, the apps get `app-` slugs (behaviourSuites.suiteSlug).

import { BEHAVIOUR_SUITES, registerAppSuite, type BehaviourSuite } from '../behaviourSuites';
import { pokeworldSuite } from './pokeworld';
import { starsalignSuite } from './starsalign';

registerAppSuite(pokeworldSuite);
registerAppSuite(starsalignSuite);

export const APP_SUITE_LIST: BehaviourSuite[] = [pokeworldSuite, starsalignSuite];

export const ALL_SUITES: BehaviourSuite[] = [...BEHAVIOUR_SUITES, ...APP_SUITE_LIST];

export { pokeworldSuite, starsalignSuite };
