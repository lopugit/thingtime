import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';
/** The client relies on these contracts to preserve complete shared content.
 * Transport batches and storage admission are separate from product content. */
export const SHARED_CONTENT_REQUIREMENTS = {
 'api.things': '1.51.0', 'api.things-update': '1.20.0', 'api.things-comment': '1.11.0',
 'api.things-import': '1.13.0', 'api.things-bulk': '1.7.0', 'api.things-share': '1.4.0',
 'api.things-feed': '1.9.0', 'api.things-user': '1.8.0', 'api.things-search': '1.4.0', 'api.things-export': '1.16.0',
 'api.chats-messages': '1.4.0', 'api.chats-messages-edit': '1.2.0',
 'api.attachment-uploads': '1.10.0', 'api.attachment-upload-complete': '1.7.0',
 'api.attachment-annotate': '1.3.0', 'api.attachment-link': '1.2.0', 'api.attachment-content': '1.18.0', 'api.files': '1.12.0'
} as const;
export const sharedContentWrite = (args: any): boolean => Boolean(args && (
 args.text !== undefined || args.richText !== undefined || args.tags !== undefined || args.crystal !== undefined || args.thing !== undefined ||
 (Array.isArray(args.thingtime) && args.thingtime.some((kind: unknown) => ['post', 'comment', 'data'].includes(String(kind))))
));
export const requireSharedContentCapability = (feature: keyof typeof SHARED_CONTENT_REQUIREMENTS, options?: { expectedApiOrigin?: string }) =>
 requireThingtimeCapability(feature, SHARED_CONTENT_REQUIREMENTS[feature], options?.expectedApiOrigin ?? window.location.origin);
