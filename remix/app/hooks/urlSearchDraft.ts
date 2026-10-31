// Tracks local edits separately from acknowledgements of router writes. Router
// location state identifies an echo; the query text alone cannot distinguish an
// old acknowledgement from an external navigation to the same text.
export class UrlSearchDraft {
  draft: string;
  private committed: string;
  private revision = 0;
  private pending = new Map<string, number>();

  constructor(value: string, private normalize: (value: string) => string) {
    this.draft = this.committed = value;
  }

  edit(value: string) {
    this.revision++;
    this.draft = value;
  }

  observe(value: string, token: unknown, navigation: string) {
    const revision = navigation !== 'POP' && typeof token === 'string' ? this.pending.get(token) : undefined;
    const changed = value !== this.committed;
    this.committed = value;
    if (revision !== undefined) {
      for (const key of this.pending.keys()) {
        this.pending.delete(key);
        if (key === token) break;
      }
      if (this.revision === revision) this.draft = value;
    } else if (changed || navigation !== 'REPLACE') {
      this.pending.clear();
      this.edit(value);
    }
    return this.draft;
  }

  commit(token: string) {
    const value = this.normalize(this.draft);
    if (value === this.committed) return null;
    this.pending.set(token, this.revision);
    return value;
  }
}

export const withSearchQuery = (search: string, name: string, value: string) => {
  const params = new URLSearchParams(search);
  if (value) params.set(name, value);
  else params.delete(name);
  return params;
};
