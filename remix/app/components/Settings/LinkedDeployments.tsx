import React from 'react';
import { Box, Button, Flex, Input, Spinner, Text, Textarea } from '@chakra-ui/react';
import { X } from 'lucide-react';

import { useLinkedDeployments } from './useLinkedDeployments';
import type { PublicDeploymentLink } from './useLinkedDeployments';

// Settings → Linked deployments. Link an account on another Thingtime
// deployment and keep the two in sync (push / pull / two-way, with optional
// per-data-path rules). All data + toasts live in useLinkedDeployments; this
// component is layout only, mirroring AlgorithmManager's row idioms.

const SYNC_MODES: { id: PublicDeploymentLink['syncMode']; label: string; hint: string }[] = [
  { id: 'push', label: 'Push ⬆️', hint: 'this deployment → linked one' },
  { id: 'pull', label: 'Pull ⬇️', hint: 'linked deployment → this one' },
  { id: 'two-way', label: 'Two-way 🔁', hint: 'newest edit wins' },
  { id: 'off', label: 'Off 💤', hint: 'nothing moves' }
];

const inputStyles = {
  background: 'var(--tt-surface-alt)',
  border: '1px solid var(--tt-border)',
  borderRadius: 'var(--tt-radius-sm, 8px)'
} as const;

const rowShell = {
  padding: 3,
  borderRadius: 'var(--tt-radius-md, 12px)',
  border: '1px solid var(--tt-border)'
} as const;

