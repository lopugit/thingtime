import React from 'react';
import {
  Box,
  Button,
  Flex,
  Input,
  Select,
  Slider,
  SliderFilledTrack,
  SliderThumb,
  SliderTrack,
  Switch,
  Text,
  Textarea
} from '@chakra-ui/react';

import { RainbowButton } from './SettingsSection';
import { useLopu } from '~/components/Lopu/useLopu';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import { PAT_SCOPE_CATALOG, PAT_VISIBILITY_CATALOG } from '~/api/utils/auth/patScopes';
import type { PatVisibilityMode } from '~/api/utils/auth/patScopes';

// Settings → Token minter: mint scoped, revocable API tokens to hand to an AI
// agent or script (push a new thing, update a thing, scan your things) without
// sharing the account password. Lifetime is two dials — expiry (1ms → never,
// slider is log-scale) and uses (1 → unlimited) — plus a per-token permissions
// selector over the PAT scope catalog. The token string appears exactly once.

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

const inputStyles = {
  background: 'var(--tt-surface-alt, #f5f5f7)',
  border: '1px solid var(--tt-border, #ececef)',
  borderRadius: 'var(--tt-radius-sm, 9px)'
} as const;

const FieldLabel = (props: { children: React.ReactNode }) => (
  <Text fontSize="xs" fontWeight={600} color="var(--tt-muted, #9a9aa6)">
    {props.children}
  </Text>
);

type PatTokenRow = {
  id: string;
  name: string;
  scopes: string[];
  onlyCreatedThings?: boolean;
  visibility?: PatVisibilityMode;
  allowGet?: boolean;
  createdAt: string;
  expiresAt: string | null;
  maxUses: number | null;
  usesRemaining: number | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  status: 'active' | 'expired' | 'exhausted' | 'revoked';
};

// ---------------------------------------------------------------------------
// Duration helpers — the slider is logarithmic from 1ms to 10 years, with the
// far-right notch meaning "never expires".

const MS_MAX = 10 * 365 * 24 * 60 * 60 * 1000; // 10y — slider ceiling, not a mint cap
const SLIDER_MAX = 1000; // position 1000 = never

const msFromSlider = (position: number): number | null => {
  if (position >= SLIDER_MAX) return null;
  const t = Math.max(0, position) / (SLIDER_MAX - 1);
  return Math.max(1, Math.round(Math.exp(t * Math.log(MS_MAX))));
};

const sliderFromMs = (ms: number | null): number => {
  if (ms === null) return SLIDER_MAX;
  const clamped = Math.min(Math.max(ms, 1), MS_MAX);
  return Math.round(((SLIDER_MAX - 1) * Math.log(clamped)) / Math.log(MS_MAX));
};

const DURATION_UNITS: Array<{ id: string; label: string; ms: number }> = [
  { id: 'y', label: 'years', ms: 365 * 24 * 60 * 60 * 1000 },
  { id: 'd', label: 'days', ms: 24 * 60 * 60 * 1000 },
  { id: 'h', label: 'hours', ms: 60 * 60 * 1000 },
  { id: 'm', label: 'minutes', ms: 60 * 1000 },
  { id: 's', label: 'seconds', ms: 1000 },
  { id: 'ms', label: 'ms', ms: 1 }
];

const formatDuration = (ms: number | null): string => {
  if (ms === null) return 'never';
  for (const unit of DURATION_UNITS) {
    if (ms >= unit.ms) {
      const value = ms / unit.ms;
      const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
      return `${rounded}${unit.id}`;
    }
  }
  return `${Math.max(1, Math.round(ms))}ms`;
};

const relativeTime = (iso: string | null): string | null => {
  if (!iso) return null;
  const delta = new Date(iso).getTime() - Date.now();
  const magnitude = formatDuration(Math.abs(delta) || 1);
  return delta >= 0 ? `in ${magnitude}` : `${magnitude} ago`;
};

