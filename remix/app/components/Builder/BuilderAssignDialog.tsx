import React from 'react';
import { Button, FormControl, FormLabel, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Select, Text } from '@chakra-ui/react';
import { useApi } from '~/hooks/useApi';
import type { ThingsThing } from '../Things/thingsCore';

export const BuilderAssignDialog = ({ isOpen, onClose, onAssign }: {
  isOpen: boolean;
  onClose: () => void;
  onAssign: (folderId: string | null) => Promise<boolean>;
}) => {
  const api = useApi();
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const [apps, setApps] = React.useState<ThingsThing[]>([]);
  const [selected, setSelected] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    setApps([]); setSelected(''); setError(''); setLoading(true);
    void (async () => {
      try {
        const rows: ThingsThing[] = [];
        let cursor: string | null = null;
        do {
          const response = await apiRef.current.v1.things.list({ folder: 'root', builderApp: true, cursor: cursor || undefined, limit: 50 }, { signal: controller.signal });
          if (!response?.ok) throw new Error(response?.error || 'Could not list your apps.');
          rows.push(...(response.things || []));
          cursor = response.nextCursor || null;
        } while (cursor && !controller.signal.aborted);
        if (!controller.signal.aborted) setApps(rows);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not list your apps.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [isOpen]);
  const submit = async () => {
    if (saving || loading) return;
    setSaving(true); setError('');
    try {
      const success = await onAssign(selected || null);
      if (success) onClose();
      else setError('Could not move the selected Things.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not move the selected Things.'); }
    finally { setSaving(false); }
  };
  return <Modal isOpen={isOpen} onClose={onClose} size="sm">
    <ModalOverlay /><ModalContent maxW="min(440px, calc(100vw - 24px))">
      <ModalHeader>Assign to a Builder app</ModalHeader><ModalCloseButton />
      <ModalBody>
        <FormControl><FormLabel>App</FormLabel>
          <Select aria-label="Builder app" value={selected} onChange={event => setSelected(event.target.value)} isDisabled={loading}>
            <option value="">No app (ungrouped)</option>
            {apps.map(app => <option key={app.id} value={app.id}>{app.crystal?.name || 'Untitled app'}</option>)}
          </Select>
        </FormControl>
        {loading && <Text role="status" fontSize="sm" mt={2}>Loading apps…</Text>}
        {error && <Text role="alert" color="var(--tt-danger, #e5484d)" fontSize="sm" mt={2}>{error}</Text>}
      </ModalBody>
      <ModalFooter gap={2}><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} isLoading={saving} isDisabled={loading}>Assign</Button></ModalFooter>
    </ModalContent>
  </Modal>;
};
