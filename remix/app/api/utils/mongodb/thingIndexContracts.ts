// Common Thing paths and sort order: readers and the central index plan share
// this contract instead of creating another index for each new document kind.
export const THINGS_CREATED_ORDER = { createdAt: -1, shareId: 1 } as const;
export const THINGS_KIND_CREATED_INDEX = { thingtime: 1, ...THINGS_CREATED_ORDER } as const;
