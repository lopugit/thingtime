import React from 'react';
import { Badge, Box, Button, Flex, Image, Text } from '@chakra-ui/react';
import { Link } from 'react-router';
import { serviceGroupFor, type ServiceGroup } from '~/connections/catalog';
import { cardStyle, type Connection } from './shared';

export type Provider = {
  id: string;
  name: string;
  icon: string;
  auth: 'none' | 'oauth2' | 'credential';
  contentVisibility: 'public' | 'personal';
  about: string;
  configured: boolean;
  setupRequired?: 'provider' | 'vault' | null;
  service?: ServiceGroup;
  accountOnly?: boolean;
  fields: { key: string; label: string; placeholder?: string; help?: string; required?: boolean; secret?: boolean }[];
};
export function ServiceCatalog({
  providers,
  connections,
  signedOut,
  busy,
  openConnect,
  unlink,
  verify,
  form,
  connectingId
}: {
  providers: Provider[];
  connections: Connection[];
  signedOut: boolean;
  busy: boolean;
  openConnect: (provider: Provider) => void;
  unlink: (connection: Connection) => void;
  verify: (connection: Connection) => void;
  form: React.ReactNode;
  connectingId?: string;
}) {
  const groups = new Map<string, { service: ServiceGroup; providers: Provider[] }>();
  for (const provider of providers) {
    const service = provider.service || serviceGroupFor(provider);
    if (!groups.has(service.id)) groups.set(service.id, { service, providers: [] });
    groups.get(service.id)!.providers.push(provider);
  }
  return (
    <>
      {[...groups.values()]
        .sort((a, b) => {
          const priority = ['chatgpt', 'meta', 'google'];
          return (
            (priority.indexOf(a.service.id) < 0 ? 99 : priority.indexOf(a.service.id)) -
            (priority.indexOf(b.service.id) < 0 ? 99 : priority.indexOf(b.service.id))
          );
        })
        .map(({ service, providers: services }) => {
          const primary = services.find((provider) => provider.auth === 'oauth2') || services[0];
          const count = connections.filter((connection) => services.some((provider) => provider.id === connection.provider)).length;
          return (
            <Box as="section" key={service.id} id={`service-${service.id}`} aria-labelledby={`heading-${service.id}`} minW={0}>
              <Flex align="center" justify="space-between" gap={3} wrap="wrap" mb={4}>
                <Box minW={0} flex="1">
                  <Text as="h2" id={`heading-${service.id}`} fontSize="xl" fontWeight="700">
                    {service.icon} {service.name} <Badge ml={2}>{count} connected</Badge>
                  </Text>
                  {service.about && (
                    <Text mt={1} fontSize="sm" color="var(--tt-muted)">
                      {service.about}
                    </Text>
                  )}
                </Box>
                {services.length > 1 && (
                  <Button
                    size="sm"
                    variant="outline"
                    isDisabled={signedOut || busy || !primary.configured}
                    onClick={() => openConnect(primary)}
                    aria-label={`Add ${service.name} account`}
                  >
                    + Add account
                  </Button>
                )}
              </Flex>
              <Box
                display="grid"
                gridTemplateColumns={{ base: 'minmax(0, 1fr)', md: services.length > 1 ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)' }}
                gap={4}
              >
                {services.map((provider) => {
                  const accounts = connections.filter((connection) => connection.provider === provider.id);
                  return (
                    <Box as="article" key={provider.id} {...cardStyle} p={[4, 5]} minW={0} display="flex" flexDirection="column" gap={3}>
                      <Flex align="center" gap={2}>
                        <Text fontSize="xl" aria-hidden>
                          {provider.icon}
                        </Text>
                        <Text as="h3" fontWeight="700">
                          {provider.name}
                        </Text>
                      </Flex>
                      <Text fontSize="sm" color="var(--tt-muted)" flex="1">
                        {provider.about}
                      </Text>
                      <Text fontSize="xs" color="var(--tt-muted)">
                        {provider.auth === 'oauth2'
                          ? 'Sign in securely in a new tab'
                          : provider.auth === 'credential'
                          ? 'Connect with an app password'
                          : 'Public source · no sign-in required'}
                      </Text>
                      {accounts.map((account) => (
                        <Box key={account.id} borderTop="1px solid var(--tt-border)" pt={3} minW={0}>
                          <Flex gap={2} align="center">
                            {account.account.avatarUrl && (
                              <Image src={account.account.avatarUrl} alt="" boxSize="30px" borderRadius="full" referrerPolicy="no-referrer" />
                            )}
                            <Box minW={0}>
                              <Text fontSize="sm" fontWeight="600" overflowWrap="anywhere">
                                {account.account.displayName}
                              </Text>
                              <Text fontSize="xs" color="var(--tt-muted)" overflowWrap="anywhere">
                                {account.account.handle}
                              </Text>
                            </Box>
                          </Flex>
                          <Text fontSize="xs" mt={2}>
                            {account.credentialStatus === 'reconnect'
                              ? 'Reconnect to save a private authorization'
                              : provider.auth === 'none'
                              ? 'Public source connected'
                              : 'Authorization saved privately'}
                          </Text>
                          <Flex gap={1} mt={2} wrap="wrap">
                            {provider.auth === 'oauth2' && (
                              <>
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  isDisabled={busy || account.credentialStatus === 'reconnect'}
                                  onClick={() => verify(account)}
                                >
                                  Check connection
                                </Button>
                                <Button size="xs" variant="ghost" isDisabled={busy || !provider.configured} onClick={() => openConnect(provider)}>
                                  Reconnect
                                </Button>
                              </>
                            )}
                            {!provider.accountOnly && (
                              <Button as={Link} to={`/connections/feed?connection=${encodeURIComponent(account.id)}`} size="xs" variant="ghost">
                                Feed
                              </Button>
                            )}
                            <Button size="xs" variant="ghost" isDisabled={busy} onClick={() => unlink(account)}>
                              Disconnect
                            </Button>
                          </Flex>
                          {account.lastSyncError && (
                            <Text fontSize="xs" mt={1} overflowWrap="anywhere">
                              {account.lastSyncError}
                            </Text>
                          )}
                          {account.scopes?.length ? (
                            <Box as="details" mt={2}>
                              <Box as="summary" fontSize="xs" cursor="pointer">
                                Granted permissions
                              </Box>
                              <Text fontSize="xs" overflowWrap="anywhere">
                                {account.scopes.join('\n')}
                              </Text>
                            </Box>
                          ) : null}
                        </Box>
                      ))}
                      {!provider.configured && (
                        <Text fontSize="xs" color="var(--tt-muted)">
                          {provider.setupRequired === 'vault' ? 'Secure storage needs deployment setup.' : 'This service needs deployment setup.'}
                        </Text>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        isDisabled={!provider.configured || signedOut || busy}
                        onClick={() => openConnect(provider)}
                        aria-label={`Add account for ${provider.name}`}
                      >
                        {provider.id === 'chatgpt' ? 'Continue with ChatGPT' : '+ Add account'}
                      </Button>
                      {connectingId === provider.id ? form : null}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          );
        })}
    </>
  );
}
