export type GroupMemberChange = { id: string; addMemberIds?: string[]; removeMemberIds?: string[] };
export type GroupMemberRead = { id: string; memberCount: number; members: Array<{ id: string }> };

// Pure transport coordinator so an interrupted response can be tested with
// controlled ordering. The caller supplies one pinned actor/origin/plane and
// an identity guard; this function never guesses another account or deletes.
export const applyGroupMemberBatches = async (
  args: GroupMemberChange,
  deps: {
    guard: () => void;
    submit: (body: GroupMemberChange) => Promise<any>;
    read: () => Promise<GroupMemberRead | undefined>;
  }
) => {
  const added = args.addMemberIds || [], removed = args.removeMemberIds || [];
  if (added.some((id) => removed.includes(id))) throw new Error('A member cannot be added and removed together');
  let result: any = { membership: { id: args.id, memberCount: 0 } };
  for (let offset = 0; offset < Math.max(added.length, removed.length, 1); offset += 100) {
    deps.guard();
    const addMemberIds = added.slice(offset, offset + 100), removeMemberIds = removed.slice(offset, offset + 100);
    try {
      result = await deps.submit({ id: args.id, addMemberIds, removeMemberIds });
      deps.guard();
    } catch (error) {
      deps.guard();
      if ((error as any)?.outcome !== 'unknown') throw error;
      try {
        const group = await deps.read();
        deps.guard();
        if (!group) throw new Error('Group readback unavailable');
        const members = new Set(group.members.map((member) => member.id));
        const missingAdd = addMemberIds.filter((id) => !members.has(id));
        const missingRemove = removeMemberIds.filter((id) => members.has(id));
        // A later tab may have deliberately reversed a committed mutation.
        // The snapshot cannot distinguish that from a failed mutation, so a
        // divergent readback must never trigger an automatic replay.
        if (missingAdd.length || missingRemove.length) throw new Error('Membership differs after an uncertain write');
        result = { membership: { id: args.id, memberCount: group.memberCount } };
      } catch {
        deps.guard();
        const uncertain = new Error('Group membership may be incomplete. Check it in the original account before using it.');
        (uncertain as any).groupId = args.id;
        throw uncertain;
      }
    }
  }
  return result;
};
