import { waitUntil } from '@vercel/functions';
import { withGatewayWork } from '../deployment/environmentGateway';
import { getThingsCollection } from '../mongodb/collections';
import { findUsersByIds } from '../auth/users';
import { characterAccountLive } from '../auth/characterSession';
import { emitNotificationOnce, type EmitNotificationInput } from '../notifications/notifications';

type Access = (userId: string, chatId: string) => Promise<any>;
const RECIPIENT_BATCH_SIZE = 32;
const DELIVERY_CONCURRENCY = 4;

// Content stays in the membership-gated chat. The request lifetime owns this
// bounded, cursor-paged fanout; a slow delivery never delays the send response.
export const notifyChatMessage = (senderId: string, messageId: string, access: Access): Promise<void> => {
  const task = withGatewayWork(async () => {
    try {
      const things = await getThingsCollection();
      const initial = await things.findOne({ thingtime: 'chat-message', shareId: messageId, ownerId: senderId } as any);
      if (!initial || initial.crystal?.deletedAt || initial.crystal?.systemType || initial.crystal?.externalSource) return;
      const chatId = String(initial.targetId);
      let cursor: string | null = null;
      for (;;) {
        const members: any[] = await things.find({ thingtime: 'chat-member', targetId: chatId, ownerId: { $ne: senderId },
          'crystal.state': { $in: ['active', 'pending'] }, ...(cursor ? { shareId: { $gt: cursor } } : {}) } as any)
          .sort({ shareId: 1 }).limit(RECIPIENT_BATCH_SIZE).toArray();
        if (!members.length) break;
        const ids = [senderId, ...members.map(member => String(member.ownerId))];
        // Batch stable source/user reads for each small delivery wave. Re-read
        // before delivery; every recipient still checks its own live ACL.
        const source = () => Promise.all([
          things.findOne({ thingtime: 'chat-message', shareId: messageId, targetId: chatId, ownerId: senderId } as any),
          access(senderId, chatId), findUsersByIds(ids)
        ]);
        for (let start = 0; start < members.length; start += DELIVERY_CONCURRENCY) {
          const initialSource = await source();
          let deliverySource: ReturnType<typeof source> | null = null;
          await Promise.all(members.slice(start, start + DELIVERY_CONCURRENCY).map(async member => {
            const recipientId = String(member.ownerId);
            let resolved = false;
            let requestMembershipId: string | null = null;
            await emitNotificationOnce(JSON.stringify(['chat-message', messageId, recipientId]), async (): Promise<EmitNotificationInput | null> => {
              const currentSource = resolved ? (deliverySource ||= source()) : initialSource;
              resolved = true;
              const [[message, sender, users], recipient] = await Promise.all([currentSource, access(recipientId, chatId)]);
              if (!message || message.crystal?.deletedAt || message.crystal?.systemType || message.crystal?.externalSource ||
                  !sender.chat || !recipient.chat || sender.member?.crystal?.state !== 'active') return null;
              const actor = users.find((user: any) => String(user._id) === senderId);
              const target = users.find((user: any) => String(user._id) === recipientId);
              if (!actor || !target || !(await characterAccountLive(actor)) || !(await characterAccountLive(target))) return null;
              const state = recipient.member?.crystal?.state;
              if (state !== 'active' && state !== 'pending') return null;
              requestMembershipId = String(recipient.member.shareId);
              return { recipientId, type: state === 'pending' ? 'chat-request' : 'chat-message',
                actor: {
                  id: senderId,
                  username: 'username' in actor && typeof actor.username === 'string' ? actor.username : null,
                  displayName: 'displayName' in actor && typeof actor.displayName === 'string' ? actor.displayName : null
                },
                targetId: chatId, href: state === 'pending' ? '/messages?view=requests' : `/messages?chat=${encodeURIComponent(chatId)}`,
                historyOnly: recipient.member.crystal?.muted === true };
            }, input => input.type === 'chat-request' ? JSON.stringify(['chat-request', chatId, recipientId, requestMembershipId]) : undefined);
          }));
        }
        cursor = String(members[members.length - 1].shareId);
        if (members.length < RECIPIENT_BATCH_SIZE) break;
      }
    } catch {
      console.error('[messenger] notification unavailable');
    }
  });
  waitUntil(task);
  return task;
};