const EXPIRY_PRESETS: Array<{ label: string; ms: number | null }> = [
  { label: '1h', ms: 60 * 60 * 1000 },
  { label: '1d', ms: 24 * 60 * 60 * 1000 },
  { label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30d', ms: 30 * 24 * 60 * 60 * 1000 },
  { label: '1y', ms: 365 * 24 * 60 * 60 * 1000 },
  { label: 'Never ∞', ms: null }
];

const USES_PRESETS: Array<{ label: string; uses: number | null }> = [
  { label: 'Unlimited ∞', uses: null },
  { label: '1', uses: 1 },
  { label: '10', uses: 10 },
  { label: '1000', uses: 1000 }
];

const SCOPES_BY_ID = new Map(PAT_SCOPE_CATALOG.map((scope) => [scope.id, scope]));
const LEAF_SCOPES = PAT_SCOPE_CATALOG.filter((scope) => scope.id !== 'things');
const VISIBILITY_BY_ID = new Map(PAT_VISIBILITY_CATALOG.map((mode) => [mode.id, mode]));

// list-row badge for restricted tokens ('all' shows nothing — it's the default)
const summarizeVisibility = (visibility: PatVisibilityMode | undefined): string => {
  if (visibility !== 'public' && visibility !== 'private' && visibility !== 'hidden') return '';
  const mode = VISIBILITY_BY_ID.get(visibility);
  return mode ? ` · ${mode.emoji} ${mode.title.toLowerCase()}` : '';
};

const summarizeScopes = (scopes: string[]): string => {
  if (scopes.includes('things')) return '🗝️ full things access';
  return scopes
    .map((id) => {
      const scope = SCOPES_BY_ID.get(id);
      return scope ? `${scope.emoji} ${scope.title.toLowerCase()}` : id;
    })
    .join(' · ');
};

const STATUS_STYLES: Record<PatTokenRow['status'], { label: string; color: string; bg: string }> = {
  active: { label: 'Active', color: '#1a7f37', bg: 'rgba(26, 127, 55, 0.08)' },
  expired: { label: 'Expired', color: 'var(--tt-muted, #9a9aa6)', bg: 'var(--tt-surface-alt, #f5f5f7)' },
  exhausted: { label: 'Out of uses', color: '#9a6700', bg: 'rgba(154, 103, 0, 0.08)' },
  revoked: { label: 'Revoked', color: '#cf222e', bg: 'rgba(207, 34, 46, 0.08)' }
};

const chipVariant = (active: boolean) => (active ? 'solid' : 'outline');

// Best-fit unit for showing an ms value in the custom value+unit inputs.
const bestUnitFor = (ms: number): { value: string; unit: string } => {
  for (const unit of DURATION_UNITS) {
    if (ms >= unit.ms && ms % unit.ms === 0) return { value: String(ms / unit.ms), unit: unit.id };
  }
  for (const unit of DURATION_UNITS) {
    if (ms >= unit.ms) {
      const value = Math.round((ms / unit.ms) * 100) / 100;
      return { value: String(value), unit: unit.id };
    }
  }
  return { value: String(ms), unit: 'ms' };
};

export const TokenMinter = (props: { userId: string }) => {
  const api = useApi();
  const lopu = useLopu();

  // --- mint form state -----------------------------------------------------
  const [name, setName] = React.useState('');
  const [selectedScopes, setSelectedScopes] = React.useState<string[]>(['things']);
  const [onlyCreatedThings, setOnlyCreatedThings] = React.useState(false);
  const [visibility, setVisibility] = React.useState<PatVisibilityMode>('all');
  const [allowGet, setAllowGet] = React.useState(false);
  const [expiresInMs, setExpiresInMs] = React.useState<number | null>(30 * 24 * 60 * 60 * 1000);
  const [customValue, setCustomValue] = React.useState('30');
  const [customUnit, setCustomUnit] = React.useState('d');
  const [maxUses, setMaxUses] = React.useState<number | null>(null);
  const [customUses, setCustomUses] = React.useState('');
  const [minting, setMinting] = React.useState(false);
  const [minted, setMinted] = React.useState<{ token: string; example: string; docs: string } | null>(null);

  // --- token list — optimistic per the house rule: last-known list paints
  // instantly from the synchronous local cache, the server reconciles behind.
  const cacheKey = `tt-pat-tokens-${props.userId}`;
  const [tokens, setTokens] = React.useState<PatTokenRow[]>(() => readLocalCache<PatTokenRow[]>(cacheKey) || []);
  const [revoking, setRevoking] = React.useState<Record<string, boolean>>({});

  const saveTokens = React.useCallback(
    (next: PatTokenRow[] | ((prev: PatTokenRow[]) => PatTokenRow[])) => {
      setTokens((prev) => {
        const value = typeof next === 'function' ? next(prev) : next;
        writeLocalCache(cacheKey, value);
        return value;
      });
    },
    [cacheKey]
  );

  React.useEffect(() => {
    let cancelled = false;
    api.v1.tokens
      .list()
      .then((resp: any) => {
        if (cancelled || !Array.isArray(resp?.tokens)) return;
        saveTokens(resp.tokens);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.userId]);

  // --- scope selection: the 'things' chip is the master switch; unticking a
  // leaf while it's on converts to "every leaf except that one".
  const fullAccess = selectedScopes.includes('things');
  const scopeActive = (id: string) => fullAccess || selectedScopes.includes(id);

  const toggleScope = (id: string) => {
    if (id === 'things') {
      setSelectedScopes(fullAccess ? [] : ['things']);
      return;
    }
    if (fullAccess) {
      setSelectedScopes(LEAF_SCOPES.map((scope) => scope.id).filter((leaf) => leaf !== id));
      return;
    }
    setSelectedScopes((prev) => (prev.includes(id) ? prev.filter((scope) => scope !== id) : [...prev, id]));
  };

  // --- expiry: chips, log slider, and value+unit inputs all drive the same
  // expiresInMs; whichever moved last wins and the others follow.
  const applyExpiry = (ms: number | null) => {
    setExpiresInMs(ms);
    if (ms !== null) {
      const best = bestUnitFor(ms);
      setCustomValue(best.value);
      setCustomUnit(best.unit);
    }
  };

  const applyCustomExpiry = (value: string, unitId: string) => {
    setCustomValue(value);
    setCustomUnit(unitId);
    const parsed = Number(value);
    const unit = DURATION_UNITS.find((u) => u.id === unitId);
    if (Number.isFinite(parsed) && parsed > 0 && unit) {
      setExpiresInMs(Math.max(1, Math.round(parsed * unit.ms)));
    }
  };

  const applyUses = (uses: number | null) => {
    setMaxUses(uses);
    setCustomUses(uses === null ? '' : String(uses));
  };

  const applyCustomUses = (value: string) => {
    setCustomUses(value);
    const parsed = Math.floor(Number(value));
    if (Number.isFinite(parsed) && parsed >= 1) setMaxUses(parsed);
  };

  const expiryDatePreview =
    expiresInMs === null ? 'This token never expires ∞' : `Expires ${new Date(Date.now() + expiresInMs).toLocaleString()}`;

  const handleMint = async () => {
    const scopes = fullAccess ? ['things'] : selectedScopes;
    if (!scopes.length) {
      lopu({
        title: 'Pick at least one permission 🔐',
        description: 'A token with no permissions couldn’t do anything at all.',
        status: 'error'
      });
      return;
    }
    setMinting(true);
    try {
      const resp = await api.v1.tokens.mint({
        name: name.trim() || undefined,
        scopes,
        expiresInMs,
        maxUses,
        onlyCreatedThings,
        visibility,
        allowGet
      });
      setMinted({ token: resp.token, example: resp.example, docs: resp.docs });
      if (resp.tokenInfo) saveTokens((prev) => [resp.tokenInfo, ...prev.filter((t) => t.id !== resp.tokenInfo.id)]);
      setName('');
      lopu({ title: 'Token minted 🪙✨', description: 'Copy it now — it’s shown exactly once.', status: 'success', duration: 8000 });
    } catch (err: any) {
      lopu({
        title: 'Could not mint token 😔',
        description: err?.error || 'Please try again in a moment.',
        status: 'error'
      });
    } finally {
      setMinting(false);
    }
  };

  const handleCopy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      lopu({ title: `${what} copied 📋`, status: 'success', duration: 3000 });
    } catch {
      // clipboard can be blocked (permissions/unfocused tab) — short values
      // like grant entries surface in the toast so there's something to select
      lopu({
        title: 'Copy failed — select it manually',
        description: value.length <= 200 ? value : undefined,
        status: 'error',
        duration: 10000
      });
    }
  };

  const handleRevoke = async (token: PatTokenRow) => {
    if (revoking[token.id]) return;
    setRevoking((prev) => ({ ...prev, [token.id]: true }));
    const previous = tokens;
    // optimistic — the row flips to Revoked instantly and reverts on failure
    saveTokens((prev) =>
      prev.map((t) => (t.id === token.id ? { ...t, status: 'revoked' as const, revokedAt: new Date().toISOString() } : t))
    );
    try {
      await api.v1.tokens.revoke({ id: token.id });
      lopu({ title: `Revoked “${token.name}” 🔒`, description: 'That token stops working immediately.', status: 'success', duration: 5000 });
    } catch (err: any) {
      saveTokens(previous);
      lopu({ title: 'Could not revoke 😔', description: err?.error || 'Please try again in a moment.', status: 'error' });
    } finally {
      setRevoking((prev) => ({ ...prev, [token.id]: false }));
    }
  };

  return (
    <Flex flexDirection="column" rowGap={5}>
      {/* — mint form — */}
      <Flex flexDirection="column" rowGap={1}>
        <FieldLabel>Token name 🏷️</FieldLabel>
        <Input
          size="sm"
          value={name}
          placeholder="e.g. Claude research agent 🤖"
          onChange={(e) => setName(e.target.value)}
          {...inputStyles}
        />
      </Flex>

      <Flex flexDirection="column" rowGap={2}>
        <Flex alignItems="center">
          <FieldLabel>Permissions 🔐</FieldLabel>
          <Flex marginLeft="auto" columnGap={1}>
            <Button size="xs" variant="ghost" onClick={() => setSelectedScopes(['things'])}>
              Select all ✅
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setSelectedScopes([])}>
              Unselect all 🧹
            </Button>
          </Flex>
        </Flex>
        <Flex columnGap={1} rowGap={1} flexWrap="wrap">
          {PAT_SCOPE_CATALOG.map((scope) => (
            <Button
              key={scope.id}
              size="xs"
              variant={chipVariant(scopeActive(scope.id))}
              opacity={scope.id !== 'things' && fullAccess ? 0.75 : 1}
              title={scope.description}
              onClick={() => toggleScope(scope.id)}
            >
              {scope.emoji} {scope.title}
            </Button>
          ))}
        </Flex>
        <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" whiteSpace="normal">
          {fullAccess
            ? 'Full access — the token can do everything with your things. Untick a permission to narrow it.'
            : selectedScopes.length
              ? `This token can: ${summarizeScopes(selectedScopes)}`
              : 'Pick at least one permission.'}
        </Text>

        {/* sandbox: WHAT the token may do is the chips above; WHICH things it
            may do it to is this switch */}
        <Flex alignItems="center" columnGap={4} paddingTop={1}>
          <Box minWidth={0}>
            <Text fontSize="sm" color="var(--tt-ink, #16161a)">
              Only its own things 🧸
            </Text>
            <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" whiteSpace="normal">
              Everything it creates carries its own tt:token grant — updating, deleting, commenting, reacting,
              saving and sharing then only work on things granted to it. Layer tokens onto a thing by editing its
              tokenAcl list (copy a token’s grant entry below). Reading still follows the Read permission.
            </Text>
          </Box>
          <Box marginLeft="auto" flexShrink={0}>
            <Switch isChecked={onlyCreatedThings} onChange={(e) => setOnlyCreatedThings(e.target.checked)}></Switch>
          </Box>
        </Flex>

        {/* GET bridge: opt-in because the token rides the URL itself */}
        <Flex alignItems="center" columnGap={4} paddingTop={1}>
          <Box minWidth={0}>
            <Text fontSize="sm" color="var(--tt-ink, #16161a)">
              Works via GET links 🌍
            </Text>
            <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" whiteSpace="normal">
              Opens /api/v1/get to this token — the whole API as plain GET URLs with the token in a query
              param, so AIs that can only browse the web can still read and write your things. URLs land in
              logs and browser history, so tick this only for tokens you scope tightly.
            </Text>
          </Box>
          <Box marginLeft="auto" flexShrink={0}>
            <Switch isChecked={allowGet} onChange={(e) => setAllowGet(e.target.checked)}></Switch>
          </Box>
        </Flex>

        {/* visibility fence: the third axis — WHAT (permission chips), WHICH
            things (sandbox switch), and WHICH AUDIENCE (these toggles) */}
        <Flex flexDirection="column" rowGap={1} paddingTop={1}>
          <FieldLabel>Visibility 🌗</FieldLabel>
          <Flex columnGap={1} rowGap={1} flexWrap="wrap">
            {PAT_VISIBILITY_CATALOG.map((mode) => (
              <Button
                key={mode.id}
                size="xs"
                variant={chipVariant(visibility === mode.id)}
                title={mode.description}
                onClick={() => setVisibility(mode.id)}
              >
                {mode.emoji} {mode.title}
              </Button>
            ))}
          </Flex>
          <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" whiteSpace="normal">
            {visibility === 'public'
              ? 'Public only — the token can only see and touch public things. Your private things stay invisible to it, and everything it creates must be public.'
              : visibility === 'private'
                ? 'Private only — the token can only see and touch private (non-public) things. It can’t read the public feed, post publicly, or engage with public things; its creations default to private.'
                : visibility === 'hidden'
                  ? 'Hidden only — the token lives entirely in hidden link-key things 🕵️. Everything it creates is born hidden with a fresh secret link, and nothing outside the hidden world is visible or touchable to it.'
                  : 'Public & private — no audience fence. The token reaches everything its permissions above allow.'}
          </Text>
        </Flex>
      </Flex>

      <Flex flexDirection="column" rowGap={2}>
        <Flex alignItems="center">
          <FieldLabel>Expires ⏳</FieldLabel>
          <Text marginLeft="auto" fontSize="11px" fontFamily={MONO} color="var(--tt-muted, #9a9aa6)">
            {expiresInMs === null ? 'never ∞' : formatDuration(expiresInMs)}
          </Text>
        </Flex>
        <Flex columnGap={1} rowGap={1} flexWrap="wrap">
          {EXPIRY_PRESETS.map((preset) => (
            <Button
              key={preset.label}
              size="xs"
              variant={chipVariant(expiresInMs === preset.ms)}
              onClick={() => applyExpiry(preset.ms)}
            >
              {preset.label}
            </Button>
          ))}
        </Flex>
        {/* log-scale: the whole 1ms → 10y range in one drag; far right = never */}
        <Slider
          aria-label="Token expiry"
          value={sliderFromMs(expiresInMs)}
          min={0}
          max={SLIDER_MAX}
          step={1}
          onChange={(position) => applyExpiry(msFromSlider(position))}
        >
          <SliderTrack background="var(--tt-border, #ececef)">
            <SliderFilledTrack background="var(--tt-accent, #16161a)" />
          </SliderTrack>
          <SliderThumb boxShadow="0 1px 4px rgba(0,0,0,0.25)" />
        </Slider>
        <Flex alignItems="center" columnGap={2} rowGap={2} flexWrap="wrap">
          <Input
            size="xs"
            width="90px"
            type="number"
            min={1}
            value={expiresInMs === null ? '' : customValue}
            placeholder="∞"
            isDisabled={expiresInMs === null}
            onChange={(e) => applyCustomExpiry(e.target.value, customUnit)}
            {...inputStyles}
          />
          <Select
            size="xs"
            width="110px"
            value={customUnit}
            isDisabled={expiresInMs === null}
            onChange={(e) => applyCustomExpiry(customValue, e.target.value)}
            {...inputStyles}
          >
            {DURATION_UNITS.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.label}
              </option>
            ))}
          </Select>
          <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" whiteSpace="normal">
            {expiryDatePreview}
          </Text>
        </Flex>
      </Flex>

      <Flex flexDirection="column" rowGap={2}>
        <FieldLabel>Uses 🔋</FieldLabel>
        <Flex alignItems="center" columnGap={1} rowGap={1} flexWrap="wrap">
          {USES_PRESETS.map((preset) => (
            <Button
              key={preset.label}
              size="xs"
              variant={chipVariant(maxUses === preset.uses)}
              onClick={() => applyUses(preset.uses)}
            >
              {preset.label}
            </Button>
          ))}
          <Input
            size="xs"
            width="110px"
            type="number"
            min={1}
            value={customUses}
            placeholder="custom…"
            onChange={(e) => applyCustomUses(e.target.value)}
            {...inputStyles}
          />
        </Flex>
        <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" whiteSpace="normal">
          {maxUses === null
            ? 'Unlimited — the token works until it expires or you revoke it.'
            : `Every authenticated API call spends one use — after ${maxUses === 1 ? 'a single call' : `${maxUses} calls`} the token retires itself.`}
        </Text>
      </Flex>

      <Box>
        <RainbowButton size="sm" isLoading={minting} onClick={handleMint}>
          Mint token 🪙
        </RainbowButton>
      </Box>

      {/* — the one-time reveal — */}
      {minted && (
        <Flex
          flexDirection="column"
          rowGap={2}
          padding={4}
          borderRadius="var(--tt-radius-md, 12px)"
          border="1px dashed var(--tt-accent, #16161a)"
          background="var(--tt-surface-alt, #f5f5f7)"
        >
          <Text fontSize="sm" fontWeight={600}>
            Here’s your token — copy it now 🤫
          </Text>
          <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" whiteSpace="normal">
            This is the only time it’s shown. Hand it to your AI as a Bearer token — it can introspect itself at{' '}
            <Box as="span" fontFamily={MONO}>
              /api/v1/tokens/self
            </Box>{' '}
            and read the whole API at{' '}
            <Box as="span" fontFamily={MONO}>
              /api/docs
            </Box>
            .
          </Text>
          <Textarea
            readOnly
            value={minted.token}
            rows={3}
            fontSize="11px"
            fontFamily={MONO}
            onFocus={(e) => e.target.select()}
            {...inputStyles}
          />
          <Box
            as="pre"
            fontSize="11px"
            fontFamily={MONO}
            padding={2}
            borderRadius="var(--tt-radius-sm, 9px)"
            border="1px solid var(--tt-border, #ececef)"
            background="var(--tt-card, #ffffff)"
            overflowX="auto"
            whiteSpace="pre"
          >
            {minted.example}
          </Box>
          <Flex columnGap={2} rowGap={2} flexWrap="wrap">
            <Button size="xs" variant="solid" onClick={() => handleCopy(minted.token, 'Token')}>
              Copy token 📋
            </Button>
            <Button size="xs" variant="outline" onClick={() => handleCopy(minted.example, 'Example curl')}>
              Copy example 🧪
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setMinted(null)}>
              Done — hide it 🙈
            </Button>
          </Flex>
        </Flex>
      )}

      {/* — minted tokens — */}
      {tokens.length > 0 && (
        <Flex flexDirection="column" rowGap={0}>
          <FieldLabel>Your tokens 🎟️</FieldLabel>
          {tokens.map((token) => {
            const status = STATUS_STYLES[token.status] || STATUS_STYLES.active;
            const expires = token.expiresAt ? relativeTime(token.expiresAt) : null;
            const lastUsed = relativeTime(token.lastUsedAt);
            const meta: string[] = [];
            if (token.status === 'active') {
              meta.push(token.expiresAt ? `expires ${expires}` : 'never expires');
              meta.push(token.maxUses === null ? 'unlimited uses' : `${token.usesRemaining ?? 0}/${token.maxUses} uses left`);
            }
            meta.push(lastUsed ? `last used ${lastUsed}` : 'never used');
            return (
              <Flex key={token.id} alignItems="center" columnGap={3} paddingY={2} borderTop="1px solid var(--tt-border, #ececef)">
                <Box minWidth={0}>
                  <Flex alignItems="center" columnGap={2}>
                    <Text fontSize="sm" color="var(--tt-ink, #16161a)" noOfLines={1}>
                      {token.name}
                    </Text>
                    <Box
                      fontSize="10px"
                      fontWeight={600}
                      paddingX="6px"
                      paddingY="1px"
                      borderRadius="999px"
                      color={status.color}
                      background={status.bg}
                      flexShrink={0}
                    >
                      {status.label}
                    </Box>
                  </Flex>
                  <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" whiteSpace="normal">
                    {summarizeScopes(token.scopes)}
                    {token.onlyCreatedThings ? ' · 🧸 its own things only' : ''}
                    {summarizeVisibility(token.visibility)}
                    {token.allowGet ? ' · 🌍 GET links' : ''}
                  </Text>
                  <Text fontSize="11px" color="var(--tt-muted, #9a9aa6)" whiteSpace="normal">
                    {meta.join(' · ')}
                  </Text>
                </Box>
                <Flex marginLeft="auto" flexShrink={0} columnGap={1}>
                  <Button
                    size="xs"
                    variant="ghost"
                    title={`Copy this token’s grant entry — add it to a thing’s tokenAcl to let this token work that thing: tt:token/${token.id}`}
                    onClick={() => handleCopy(`tt:token/${token.id}`, 'Grant entry')}
                  >
                    Grant 🆔
                  </Button>
                  {token.status !== 'revoked' && (
                    <Button
                      size="xs"
                      variant="outline"
                      isLoading={!!revoking[token.id]}
                      onClick={() => handleRevoke(token)}
                    >
                      Revoke 🔒
                    </Button>
                  )}
                </Flex>
              </Flex>
            );
          })}
        </Flex>
      )}
    </Flex>
  );
};
