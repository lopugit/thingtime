// A per-chat policy. Missing/unknown historical values always mean Ask.
export type LopuAccessMode = 'ask' | 'full';
export const lopuAccessMode = (value: unknown): LopuAccessMode => value === 'full' ? 'full' : 'ask';

export const isLopuAccessActor = (actor: { id: string; accountKind?: string; temporary?: boolean } | null | undefined, viewerId: string): boolean =>
  !!actor && actor.id === viewerId && actor.accountKind === 'user' && !actor.temporary;
