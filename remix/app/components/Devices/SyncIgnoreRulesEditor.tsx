import React from 'react';
import { canonicalIgnoreRules, createSyncIgnorePolicy, DEFAULT_SYNC_IGNORE_RULES } from '~/fileSync/syncIgnore';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { SettingsDocumentHost, type SettingsDocumentHostProps } from '../Settings/SettingsDocumentHost';
const action = (operation: string) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation } });
const style = { 'min-height': '40px', padding: '8px 12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', 'max-width': '100%', 'box-sizing': 'border-box' };
export const syncIgnoreRulesBlocks: WebpageBlock[] = [{ id: 'sync-ignore', type: 'element', tag: 'fieldset', props: { 'aria-label': 'Sync ignore rules' }, css: { 'min-width': '0', padding: '12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '12px' }, children: [
 { id: 'ignore-title', type: 'element', tag: 'legend', text: 'Ignore rules for this device connection' },
 { id: 'ignore-help', type: 'element', tag: 'p', text: 'Use Gitignore syntax relative to the selected folder. Rules are case-sensitive. Use # for comments and ! to include a matching path again; an ignored parent must be included first. These rules apply to both sides of this connection. Nested .gitignore files are not read.', css: { 'overflow-wrap': 'anywhere' } },
 { id: 'ignore-label', type: 'element', tag: 'label', text: 'Gitignore rules', props: { for: '{ignore.rulesId}' } },
 { id: 'ignore-rules', type: 'element', tag: 'textarea', props: { id: '{ignore.rulesId}', name: 'ignoreRules', 'aria-label': 'Gitignore rules', rows: 8, value: '{ignore.rules}', disabled: '{ignore.disabled}', ...action('rules') }, css: { ...style, display: 'block', width: '100%', 'font-family': 'monospace', 'white-space': 'pre', 'overflow-x': 'auto' } },
 { id: 'ignore-defaults', type: 'element', tag: 'button', text: 'Add dependency ignore defaults', props: { type: 'button', disabled: '{ignore.disabled}', ...action('defaults') }, css: style },
 { id: 'ignore-defaults-help', type: 'element', tag: 'p', text: 'Defaults cover dependency and cache folders such as node_modules, Python environments, Pods, Gradle, Go modules and Ruby Bundler. Review or remove any rule. Exact excluded paths above stay unchanged.' },
 { id: 'ignore-test-title', type: 'element', tag: 'p', text: 'Test a representative relative path' },
 { id: 'ignore-test-path', type: 'element', tag: 'input', props: { name: 'testPath', 'aria-label': 'Ignore test path', placeholder: 'projects/app/node_modules/package/index.js', value: '{ignore.testPath}', ...action('path') }, css: { ...style, display: 'block', width: '100%' } },
 { id: 'ignore-test-kind', type: 'element', tag: 'select', props: { name: 'testKind', 'aria-label': 'Ignore test path type', value: '{ignore.testKind}', ...action('kind') }, css: style, children: [
  { id: 'ignore-test-file', type: 'element', tag: 'option', text: 'File', props: { value: 'file' } },
  { id: 'ignore-test-folder', type: 'element', tag: 'option', text: 'Folder', props: { value: 'folder' } }
 ] },
 { id: 'ignore-test-result', type: 'element', tag: 'p', text: '{ignore.result}', props: { role: 'status', 'aria-label': 'Ignore test result' }, css: { 'overflow-wrap': 'anywhere' } },
 { id: 'ignore-error', type: 'element', tag: 'p', text: '{ignore.error}', props: { role: 'alert' } }
]}];
export function withDependencyIgnoreDefaults(rules: string): string {
 const lines = new Set(rules.replace(/\r\n/g, '\n').split('\n'));
 const missing = DEFAULT_SYNC_IGNORE_RULES.split('\n').filter(line => !lines.has(line));
 return canonicalIgnoreRules(missing.length ? '# Common dependency and cache directories\n' + missing.join('\n') + (rules ? '\n\n' + rules : '') : rules);
}
export function SyncIgnoreRulesEditor({ rules, excludedPaths, disabled, scopeKey, onChange, accountTransport }: {
 rules: string; excludedPaths: string[]; disabled: boolean; scopeKey: string; onChange(rules: string): void;
 accountTransport?: SettingsDocumentHostProps['accountTransport'];
}) {
 const rulesId = React.useId();
 const [testPath, setTestPath] = React.useState(''), [testKind, setTestKind] = React.useState<'file' | 'folder'>('file'), [error, setError] = React.useState('');
 let result = 'Enter a path to see whether it would be ignored.';
 if (testPath) { try {
  const answer = createSyncIgnorePolicy(rules, excludedPaths).explain(testPath, testKind);
  result = answer.ignored ? answer.source === 'exact' ? `Ignored by exact excluded path: ${answer.rule}` : `Ignored by rule ${answer.line}: ${answer.rule}${answer.parent ? ` (parent ${answer.parent})` : ''}` : answer.source === 'rule' ? `Included by rule ${answer.line}: ${answer.rule}` : 'Included. No ignore rule matches this path.';
 } catch (cause) { result = cause instanceof Error ? cause.message : 'The path could not be tested.'; } }
 return <SettingsDocumentHost documentKey="file-sync-ignore" defaultDocument={syncIgnoreRulesBlocks} scopeKey={scopeKey} title="Sync ignore rules" accountTransport={accountTransport}>
  {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} enabled={!editing} scope={{ ignore: { rulesId, rules, disabled, testPath, testKind, result, error } }} actions={{
   rules: ({ value }) => { if (disabled) return; setError(''); onChange(String(value ?? '')); },
   defaults: () => { if (disabled) return; setError(''); onChange(withDependencyIgnoreDefaults(rules)); },
   path: ({ value }) => setTestPath(String(value ?? '')),
   kind: ({ value }) => { if (value === 'file' || value === 'folder') setTestKind(value); }
  }} onError={() => setError('The ignore rule edit was not accepted. Your current draft is preserved.')}>
   <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} />
  </TransientBlockHost>}
 </SettingsDocumentHost>;
}
