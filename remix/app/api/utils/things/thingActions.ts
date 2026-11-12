import { getLibraryArchiveAction, setLibraryArchive, type Fail } from './things';
import { requestRecordingHandoff } from '../lopu/recordingHandoff';
import { parseThingActionRequest } from '~/schemas/thingActions';

// Canonical semantic-action dispatch beside generic Thing CRUD. Kind-specific
// operations retain their protected writers: a common API is not a permission
// bypass or a generic patch of attachment/control-plane state.
export type ThingActionResult = Fail | { ok: true; id?: string; ownerId?: string; libraryArchived?: boolean; message?: string; status?: undefined; error?: undefined };
export const dispatchThingAction = async (ownerId: string, input: unknown): Promise<ThingActionResult> => {
  const request = parseThingActionRequest(input);
  switch (request.action) {
    case 'archive': case 'restore': return setLibraryArchive(ownerId, request.id, request.action);
    case 'send-to-lopu':
      // This writer re-resolves the owned, private, ready recording and checks
      // processor consent before queuing. No client metadata grants authority.
      return requestRecordingHandoff(ownerId, request.id);
  }
};

export const availableThingActions = getLibraryArchiveAction;
