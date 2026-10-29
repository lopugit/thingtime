import React from 'react';
import { Box, Button, Flex, FormControl, FormLabel, Input, Switch, Text } from '@chakra-ui/react';
import { SettingsSection, SettingRow, RainbowButton } from '~/components/Settings/SettingsSection';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { rootIdentity } from '~/utils/rootIdentity';
import { getElectronBridge } from '~/utils/electronBridge';
import { useLopu } from '~/components/Lopu/useLopu';
import { parsePreviewRetentionPolicy, type PreviewRetentionSettings as SavedSettings, type PreviewRetentionPolicy } from '~/api/utils/ciControl/previewRetentionCore';

// A shared infrastructure settings editor, used in Admin and Settings → Admin.
// Never paint defaults as saved state when the durable read is unavailable.
export const PreviewRetentionSettings = () => {
  const user = useCurrentUser();
  const identity = React.useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
  const [selected, setSelected] = React.useState<{ generation: number; origin: string } | null>(null);
  React.useEffect(() => {
    let active = true;
    const bridge = getElectronBridge();
    if (!bridge) setSelected({ generation: identity.generation, origin: window.location.origin });
    else void bridge.getInfo?.().then(info => {
      if (active && info.apiOrigin) setSelected({ generation: identity.generation, origin: new URL(info.apiOrigin).origin });
    }).catch(() => { if (active) setSelected(null); });
    return () => { active = false; };
  }, [identity.generation]);
  // Keyed ownership clears both saved values and drafts before a new identity
  // paints; old read/save completions belong to the unmounted editor only.
  if (!user?.isAdmin || identity.pending || selected?.generation !== identity.generation) return null;
  const scope = { expectedActor: user.id, expectedApiOrigin: selected.origin };
  return <PreviewRetentionEditor key={JSON.stringify([user.id, selected.origin, identity.generation])} scope={scope} />;
};

