import { syncPathKey, validSyncPath } from './reconcile';
import { createSyncIgnorePolicy } from './syncIgnore';

export function parseUploadPriorityDraft(text: string, options: { ignoreRules?: string; excludedPaths: string[] }): string[] {
 const paths = text.split(/\r?\n/).filter(path => path !== '');
 const seen = new Set<string>(), policy = createSyncIgnorePolicy(options.ignoreRules, options.excludedPaths);
 for (const path of paths) {
  if (!validSyncPath(path)) throw Error('Enter relative file or folder paths without a leading slash or .. segments.');
  const key = syncPathKey(path);
  if (seen.has(key)) throw Error(`Duplicate priority path: ${path}`);
  if (policy.ignored(path, 'file')) throw Error(`This path is excluded by the saved sync rules: ${path}`);
  seen.add(key);
 }
 return paths;
}
