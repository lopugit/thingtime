import React from 'react';
import { Button, Flex, FormControl, FormLabel, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Text, Textarea } from '@chakra-ui/react';
import { ComponentUpload, ComponentUploadEnabled } from './ComponentUpload';
import type { ThingsThing } from '../Things/thingsCore';

type AppDraft = { name: string; description: string; icon: string; iconUrl: string; metadata: Record<string, unknown> };

export const BuilderAppDialog = ({ isOpen, onClose, onSave, app }: {
  isOpen: boolean;
  onClose: () => void;
  onSave: (draft: AppDraft) => Promise<void>;
  app?: ThingsThing | null;
}) => {
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
    setMetadata(JSON.stringify(app?.crystal?.metadata || {}, null, 2));
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
      const fields = new FormData(form.current!);
      const attachmentId = String(fields.get('builderAppIconAttachmentId') || '');
      const uploaded = attachmentId ? `/api/v1/attachments/content?id=${encodeURIComponent(attachmentId)}` : String(fields.get('builderAppIcon') || '');
      await onSave({ name: name.trim(), description: description.trim(), icon: icon.trim(), iconUrl: uploaded, metadata: parsed as Record<string, unknown> });
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save this app.');
    } finally { setSaving(false); }
  };
  return <Modal isOpen={isOpen} onClose={onClose} size="lg">
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
          <FormControl><FormLabel>Metadata (JSON object)</FormLabel><Textarea fontFamily="mono" rows={4} value={metadata} onChange={event => setMetadata(event.target.value)} /></FormControl>
          {error && <Text role="alert" color="var(--tt-danger, #e5484d)">{error}</Text>}
        </Flex>
      </ModalBody>
      <ModalFooter gap={2}><Button onClick={onClose} variant="ghost">Cancel</Button><Button type="submit" isDisabled={!name.trim()} isLoading={saving}>Save app</Button></ModalFooter>
    </ModalContent>
  </Modal>;
};
