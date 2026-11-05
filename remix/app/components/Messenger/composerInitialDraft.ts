export type ComposerInitialDraft = {
  /** Stable delivery identity: repeated native callbacks must reuse it. */
  id: string;
  text: string;
  files?: readonly File[];
};

/** Admission is distinct from arrival: locked/revoked upload grants must leave
 * the original files available for a later supported attempt. */
export class ComposerDraftAdmission {
  private textIds = new Set<string>();
  private fileIds = new Set<string>();
  constructor(initial?: ComposerInitialDraft) {
    if (initial) this.textIds.add(initial.id);
  }
  text(current: string, draft: ComposerInitialDraft): string {
    if (this.textIds.has(draft.id)) return current;
    this.textIds.add(draft.id);
    return current && draft.text ? `${current}\n\n${draft.text}` : current || draft.text;
  }
  files(draft: ComposerInitialDraft, accept: (files: readonly File[]) => boolean): boolean {
    if (!draft.files?.length || this.fileIds.has(draft.id)) return true;
    if (!accept(draft.files)) return false;
    this.fileIds.add(draft.id);
    return true;
  }
}

/** Scope the first shared send to both delivery and selected destination. The
 * server binds this key to its exact committed caption and attachment set. */
export async function sharedMessageRequestId(shareId: string, targetId: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([shareId, targetId]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `share-message:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
