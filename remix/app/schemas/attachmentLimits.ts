// Posts store attachments as relational children, with no per-post count cap.
// Messages and file selections also have no item-count ceiling. Byte quotas and
// request-body limits are enforced independently by the upload/API services.
export const MAX_POST_ATTACHMENTS = Number.POSITIVE_INFINITY;
export const MAX_ATTACHMENTS_PER_TARGET = 25;
export const attachmentCountLimit = (purpose: string = 'post'): number => (['post', 'comment', 'message', 'file', 'file-import'].includes(purpose) ? MAX_POST_ATTACHMENTS : MAX_ATTACHMENTS_PER_TARGET);
