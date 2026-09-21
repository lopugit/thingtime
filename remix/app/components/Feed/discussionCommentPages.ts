import type { PostComment } from './feedTypes';

type CommentPage = { comments: PostComment[]; nextCursor: string | null };

/** One cursor chain per discussion/refresh. A failed transport can retry;
 * a malformed or stalled chain stops until the user explicitly refreshes. */
export function createDiscussionCommentPager() {
  let cursor: string | null | undefined;
  let loading = false;
  let disposed = false;
  const seen = new Set<string>();
  return {
    get hasMore() { return !disposed && cursor !== null; },
    dispose() { disposed = true; },
    async load(fetchPage: (after?: string) => Promise<any>): Promise<CommentPage | null> {
      if (loading || disposed || cursor === null) return null;
      loading = true;
      try {
        const response = await fetchPage(cursor);
        if (disposed) return null;
        if (!response?.ok) throw Object.assign(new Error(response?.error || 'Could not load comments.'), { status: response?.status });
        const next = response.nextCursor;
        if (!Array.isArray(response.comments) || !(next === null || (typeof next === 'string' && next.length > 0))) {
          cursor = null;
          throw new Error('Invalid comment page. Refresh comments to retry.');
        }
        // Tokens are opaque, authenticated and target/viewer scoped. Only the
        // server can interpret their scan boundary; the client detects loops.
        if (next && (next === cursor || seen.has(next))) {
          cursor = null;
          throw new Error('Comment pagination did not advance. Refresh comments to retry.');
        }
        if (next) seen.add(next);
        cursor = next;
        return { comments: response.comments, nextCursor: next };
      } catch (failure: any) {
        if ([401, 403, 404].includes(Number(failure?.status))) disposed = true;
        throw failure;
      } finally {
        loading = false;
      }
    }
  };
}

export function mergeDiscussionComments(previous: PostComment[], incoming: PostComment[]): PostComment[] {
  return [...new Map([...previous, ...incoming].map(comment => [comment.id, comment])).values()];
}

export function discussionCommentSearchText(comment: PostComment): string {
  return `${comment.author?.username || ''} ${comment.text} ${JSON.stringify(comment.richText || '')} ${(comment.attachments || []).map(file => file.name || '').join(' ')}`;
}
