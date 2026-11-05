import { useApi } from '~/hooks/useApi';
import { useBuilderThings } from './useBuilderThings';
import { builderAppAdditionalMetadata, builderAppMetadata, builderAppEntryPointHref, builderAppEntryPointId } from './builderAppNavigation';
import React from 'react';
import { Button, Flex, FormControl, FormLabel, FormHelperText, Input, Select, Spinner, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Text, Textarea } from '@chakra-ui/react';
import { ComponentUpload, ComponentUploadEnabled } from './ComponentUpload';
import type { ThingsThing } from '../Things/thingsCore';

type AppDraft = { name: string; description: string; icon: string; iconUrl: string; metadata: Record<string, unknown> };

export const BuilderAppDialog = ({ isOpen, onClose, onSave, app }: {
  isOpen: boolean;
  onClose: () => void;
  onSave: (draft: AppDraft) => Promise<void>;
  app?: ThingsThing | null;
}) => {
  const api = useApi();
  const pages = useBuilderThings(api.v1.things.list, 'webpage', 0, isOpen);
  const [entryPoint, setEntryPoint] = React.useState('');
  const form = React.useRef<HTMLFormElement>(null);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [icon, setIcon] = React.useState('');
  const [metadata, setMetadata] = React.useState('{}');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    if (!isOpen) return;
    setName(typeof app?.crystal?.name === 'string' ? app.crystal.name : '');
    setDescription(typeof app?.crystal?.description === 'string' ? app.crystal.description : '');
    setIcon(typeof app?.crystal?.icon === 'string' ? app.crystal.icon : '');
    setMetadata(JSON.stringify(builderAppAdditionalMetadata(app), null, 2));
    setEntryPoint(app ? (() => { try { return builderAppEntryPointId(app) || ''; } catch { return ''; } })() : '');
    setError('');
  }, [isOpen, app]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    let parsed: unknown;
    try { parsed = JSON.parse(metadata || '{}'); } catch { setError('Metadata must be valid JSON.'); return; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { setError('Metadata must be a JSON object.'); return; }
    setSaving(true);
    setError('');
    try {
      const nextMetadata = builderAppMetadata(parsed as Record<string, unknown>, entryPoint);
      const candidate = { ...app, crystal: { ...app?.crystal, metadata: nextMetadata } } as ThingsThing;
      const targetId = builderAppEntryPointId(candidate);
      if (targetId) {
        const response = await api.v1.things.get({ id: targetId }).catch(() => { throw new Error('The entry point is missing or unavailable to this account.'); });
        if (!response?.ok || !response.thing) throw new Error('The entry point is missing or unavailable to this account.');
        builderAppEntryPointHref(candidate, response.thing);
      }
      const fields = new FormData(form.current!);
      const attachmentId = String(fields.get('builderAppIconAttachmentId') || '');
      const uploaded = attachmentId ? `/api/v1/attachments/content?id=${encodeURIComponent(attachmentId)}` : String(fields.get('builderAppIcon') || '');
      await onSave({ name: name.trim(), description: description.trim(), icon: icon.trim(), iconUrl: uploaded, metadata: nextMetadata });
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save this app.');
    } finally { setSaving(false); }
  };
  return <Modal isOpen={isOpen} onClose={onClose} size="lg" scrollBehavior="inside">
    <ModalOverlay />
    <ModalContent as="form" ref={form} onSubmit={submit} maxW="min(540px, calc(100vw - 24px))">
      <ModalHeader>{app ? 'Edit Builder app' : 'New Builder app'}</ModalHeader>
      <ModalCloseButton />
      <ModalBody>
        <Flex direction="column" gap={4}>
          <FormControl isRequired><FormLabel>Name</FormLabel><Input autoFocus value={name} onChange={event => setName(event.target.value)} /></FormControl>
          <FormControl><FormLabel>Description</FormLabel><Textarea value={description} onChange={event => setDescription(event.target.value)} /></FormControl>
          <FormControl><FormLabel>App icon</FormLabel><ComponentUploadEnabled.Provider value><ComponentUpload name="builderAppIcon" imageOnly title="Upload an app icon" value={app?.crystal?.iconUrl} /></ComponentUploadEnabled.Provider></FormControl>
          <FormControl><FormLabel>Emoji fallback</FormLabel><Input value={icon} onChange={event => setIcon(event.target.value)} /></FormControl>
          <FormControl>
            <FormLabel htmlFor="builder-app-entry-page">Entry point</FormLabel>
            <Select id="builder-app-entry-page" value={pages.rows.some(page => page.id === entryPoint) ? entryPoint : entryPoint ? '__custom__' : ''} onChange={event => { if (event.target.value !== '__custom__') setEntryPoint(event.target.value); }}>
              <option value="">Browse app contents</option>
              {entryPoint && !pages.rows.some(page => page.id === entryPoint) && <option value="__custom__">Selected Thing</option>}
              {pages.rows.map(page => <option key={page.id} value={page.id}>{page.crystal?.name || page.id}</option>)}
            </Select>
            <FormHelperText>Choose a live page, or enter another saved Thing ID below. Access is checked independently when the app opens.</FormHelperText>
            <Input marginTop={2} aria-label="Entry point Thing ID" placeholder="Saved Thing ID (optional)" value={entryPoint} onChange={event => setEntryPoint(event.target.value)} />
            {pages.nextCursor && <Button size="sm" variant="ghost" onClick={pages.loadMore} isDisabled={pages.loading}>Load more pages</Button>}
            {pages.loading && <Flex role="status" alignItems="center" gap={2}><Spinner size="xs" aria-hidden="true" /><Text fontSize="sm">Loading pages</Text></Flex>}
            {pages.error && <Flex alignItems="center" gap={2}><Text role="alert" fontSize="sm">{pages.error}</Text><Button size="sm" onClick={pages.retry}>Retry pages</Button></Flex>}
          </FormControl>
          <FormControl><FormLabel>Additional metadata (JSON object)</FormLabel><Textarea fontFamily="mono" rows={4} value={metadata} onChange={event => setMetadata(event.target.value)} /></FormControl>
          {error && <Text role="alert" color="var(--tt-danger, #e5484d)">{error}</Text>}
        </Flex>
      </ModalBody>
      <ModalFooter gap={2}><Button onClick={onClose} variant="ghost">Cancel</Button><Button type="submit" isDisabled={!name.trim()} isLoading={saving}>Save app</Button></ModalFooter>
    </ModalContent>
  </Modal>;
};
