import React from 'react';
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Collapse,
  Flex,
  FormControl,
  FormLabel,
  Heading,
  IconButton,
  Input,
	Menu,
	MenuButton,
	MenuItemOption,
	MenuList,
	MenuOptionGroup,
  Stack,
  Switch,
  Text
} from '@chakra-ui/react';
import { FiChevronDown, FiChevronUp, FiKey, FiPlus, FiTrash2 } from 'react-icons/fi';

import { useApi } from '~/hooks/useApi';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';

type Credential = {
  id: string;
  name: string;
	platform: string;
	credentialType: string;
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
};

type CredentialResponse = { ok: true; vaultConfigured: boolean; credentials: Credential[] };

export const ClaudeCredentialWaterfall = ({
  cacheIdentity,
  collapsed,
  onToggleCollapsed
}: {
  cacheIdentity: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) => {
  const api = useApi();
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const cacheKey = `tt-admin-ci-credential-waterfall-v1:${cacheIdentity}`;
  const [response, setResponse] = React.useState<CredentialResponse | null>(() => readLocalCache<CredentialResponse>(cacheKey));
  const [name, setName] = React.useState('');
	const [platform, setPlatform] = React.useState('Anthropic');
	const [customPlatform, setCustomPlatform] = React.useState('');
  const [value, setValue] = React.useState('');
  const [rotateId, setRotateId] = React.useState<string | null>(null);
  const [rotateValue, setRotateValue] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

	const accept = React.useCallback(
		(next: CredentialResponse) => {
    setResponse(next);
    writeLocalCache(cacheKey, next);
    setError(null);
		},
		[cacheKey]
	);

  React.useEffect(() => {
    const controller = new AbortController();
		apiRef.current.v1.admin
			.ciCredentials({ signal: controller.signal })
      .then((next) => next?.ok && accept(next))
      .catch((caught) => {
        if (!(caught instanceof Error && caught.name === 'AbortError')) setError('Could not refresh credential metadata.');
      });
    return () => controller.abort();
  }, [accept]);

  const mutate = async (action: Record<string, unknown>, key: string) => {
    setBusy(key);
    setError(null);
    try {
      const next = await apiRef.current.v1.admin.mutateCiCredential(action);
      if (!next?.ok) throw new Error(next?.error || 'Credential change failed.');
      accept(next);
      return true;
    } catch (caught: any) {
      setError(caught?.error || caught?.message || 'Credential change failed.');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const credentials = response?.credentials ?? [];
	const platformOptions = [...new Set(['Anthropic', 'OpenAI', 'Google', ...credentials.map((credential) => credential.platform)])];
  const move = async (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= credentials.length) return;
    const order = credentials.map((credential) => credential.id);
    [order[index], order[target]] = [order[target], order[index]];
    await mutate({ action: 'reorder', order }, `order:${credentials[index].id}`);
  };

  return (
    <Box border="1px solid var(--tt-border, #e7e7eb)" borderRadius="var(--tt-radius-md, 12px)" bg="var(--tt-card, #fff)" p={4} mb={4}>
      <Flex
        as="button"
        type="button"
        width="100%"
        textAlign="left"
        align="flex-start"
        justify="space-between"
        gap={3}
        wrap="wrap"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        aria-controls="ai-credential-waterfall-section"
      >
        <Box>
					<Heading size="sm">AI credential waterfall</Heading>
          <Text fontSize="sm" opacity={0.62} mt={1} maxW="760px">
            Lopu tries enabled accounts from top to bottom. Values are encrypted in Thingtime and are never shown again or stored in this browser.
          </Text>
        </Box>
				<Flex align="center" gap={2}>
					<Badge colorScheme={response?.vaultConfigured ? 'green' : 'orange'}>
						{response?.vaultConfigured ? 'Vault ready' : 'Vault not configured'}
					</Badge>
					{collapsed ? <FiChevronDown /> : <FiChevronUp />}
				</Flex>
      </Flex>

      <Collapse in={!collapsed} animateOpacity>
      <Box id="ai-credential-waterfall-section">

			{error ? (
				<Alert status="error" mt={3} borderRadius="md">
					<AlertIcon />
					{error}
				</Alert>
			) : null}
      {!response?.vaultConfigured ? (
				<Alert status="warning" mt={3} borderRadius="md">
					<AlertIcon />
					Configure THINGTIME_ADMIN_VAULT_KEY before adding credentials.
				</Alert>
      ) : null}

      <Stack spacing={2} mt={4}>
        {credentials.map((credential, index) => (
          <Box key={credential.id} border="1px solid var(--tt-border, #e7e7eb)" borderRadius="md" p={3}>
            <Flex align="center" gap={2} wrap="wrap">
              <Badge variant="outline">{index + 1}</Badge>
              <Box minW="160px" flex="1">
								<Text fontWeight="700" fontSize="sm">
									{credential.name}
								</Text>
								<Text fontSize="xs" opacity={0.5}>
									{credential.platform} · {credential.credentialType.replace(/-/g, ' ')} · updated {new Date(credential.updatedAt).toLocaleString()}
								</Text>
              </Box>
              <Flex align="center" gap={1}>
								<IconButton
									aria-label={`Move ${credential.name} up`}
									icon={<FiChevronUp />}
									size="sm"
									variant="ghost"
									isDisabled={index === 0 || Boolean(busy)}
									onClick={() => move(index, -1)}
								/>
								<IconButton
									aria-label={`Move ${credential.name} down`}
									icon={<FiChevronDown />}
									size="sm"
									variant="ghost"
									isDisabled={index === credentials.length - 1 || Boolean(busy)}
									onClick={() => move(index, 1)}
								/>
								<Switch
									aria-label={`Enable ${credential.name}`}
									isChecked={credential.enabled}
									isDisabled={Boolean(busy)}
									onChange={(event) =>
										mutate({ action: 'set-enabled', id: credential.id, enabled: event.target.checked }, `enabled:${credential.id}`)
									}
								/>
								<Button
									leftIcon={<FiKey />}
									size="sm"
									variant="ghost"
									isDisabled={Boolean(busy)}
									onClick={() => {
										setRotateId(rotateId === credential.id ? null : credential.id);
										setRotateValue('');
									}}
								>
									Rotate
								</Button>
                <IconButton
                  aria-label={`Delete ${credential.name}`}
                  icon={<FiTrash2 />}
                  size="sm"
                  colorScheme="red"
                  variant="ghost"
                  isDisabled={Boolean(busy)}
									onClick={() =>
										window.confirm(`Delete the encrypted credential “${credential.name}”?`) &&
										mutate({ action: 'delete', id: credential.id }, `delete:${credential.id}`)
									}
                />
              </Flex>
            </Flex>
            {rotateId === credential.id ? (
              <Flex mt={3} gap={2} direction={{ base: 'column', sm: 'row' }}>
								<Input
									type="password"
									autoComplete="new-password"
									value={rotateValue}
									onChange={(event) => setRotateValue(event.target.value)}
									placeholder="Paste replacement token"
								/>
								<Button
									isLoading={busy === `rotate:${credential.id}`}
									isDisabled={!rotateValue || Boolean(busy)}
									onClick={async () => {
										if (await mutate({ action: 'rotate', id: credential.id, value: rotateValue }, `rotate:${credential.id}`)) {
											setRotateId(null);
											setRotateValue('');
										}
									}}
								>
									Save replacement
								</Button>
              </Flex>
            ) : null}
          </Box>
        ))}
				{!credentials.length ? (
					<Text fontSize="sm" opacity={0.55}>
						No AI platform credentials are stored yet.
					</Text>
				) : null}
      </Stack>

      <Flex mt={4} gap={3} align="flex-end" direction={{ base: 'column', md: 'row' }}>
				<FormControl flex="0 1 190px">
					<FormLabel fontSize="xs">Platform</FormLabel>
					<Menu closeOnSelect={false}>
						<MenuButton as={Button} width="100%" variant="outline" rightIcon={<FiChevronDown />} textAlign="left">
							{platform}
						</MenuButton>
						<MenuList minW="260px" p={2}>
							<MenuOptionGroup type="radio" value={platform} onChange={(value) => setPlatform(String(value))}>
								{platformOptions.map((option) => (
									<MenuItemOption key={option} value={option}>
										{option}
									</MenuItemOption>
								))}
							</MenuOptionGroup>
							<Flex mt={2} pt={2} borderTop="1px solid var(--tt-border, #e7e7eb)" gap={2} onClick={(event) => event.stopPropagation()}>
								<Input
									size="sm"
									value={customPlatform}
									onChange={(event) => setCustomPlatform(event.target.value)}
									placeholder="Add platform…"
									maxLength={80}
								/>
								<Button
									size="sm"
									isDisabled={!customPlatform.trim()}
									onClick={() => {
										setPlatform(customPlatform.trim());
										setCustomPlatform('');
									}}
								>
									Add value
								</Button>
							</Flex>
						</MenuList>
					</Menu>
				</FormControl>
        <FormControl flex="1">
          <FormLabel fontSize="xs">Account name</FormLabel>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Thingtime Claude" />
        </FormControl>
        <FormControl flex="2">
					<FormLabel fontSize="xs">Credential value</FormLabel>
					<Input
						type="password"
						autoComplete="new-password"
						value={value}
						onChange={(event) => setValue(event.target.value)}
						placeholder="Paste once — it will not be shown again"
					/>
        </FormControl>
        <Button
          leftIcon={<FiPlus />}
          isLoading={busy === 'create'}
					isDisabled={!name.trim() || !platform.trim() || !value || Boolean(busy) || !response?.vaultConfigured || credentials.length >= 8}
          onClick={async () => {
						if (await mutate({ action: 'create', name, platform, value, enabled: true }, 'create')) {
              setName('');
              setValue('');
            }
          }}
        >
          Add token
        </Button>
      </Flex>
      </Box>
      </Collapse>
    </Box>
  );
};
