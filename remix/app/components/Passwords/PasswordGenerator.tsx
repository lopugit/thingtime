import React from 'react';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { TransientBlockHost, type TransientBlockActions } from '../Builder/TransientBlockHost';
import { DEFAULT_GENERATOR_SETTINGS, PASSWORD_PRESETS, generatePassword, settingsForPreset, type GeneratorSettings, type PasswordPreset } from '~/passwords/generator';
import { PASSWORD_GENERATOR_BLOCKS } from './passwordGeneratorDocument';
export type PasswordGeneratorProps = { ownerId: string; origin: string; targets: Array<{ id: string; label: string }>; onGenerate: (password: string, fieldId: string) => void; disabled?: boolean };
export function PasswordGenerator(props: PasswordGeneratorProps) {
  return <GeneratorSession key={JSON.stringify([props.origin, props.ownerId])} {...props} />;
}
function GeneratorSession({ ownerId, origin, targets, onGenerate, disabled = false }: PasswordGeneratorProps) {
  const scopeKey = JSON.stringify([origin, ownerId]);
  const settingsKey = `tt-password-generator-settings:v1:${scopeKey}`;
  const [settings, setSettings] = React.useState<GeneratorSettings>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(settingsKey) || 'null');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        const clean = { ...DEFAULT_GENERATOR_SETTINGS };
        for (const key of Object.keys(clean) as Array<keyof GeneratorSettings>) {
          const value = (saved as Record<string, unknown>)[key];
          if (typeof value === typeof clean[key]) Object.assign(clean, { [key]: value });
        }
        if (Object.prototype.hasOwnProperty.call(PASSWORD_PRESETS, clean.preset)) return clean;
      }
    } catch { /* Settings storage is optional; no credential is read here. */ }
    return { ...DEFAULT_GENERATOR_SETTINGS };
  });
  const [targetId, setTargetId] = React.useState(() => targets.find(target => target.id === 'password')?.id || targets[0]?.id || '');
  const selectedTarget = targets.find(target => target.id === targetId) || targets.find(target => target.id === 'password') || targets[0];
  const selectedId = selectedTarget?.id || '';
  React.useEffect(() => { setTargetId(selectedId); }, [selectedId]);
  const [notice, setNotice] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const operation = React.useRef<AbortController | null>(null);
  const alive = React.useRef(true);
  const current = React.useRef({ disabled, onGenerate, selectedId, targets }); current.current = { disabled, onGenerate, selectedId, targets };
  React.useLayoutEffect(() => {
    alive.current = true;
    const clear = () => operation.current?.abort();
    const visibility = () => { if (document.hidden) clear(); };
    window.addEventListener('blur', clear); document.addEventListener('visibilitychange', visibility);
    return () => { alive.current = false; clear(); window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  React.useEffect(() => { if (disabled) operation.current?.abort(); }, [disabled]);
  const change = (next: GeneratorSettings) => {
    if (operation.current) return;
    setSettings(next); setNotice('');
    try { localStorage.setItem(settingsKey, JSON.stringify(next)); } catch { setNotice('Settings could not be saved on this device; generation remains available.'); }
  };
  const actions: TransientBlockActions = {
    'generator.target': ({ value }) => { if (!operation.current && typeof value === 'string' && targets.some(target => target.id === value)) { setTargetId(value); setNotice(''); } },
    'generator.preset': ({ value }) => { if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(PASSWORD_PRESETS, value)) change(settingsForPreset(value as PasswordPreset)); },
    'generator.setting': ({ inputs, value }) => {
      const key = inputs.key;
      if (typeof key !== 'string' || key === 'preset' || !Object.prototype.hasOwnProperty.call(DEFAULT_GENERATOR_SETTINGS, key)) return;
      const next = key === 'length' ? Number(value) : value;
      if (typeof next === typeof DEFAULT_GENERATOR_SETTINGS[key as keyof GeneratorSettings]) change({ ...settings, [key]: next });
    },
    'generator.generate': async invocation => {
      if (current.current.disabled || !current.current.selectedId || operation.current || invocation.signal.aborted || document.hidden) return;
      const fieldId = current.current.selectedId;
      const controller = new AbortController(); operation.current = controller;
      const cancel = () => controller.abort(); invocation.signal.addEventListener('abort', cancel, { once: true });
      setBusy(true); setNotice('');
      try {
        const password = await generatePassword(settings, { signal: controller.signal });
        if (alive.current && !current.current.disabled && current.current.selectedId === fieldId && current.current.targets.some(target => target.id === fieldId) && !controller.signal.aborted && !invocation.signal.aborted) {
          try { current.current.onGenerate(password, fieldId); } catch { setNotice('The selected password field could not be filled. Try again.'); return; }
          setNotice('Generated into the selected password field. Save the entry to keep it in your vault.');
        }
      } catch (cause) {
        if (alive.current && !controller.signal.aborted) setNotice(cause instanceof Error ? cause.message : 'Password generation failed.');
      } finally {
        invocation.signal.removeEventListener('abort', cancel); operation.current = null;
        if (alive.current) setBusy(false);
      }
    }
  };
  const preset = PASSWORD_PRESETS[settings.preset];
  // Only non-secret preferences and status enter the Builder binding scope.
  const scope = { result: { ...settings, busy: busy || disabled || !selectedTarget, targets, targetId: selectedId, notice: selectedTarget ? notice : 'Add a password field to generate a password.', guidance: preset.guidance, sources: preset.sources.map(url => ({ url })), buttonLabel: busy ? 'Generating…' : selectedTarget ? `Generate into ${selectedTarget.label || 'password field'}` : 'No password field available' } };
  return <SettingsDocumentHost documentKey="password-generator" defaultDocument={PASSWORD_GENERATOR_BLOCKS} scopeKey={scopeKey} title="Password generator layout" layoutEditingDisabled={busy}>
    {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} scope={scope} actions={actions} enabled={!editing} onError={() => setNotice('This generator control is unavailable. Restore the layout or try again.')}>
      <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} bare interactive={!editing} />
    </TransientBlockHost>}
  </SettingsDocumentHost>;
}
