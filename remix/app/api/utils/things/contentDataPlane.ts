import { mongoDataPlane } from '../mongodb/dataPlane';
import { getBoundNativeContentDataPlane } from './persistenceContext';

/** The active host supplies a public comparison identity. Request/query values
 * never select it, and an unavailable native binding never borrows Mongo. */
export const contentDataPlane = (): string => getBoundNativeContentDataPlane() ?? mongoDataPlane();
