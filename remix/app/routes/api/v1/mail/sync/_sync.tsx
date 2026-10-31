// Same full-session, origin, rate, owner and redaction boundary as stored mail.
import { createMailHandler } from '../_mail';
export const action = createMailHandler({}, true);
export const loader = action;
