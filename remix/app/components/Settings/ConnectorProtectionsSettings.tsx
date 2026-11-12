import { useCallback, useEffect, useRef, useState } from 'react';
import { Box } from '@chakra-ui/react';

import {
  CONNECTOR_CONFIRMATION_ACTIONS,
  parseConnectorConfirmations,
  type ConnectorConfirmationAction,
  type ConnectorConfirmationPatch,
  type ConnectorConfirmations
} from '~/api/utils/chatgpt/connectorProtections';
import { useApi } from '~/hooks/useApi';
import { SettingsDocumentHost } from './SettingsDocumentHost';
import { CONNECTOR_PROTECTION_BLOCKS } from './connectorProtectionBlocks';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';

type Phase = 'idle' | 'loading' | 'saving';

export function ConnectorProtectionsSettings({ accountId }: { accountId: string }) {
  const { connectorProtections, setConnectorProtections } = useApi().v1.settings;
  const [confirmations, setConfirmations] = useState<ConnectorConfirmations | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const refs = useRef({ connectorProtections, setConnectorProtections });
  refs.current = { connectorProtections, setConnectorProtections };

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPhase('loading');
    try {
      const result = await refs.current.connectorProtections(accountId, controller.signal);
      const loaded = result?.accountId === accountId ? parseConnectorConfirmations(result.confirmations) : null;
      if (!loaded) throw new Error('Invalid confirmation settings.');
      if (!controller.signal.aborted) {
        setConfirmations(loaded);
        setError(null);
      }
    } catch {
      if (!controller.signal.aborted) setError('Could not load confirmation settings.');
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPhase('idle');
      }
    }
  }, [accountId]);

  useEffect(() => {
    void load();
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [load]);

  const change = async (patch: ConnectorConfirmationPatch) => {
    if (phase !== 'idle' || error || !confirmations || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setConfirmations({ ...confirmations, ...patch });
    setPhase('saving');
    try {
      const result = await refs.current.setConnectorProtections(accountId, patch, controller.signal);
      const saved = result?.accountId === accountId ? parseConnectorConfirmations(result.confirmations) : null;
      if (!saved) throw new Error('Invalid confirmation settings.');
      if (!controller.signal.aborted) setConfirmations(saved);
    } catch {
      if (!controller.signal.aborted) {
        setConfirmations(confirmations);
        setError('Could not verify the change. Reload these settings to see what was saved.');
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPhase('idle');
      }
    }
  };

  const enabledCount = confirmations ? CONNECTOR_CONFIRMATION_ACTIONS.filter(key => confirmations[key]).length : 0;
  const allChecked = enabledCount === CONNECTOR_CONFIRMATION_ACTIONS.length;
  const busy = phase !== 'idle';
  const policy = {
    confirmations, allChecked, busy, ready: confirmations !== null,
    readyVisibility: confirmations ? 'visible' : 'hidden',
    masterChecked: enabledCount > 0 && !allChecked ? 'mixed' : allChecked,
    controlsUnavailable: busy || Boolean(error), hasError: Boolean(error), error,
    progressLabel: phase === 'saving' ? 'Saving confirmation settings' : 'Loading confirmation settings'
  };

  return (
    <Box id="connector-confirmations" width="100%" scrollMarginTop="calc(var(--tt-nav-clearance, 54px) + 16px)">
      <SettingsDocumentHost
        documentKey="connector-confirmations"
        defaultDocument={CONNECTOR_PROTECTION_BLOCKS}
        scopeKey={accountId}
        title="Connector confirmations layout"
        layoutEditingDisabled={phase === 'saving'}
        clearMobileLaunchers
      >
        {({ blocks, chrome, editing }) => (
          <TransientBlockHost scopeKey={accountId} scope={{ policy }} enabled={!editing} actions={{
            'confirmation.change': ({ inputs, value }) => {
              if (typeof value !== 'boolean') return;
              if (inputs.key === 'all') return change(Object.fromEntries(CONNECTOR_CONFIRMATION_ACTIONS.map(key => [key, !allChecked])));
              const key = inputs.key as ConnectorConfirmationAction;
              if (CONNECTOR_CONFIRMATION_ACTIONS.includes(key)) return change({ [key]: value });
            },
            'confirmation.reload': () => { if (phase === 'idle') return load(); }
          }}>
            <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
          </TransientBlockHost>
        )}
      </SettingsDocumentHost>
    </Box>
  );
}