const PreviewRetentionEditor = ({ scope }: { scope: { expectedActor: string; expectedApiOrigin: string } }) => {
  const { expectedActor, expectedApiOrigin } = scope;
  const api = useApi();
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const lopu = useLopu();
  const [saved, setSaved] = React.useState<SavedSettings | null>(null);
  const [draft, setDraft] = React.useState<PreviewRetentionPolicy | null>(null);
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [reload, setReload] = React.useState(0);
  const generation = React.useRef(0);
  React.useEffect(() => {
    const current = ++generation.current;
    setLoading(true);
    apiRef.current.v1.admin.ciPreviewRetention({ expectedActor, expectedApiOrigin }).then((response: any) => {
      if (generation.current !== current) return;
      if (!response?.ok) throw new Error(response?.error || 'Could not load the saved policy.');
      const next = { policy: parsePreviewRetentionPolicy(response.policy), revision: response.revision };
      setSaved(next); setDraft(next.policy); setError('');
    }).catch((reason: Error) => { if (generation.current === current) setError(reason.message); })
      .finally(() => { if (generation.current === current) setLoading(false); });
    return () => { generation.current = current + 1; };
  }, [reload, expectedActor, expectedApiOrigin]);
  const patch = (value: Partial<PreviewRetentionPolicy>) => setDraft((previous) => previous && { ...previous, ...value });
  let invalid = '';
  if (draft) { try { parsePreviewRetentionPolicy(draft); } catch (reason) { invalid = (reason as Error).message; } }
  const dirty = Boolean(saved && draft && JSON.stringify(saved.policy) !== JSON.stringify(draft));
  const save = async () => {
    if (!saved || !draft || invalid || saving) return;
    const current = generation.current;
    setSaving(true); setError('');
    try {
      const response = await apiRef.current.v1.admin.setCiPreviewRetention({ policy: draft, expectedRevision: saved.revision }, { expectedActor, expectedApiOrigin });
      if (generation.current !== current) return;
      if (!response?.ok) throw new Error(response?.error || 'Could not save preview retention.');
      const next = { policy: parsePreviewRetentionPolicy(response.policy), revision: response.revision };
      setSaved(next); setDraft(next.policy);
      lopu({ title: 'Preview retention saved', status: 'success' });
    } catch (reason) { if (generation.current === current) setError((reason as Error).message); }
    finally { if (generation.current === current) setSaving(false); }
  };
  const hours = (key: 'noOpenPrGraceHours' | 'supersededGraceHours', label: string) => (
    <FormControl isInvalid={Boolean(invalid)}>
      <FormLabel htmlFor={`preview-${key}`} fontSize="sm">{label}</FormLabel>
      <Input id={`preview-${key}`} type="number" inputMode="numeric" min={0} step={1} maxW="180px" minH="44px"
        value={draft?.[key] ?? ''} isDisabled={saving} onChange={(event) => patch({ [key]: event.target.value === '' ? NaN : Number(event.target.value) })} />
    </FormControl>
  );
  return <Flex direction="column" gap={4} minW={0}>
    <SettingsSection open eyebrow="Vercel preview retention" description="Control automatic cleanup of deployment snapshots for this repository. Changes apply to the next protected controller run." summary={saved ? (saved.policy.enabled ? 'Automatic cleanup enabled' : 'Automatic cleanup paused') : 'Saved policy unavailable'}>
      {loading && !saved && <Text fontSize="sm" role="status">Reading the saved policy…</Text>}
      {draft && <>
        <SettingRow label="Automatic preview cleanup" hint="Pause deployment deletion without changing the saved retention rules.">
          <Switch minH="44px" display="flex" alignItems="center" aria-label="Automatic preview cleanup" isDisabled={saving} isChecked={draft.enabled} onChange={(event) => patch({ enabled: event.target.checked })} />
        </SettingRow>
        {hours('noOpenPrGraceHours', 'Closed or missing PR grace period (hours)')}
        <Text fontSize="xs" color="var(--tt-text, #5a5a66)">0 removes eligible previews on the next run. Tagged previews count from the later of deployment creation or PR closure; untagged branch snapshots count from creation.</Text>
        <SettingRow label="Remove superseded previews on active PRs" hint="Keep the newest ready preview for the current PR head and all active builds. Older snapshots become eligible after the grace period.">
          <Switch minH="44px" display="flex" alignItems="center" aria-label="Remove superseded previews on active PRs" isDisabled={saving} isChecked={draft.pruneSupersededOpenPr} onChange={(event) => patch({ pruneSupersededOpenPr: event.target.checked })} />
        </SettingRow>
        {draft.pruneSupersededOpenPr && hours('supersededGraceHours', 'Superseded preview grace period (hours)')}
      </>}
    </SettingsSection>
    {draft && <SettingsSection open eyebrow="Pull request liveliness" description="Choose when an open PR stops keeping its previews alive. This never closes or edits a pull request." summary={draft.inactivePullRequestDays === null ? 'Open PRs stay live indefinitely' : `Inactive after ${draft.inactivePullRequestDays} days`}>
      <SettingRow label="Expire previews for inactive open PRs" hint="Opt in to removing all previews for an open PR after the chosen number of days since its last PR update on GitHub. Preview publishing stays suspended until that PR becomes active again.">
        <Switch minH="44px" display="flex" alignItems="center" aria-label="Expire previews for inactive open PRs" isDisabled={saving} isChecked={draft.inactivePullRequestDays !== null} onChange={(event) => patch({ inactivePullRequestDays: event.target.checked ? 30 : null })} />
      </SettingRow>
      {draft.inactivePullRequestDays !== null && <FormControl>
        <FormLabel htmlFor="preview-inactive-days" fontSize="sm">Days without PR activity</FormLabel>
        <Input id="preview-inactive-days" type="number" inputMode="numeric" min={1} step={1} maxW="180px" minH="44px" value={draft.inactivePullRequestDays} isDisabled={saving} onChange={(event) => patch({ inactivePullRequestDays: event.target.value === '' ? NaN : Number(event.target.value) })} />
      </FormControl>}
    </SettingsSection>}
    <Box borderRadius="var(--tt-radius-md, 12px)" bg="var(--tt-surface-alt, #f5f5f7)" p={4}>
      <Text fontSize="sm" fontWeight={600}>Always protected</Text>
      <Text fontSize="sm" mt={1} color="var(--tt-text, #5a5a66)">Production, stable environment and gateway deployments, protected aliases and resources outside the configured project remain protected. An unavailable or invalid policy preserves deployments.</Text>
    </Box>
    {(error || invalid) && <Text role="alert" fontSize="sm" color="red.600">{error || invalid}</Text>}
    <Flex gap={3} flexWrap="wrap" alignItems="center">
      {draft && <RainbowButton minH="44px" onClick={save} isLoading={saving} isDisabled={!dirty || Boolean(invalid) || loading}>Save retention rules</RainbowButton>}
      <Button minH="44px" variant="outline" onClick={() => setReload((value) => value + 1)} isDisabled={saving || loading}>Reload saved policy</Button>
      {dirty && <Text fontSize="xs" color="var(--tt-muted, #777783)">Unsaved changes</Text>}
    </Flex>
  </Flex>;
};