const timeAgo = (iso: string | null): string | null => {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const ModePicker = ({
  value,
  compact,
  onPick
}: {
  value: PublicDeploymentLink['syncMode'];
  compact?: boolean;
  onPick: (mode: PublicDeploymentLink['syncMode']) => void;
}) => (
  <Flex columnGap={1} flexWrap="wrap" rowGap={1}>
    {SYNC_MODES.map((mode) => (
      <Button
        key={mode.id}
        size="xs"
        variant={value === mode.id ? 'solid' : 'ghost'}
        title={mode.hint}
        onClick={() => onPick(mode.id)}
      >
        {compact ? mode.label.split(' ')[1] : mode.label}
      </Button>
    ))}
  </Flex>
);

const PathRulesEditor = ({
  link,
  onSave
}: {
  link: PublicDeploymentLink;
  onSave: (rules: PublicDeploymentLink['pathRules']) => Promise<boolean>;
}) => {
  const [rules, setRules] = React.useState(link.pathRules);
  const [newPath, setNewPath] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const addRule = () => {
    const path = newPath.trim();
    if (!path || rules.some((rule) => rule.path === path)) return;
    setRules([...rules, { path, mode: 'two-way' }]);
    setNewPath('');
  };

  const save = async () => {
    setSaving(true);
    const ok = await onSave(rules);
    setSaving(false);
    if (ok) setRules(rules);
  };

  return (
    <Flex flexDirection="column" marginTop={2} paddingTop={2} borderTop="1px dashed var(--tt-border)" rowGap={2}>
      <Text fontSize="xs" opacity={0.7}>
        Path rules override the link’s mode for slices of your data — <code>profile</code>, <code>things</code>, or{' '}
        <code>things/&lt;kind&gt;</code> (like <code>things/post</code> or <code>things/comment</code>). No rule =
        the link’s mode.
      </Text>
      {rules.map((rule, index) => (
        <Flex key={rule.path} alignItems="center" columnGap={2} flexWrap="wrap" rowGap={1}>
          <Text fontFamily="mono" fontSize="xs" minWidth="120px">
            {rule.path}
          </Text>
          <ModePicker
            compact
            value={rule.mode}
            onPick={(mode) => setRules(rules.map((entry, i) => (i === index ? { ...entry, mode } : entry)))}
          />
          <Button
            aria-label={`Remove rule for ${rule.path}`}
            size="xs"
            variant="ghost"
            onClick={() => setRules(rules.filter((_, i) => i !== index))}
          >
            <X size={13} />
          </Button>
        </Flex>
      ))}
      <Flex alignItems="center" columnGap={2}>
        <Input
          placeholder="things/post"
          size="xs"
          value={newPath}
          width="180px"
          {...inputStyles}
          onChange={(event) => setNewPath(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && addRule()}
        />
        <Button size="xs" variant="outline" onClick={addRule}>
          Add rule ➕
        </Button>
        <Button isLoading={saving} marginLeft="auto" size="xs" variant="solid" onClick={save}>
          Save rules 💾
        </Button>
      </Flex>
    </Flex>
  );
};

export const LinkedDeployments = ({ userId }: { userId: string }) => {
  const { links, loading, busyKey, linkDeployment, setSyncMode, setPathRules, syncNow, removeLink, mintToken } =
    useLinkedDeployments(userId);

  const [formOpen, setFormOpen] = React.useState(false);
  const [authMethod, setAuthMethod] = React.useState<'password' | 'token'>('password');
  const [baseUrl, setBaseUrl] = React.useState('');
  const [name, setName] = React.useState('');
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [token, setToken] = React.useState('');
  const [otpChallenge, setOtpChallenge] = React.useState<string | null>(null);
  const [otpCode, setOtpCode] = React.useState('');

  const [rulesOpenId, setRulesOpenId] = React.useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  const [mintedToken, setMintedToken] = React.useState<string | null>(null);

  // armed delete disarms itself, same as AlgorithmManager
  React.useEffect(() => {
    if (!confirmDeleteId) return;
    const timer = setTimeout(() => setConfirmDeleteId(null), 4000);
    return () => clearTimeout(timer);
  }, [confirmDeleteId]);

  const resetForm = () => {
    setBaseUrl('');
    setName('');
    setUsername('');
    setPassword('');
    setToken('');
    setOtpChallenge(null);
    setOtpCode('');
  };

  const submitLink = async () => {
    const form = otpChallenge
      ? { baseUrl, name, challenge: otpChallenge, code: otpCode }
      : authMethod === 'token'
        ? { baseUrl, name, token }
        : { baseUrl, name, username, password };
    const result = await linkDeployment(form);
    if (!result) return;
    if (!result.done && result.challenge) {
      setOtpChallenge(result.challenge);
      return;
    }
    resetForm();
    setFormOpen(false);
  };

  return (
    <Flex flexDirection="column" rowGap={3}>
      {loading && (
        <Flex alignItems="center" columnGap={2} opacity={0.7}>
          <Spinner size="sm" />
          <Text fontSize="sm">Loading your linked deployments…</Text>
        </Flex>
      )}

      {!loading && !links.length && (
        <Text fontSize="sm" opacity={0.6}>
          No linked deployments yet.
        </Text>
      )}

      {links.map((link) => {
        const syncBusy = busyKey === `${link.id}:sync`;
        const previewBusy = busyKey === `${link.id}:preview`;
        const tokenExpired = link.tokenExpiresAt ? Date.parse(link.tokenExpiresAt) < Date.now() : false;
        const synced = timeAgo(link.lastSyncAt);
        const summary = link.lastSyncSummary;
        return (
          <Flex key={link.id} flexDirection="column" {...rowShell}>
            <Flex alignItems="center" columnGap={2} flexWrap="wrap" rowGap={1}>
              <Flex flexDirection="column" minWidth={0}>
                <Text fontSize="sm" fontWeight={600} noOfLines={1}>
                  {link.name || link.baseUrl}
                </Text>
                <Text fontSize="xs" noOfLines={1} opacity={0.6}>
                  {link.baseUrl} · @{link.remoteUsername}
                </Text>
              </Flex>
              <Button
                aria-label={`Unlink ${link.name}`}
                marginLeft="auto"
                size="xs"
                variant="ghost"
                {...(confirmDeleteId === link.id ? { color: 'var(--tt-danger, #e5484d)' } : {})}
                isLoading={busyKey === `${link.id}:remove`}
                onClick={() => {
                  if (confirmDeleteId === link.id) {
                    setConfirmDeleteId(null);
                    removeLink(link.id);
                  } else {
                    setConfirmDeleteId(link.id);
                  }
                }}
              >
                {confirmDeleteId === link.id ? 'Really unlink? 🗑️' : <X size={13} />}
              </Button>
            </Flex>

            {tokenExpired && (
              <Text color="var(--tt-danger, #e5484d)" fontSize="xs" marginTop={1}>
                This link’s token has expired — unlink and re-link to refresh it.
              </Text>
            )}

            <Flex alignItems="center" columnGap={2} flexWrap="wrap" marginTop={2} rowGap={1}>
              <ModePicker value={link.syncMode} onPick={(mode) => setSyncMode(link.id, mode)} />
              <Flex columnGap={1} marginLeft="auto">
                <Button
                  isLoading={previewBusy}
                  size="xs"
                  variant="outline"
                  onClick={() => syncNow(link.id, { dryRun: true })}
                >
                  Preview 👀
                </Button>
                <Button isLoading={syncBusy} size="xs" variant="solid" onClick={() => syncNow(link.id)}>
                  Sync now 🔄
                </Button>
                <Button
                  size="xs"
                  variant={rulesOpenId === link.id ? 'solid' : 'ghost'}
                  onClick={() => setRulesOpenId(rulesOpenId === link.id ? null : link.id)}
                >
                  Rules 🛣️{link.pathRules.length ? ` (${link.pathRules.length})` : ''}
                </Button>
              </Flex>
            </Flex>

            {(synced || summary) && (
              <Text fontSize="xs" marginTop={1} opacity={0.6}>
                {synced ? `Synced ${synced}` : 'Never synced'}
                {summary
                  ? ` — ↑${summary.pushed ?? 0} ↓${summary.pulled ?? 0} · ${summary.unchanged ?? 0} unchanged${
                      summary.remaining ? ` · ${summary.remaining} to go` : ''
                    }`
                  : ''}
              </Text>
            )}

            {rulesOpenId === link.id && <PathRulesEditor link={link} onSave={(rules) => setPathRules(link.id, rules)} />}
          </Flex>
        );
      })}

      {formOpen ? (
        <Flex flexDirection="column" padding={3} border="1px dashed var(--tt-border)" borderRadius="var(--tt-radius-md, 12px)" rowGap={2}>
          <Input
            placeholder="https://thingtime.example.com"
            size="sm"
            value={baseUrl}
            {...inputStyles}
            isDisabled={!!otpChallenge}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
          <Input
            placeholder="Name (optional — defaults to the host)"
            size="sm"
            value={name}
            {...inputStyles}
            isDisabled={!!otpChallenge}
            onChange={(event) => setName(event.target.value)}
          />
          {otpChallenge ? (
            <Input
              autoFocus
              placeholder="2FA code from that deployment’s email"
              size="sm"
              value={otpCode}
              {...inputStyles}
              onChange={(event) => setOtpCode(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && submitLink()}
            />
          ) : (
            <>
              <Flex columnGap={1}>
                <Button
                  size="xs"
                  variant={authMethod === 'password' ? 'solid' : 'ghost'}
                  onClick={() => setAuthMethod('password')}
                >
                  Sign in 🔒
                </Button>
                <Button
                  size="xs"
                  variant={authMethod === 'token' ? 'solid' : 'ghost'}
                  onClick={() => setAuthMethod('token')}
                >
                  Paste a token 🔑
                </Button>
              </Flex>
              {authMethod === 'password' ? (
                <>
                  <Input
                    autoComplete="off"
                    placeholder="Username on that deployment"
                    size="sm"
                    value={username}
                    {...inputStyles}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                  <Input
                    autoComplete="off"
                    placeholder="Password on that deployment"
                    size="sm"
                    type="password"
                    value={password}
                    {...inputStyles}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <Text fontSize="xs" opacity={0.6}>
                    Your password is passed straight through to that deployment to sign in — only the resulting
                    token is kept.
                  </Text>
                </>
              ) : (
                <Textarea
                  placeholder="Link token from that deployment’s Settings → Linked deployments"
                  rows={2}
                  size="sm"
                  value={token}
                  {...inputStyles}
                  onChange={(event) => setToken(event.target.value)}
                />
              )}
            </>
          )}
          <Flex columnGap={2}>
            <Button isLoading={busyKey === 'link'} size="xs" variant="solid" onClick={submitLink}>
              {otpChallenge ? 'Confirm code ✨' : 'Link ✨'}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                resetForm();
                setFormOpen(false);
              }}
            >
              Cancel ✋
            </Button>
          </Flex>
        </Flex>
      ) : (
        <Flex columnGap={2}>
          <Button size="xs" variant="outline" onClick={() => setFormOpen(true)}>
            Link a deployment ➕
          </Button>
          <Button
            isLoading={busyKey === 'mint'}
            size="xs"
            variant="ghost"
            onClick={async () => {
              const minted = await mintToken();
              if (minted) setMintedToken(minted);
            }}
          >
            Create a link token 🔑
          </Button>
        </Flex>
      )}

      {mintedToken && (
        <Flex flexDirection="column" rowGap={1}>
          <Text fontSize="xs" opacity={0.7}>
            Paste this on the OTHER deployment (Link a deployment → Paste a token). It’s shown once and works
            until you sign out that session.
          </Text>
          <Textarea readOnly rows={3} size="sm" value={mintedToken} {...inputStyles} onFocus={(event) => event.target.select()} />
          <Flex columnGap={2}>
            <Button
              size="xs"
              variant="outline"
              onClick={() => navigator.clipboard?.writeText(mintedToken).catch(() => {})}
            >
              Copy 📋
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setMintedToken(null)}>
              Dismiss
            </Button>
          </Flex>
        </Flex>
      )}
    </Flex>
  );
};
