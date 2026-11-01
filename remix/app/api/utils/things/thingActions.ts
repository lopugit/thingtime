import { requestRecordingHandoff } from '../lopu/recordingHandoff';
import { parseThingActionRequest } from '~/schemas/thingActions';

// Canonical semantic-action dispatch beside generic Thing CRUD. Kind-specific
// operations retain their protected writers: a common API is not a permission
// bypass or a generic patch of attachment/control-plane state.
export const dispatchThingAction = async (ownerId: string, input: unknown) => {
  const request = parseThingActionRequest(input);
  switch (request.action) {
    case 'send-to-lopu':
      // This writer re-resolves the owned, private, ready recording and checks
      // processor consent before queuing. No client metadata grants authority.
      return requestRecordingHandoff(ownerId, request.id);
  }
};
