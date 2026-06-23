import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Grid,
  Heading,
  Icon,
  Input,
  Select,
  Stack,
  Text,
  Textarea,
  useClipboard
} from '@chakra-ui/react';
import { Copy, FileCheck2, KeyRound, Link2, RefreshCw, ShieldCheck } from 'lucide-react';
import React, { useCallback, useState } from 'react';

type CryptoStandard = 'ES256' | 'ES384' | 'RS256' | 'EdDSA';
type KeyEncoding = 'auto' | 'pem' | 'escaped-pem' | 'base64-pem' | 'base64url-pem' | 'jwk-json';
type OutputEncoding = Exclude<KeyEncoding, 'auto'>;
type TextEncoding = 'utf8' | 'base64' | 'base64url' | 'hex';
type ApiResponse = { ok: boolean; result?: any; error?: string };

const standards: Array<{ value: CryptoStandard; label: string; keyId: string; auth?: boolean }> = [
  { value: 'ES256', label: 'ES256', keyId: 'thingtime-es256-1', auth: true },
  { value: 'ES384', label: 'ES384', keyId: 'thingtime-es384-1' },
  { value: 'RS256', label: 'RS256', keyId: 'thingtime-rs256-1' },
  { value: 'EdDSA', label: 'EdDSA', keyId: 'thingtime-eddsa-1' }
];

const keyEncodingOptions: Array<{ value: KeyEncoding; label: string }> = [
  { value: 'auto', label: 'Auto detect' },
  { value: 'pem', label: 'PEM / plain text' },
  { value: 'escaped-pem', label: 'Escaped PEM' },
  { value: 'base64-pem', label: 'Base64 PEM' },
  { value: 'base64url-pem', label: 'Base64url PEM' },
  { value: 'jwk-json', label: 'JWK JSON' }
];

const outputEncodingOptions: Array<{ value: OutputEncoding; label: string }> = keyEncodingOptions.filter(
  (item): item is { value: OutputEncoding; label: string } => item.value !== 'auto'
);

const textEncodingOptions: Array<{ value: TextEncoding; label: string }> = [
  { value: 'utf8', label: 'Plain text' },
  { value: 'base64', label: 'Base64' },
  { value: 'base64url', label: 'Base64url' },
  { value: 'hex', label: 'Hex' }
];

const PAGE_MAX_WIDTH = '920px';

const postCrypto = async (body: Record<string, unknown>) => {
  const res = await fetch('/api/v1/crypto', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = (await res.json()) as ApiResponse;
  if (!res.ok || !payload.ok) throw new Error(payload.error || 'Crypto request failed.');
  return payload.result;
};

const formatJson = (value: unknown) => (value ? JSON.stringify(value, null, 2) : '');

const encodingLabel = (encoding: KeyEncoding | OutputEncoding | TextEncoding) =>
  [...keyEncodingOptions, ...textEncodingOptions].find((item) => item.value === encoding)?.label || encoding;

const generatedKeyValue = (generated: any, encoding: OutputEncoding, kind: 'private' | 'public') => {
  if (!generated) return '';
  const prefix = kind === 'private' ? 'privateKey' : 'publicKey';
  if (encoding === 'pem') return generated[`${prefix}Pem`] || '';
  if (encoding === 'escaped-pem') return generated[`${prefix}EscapedPem`] || '';
  if (encoding === 'base64-pem') return generated[`${prefix}Base64`] || '';
  if (encoding === 'base64url-pem') return generated[`${prefix}Base64Url`] || '';
  return generated[`${prefix}JwkJson`] || '';
};

const generatedEnvValue = (generated: any, encoding: OutputEncoding) => {
  if (!generated) return '';
  if (encoding === 'pem') return generated.envPem || '';
  if (encoding === 'escaped-pem') return generated.envEscapedPem || '';
  if (encoding === 'base64-pem') return generated.envBase64 || generated.env || '';
  if (encoding === 'base64url-pem') return generated.envBase64Url || '';
  return generated.envJwkJson || '';
};

const CopyButton = ({ value, label = 'Copy' }: { value?: string; label?: string }) => {
  const { onCopy, hasCopied } = useClipboard(value || '');

  return (
    <Button
      size="xs"
      leftIcon={<Icon as={Copy} boxSize={3.5} />}
      onClick={onCopy}
      isDisabled={!value}
      variant="outline"
    >
      {hasCopied ? 'Copied' : label}
    </Button>
  );
};

const ToolPanel = ({
  title,
  icon,
  badge,
  children
}: {
  title: string;
  icon: React.ElementType;
  badge?: string;
  children: React.ReactNode;
}) => (
  <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" p={5} bg="white" w="100%" minW={0}>
    <Flex alignItems="center" justifyContent="space-between" gap={3} mb={4}>
      <Flex alignItems="center" gap={2}>
        <Icon as={icon} boxSize={5} color="teal.500" />
        <Heading size="sm">{title}</Heading>
      </Flex>
      {badge ? <Badge colorScheme="teal">{badge}</Badge> : null}
    </Flex>
    {children}
  </Box>
);

const OutputTextarea = ({ label, value, minH = '120px' }: { label: string; value?: string; minH?: string }) => (
  <FormControl>
    <Flex alignItems="center" justifyContent="space-between" gap={3} mb={2}>
      <FormLabel mb={0} fontSize="sm">
        {label}
      </FormLabel>
      <CopyButton value={value} />
    </Flex>
    <Textarea value={value || ''} minH={minH} readOnly fontFamily="mono" fontSize="xs" resize="vertical" maxW="100%" />
  </FormControl>
);

const JsonOutput = ({ value }: { value: unknown }) => (
  <Textarea value={formatJson(value)} minH="150px" readOnly fontFamily="mono" fontSize="xs" resize="vertical" maxW="100%" />
);

export default function CryptoPage() {
  const [standard, setStandard] = useState<CryptoStandard>('ES256');
  const [outputEncoding, setOutputEncoding] = useState<OutputEncoding>('base64-pem');
  const [issuer, setIssuer] = useState('https://thingtime.com');
  const [keyId, setKeyId] = useState('thingtime-es256-1');
  const [generated, setGenerated] = useState<any>(null);
  const [loadingGenerate, setLoadingGenerate] = useState(false);
  const [generateError, setGenerateError] = useState('');

  const [matchPrivateKey, setMatchPrivateKey] = useState('');
  const [matchPublicKey, setMatchPublicKey] = useState('');
  const [matchKeyEncoding, setMatchKeyEncoding] = useState<KeyEncoding>('auto');
  const [matchResult, setMatchResult] = useState<any>(null);
  const [loadingMatch, setLoadingMatch] = useState(false);
  const [matchError, setMatchError] = useState('');

  const [jwtToken, setJwtToken] = useState('');
  const [jwtPublicKey, setJwtPublicKey] = useState('');
  const [jwtPrivateKey, setJwtPrivateKey] = useState('');
  const [jwtKeyEncoding, setJwtKeyEncoding] = useState<KeyEncoding>('auto');
  const [jwtSecret, setJwtSecret] = useState('');
  const [jwtIssuer, setJwtIssuer] = useState('https://thingtime.com');
  const [jwtResult, setJwtResult] = useState<any>(null);
  const [loadingJwt, setLoadingJwt] = useState(false);
  const [jwtError, setJwtError] = useState('');

  const [signatureStandard, setSignatureStandard] = useState<CryptoStandard>('ES256');
  const [message, setMessage] = useState('');
  const [messageEncoding, setMessageEncoding] = useState<TextEncoding>('utf8');
  const [signature, setSignature] = useState('');
  const [signatureEncoding, setSignatureEncoding] = useState<'base64' | 'base64url' | 'hex'>('base64');
  const [signaturePublicKey, setSignaturePublicKey] = useState('');
  const [signaturePrivateKey, setSignaturePrivateKey] = useState('');
  const [signatureKeyEncoding, setSignatureKeyEncoding] = useState<KeyEncoding>('auto');
  const [signatureResult, setSignatureResult] = useState<any>(null);
  const [loadingSignature, setLoadingSignature] = useState(false);
  const [signatureError, setSignatureError] = useState('');

  const selectStandard = useCallback((value: CryptoStandard) => {
    setStandard(value);
    setKeyId(standards.find((item) => item.value === value)?.keyId || 'thingtime-es256-1');
  }, []);

  const generateKeys = useCallback(async () => {
    setLoadingGenerate(true);
    setGenerateError('');
    try {
      setGenerated(await postCrypto({ intent: 'generate-key-pair', standard, issuer, keyId }));
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingGenerate(false);
    }
  }, [issuer, keyId, standard]);

  const matchKeys = useCallback(async () => {
    setLoadingMatch(true);
    setMatchError('');
    try {
      setMatchResult(
        await postCrypto({
          intent: 'match-key-pair',
          privateKey: matchPrivateKey,
          publicKey: matchPublicKey,
          keyEncoding: matchKeyEncoding
        })
      );
    } catch (err) {
      setMatchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMatch(false);
    }
  }, [matchKeyEncoding, matchPrivateKey, matchPublicKey]);

  const verifyJwt = useCallback(async () => {
    setLoadingJwt(true);
    setJwtError('');
    try {
      setJwtResult(
        await postCrypto({
          intent: 'verify-jwt',
          token: jwtToken,
          publicKey: jwtPublicKey,
          privateKey: jwtPrivateKey,
          keyEncoding: jwtKeyEncoding,
          secret: jwtSecret,
          issuer: jwtIssuer
        })
      );
    } catch (err) {
      setJwtError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingJwt(false);
    }
  }, [jwtIssuer, jwtKeyEncoding, jwtPrivateKey, jwtPublicKey, jwtSecret, jwtToken]);

  const verifySignature = useCallback(async () => {
    setLoadingSignature(true);
    setSignatureError('');
    try {
      setSignatureResult(
        await postCrypto({
          intent: 'verify-signature',
          standard: signatureStandard,
          message,
          messageEncoding,
          signature,
          signatureEncoding,
          publicKey: signaturePublicKey,
          privateKey: signaturePrivateKey,
          keyEncoding: signatureKeyEncoding
        })
      );
    } catch (err) {
      setSignatureError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingSignature(false);
    }
  }, [message, messageEncoding, signature, signatureEncoding, signatureKeyEncoding, signaturePrivateKey, signaturePublicKey, signatureStandard]);

  return (
    <Box minH="100vh" w="100%" minW={0} bg="gray.50" pt={{ base: 28, md: 32 }} pb={{ base: 6, md: 10 }} px={{ base: 3, md: 12 }} display="flex" justifyContent="center">
      <Box as="main" data-testid="crypto-shell" maxW={PAGE_MAX_WIDTH} w="100%">
        <Flex alignItems="center" justifyContent="center" gap={4} mb={6} flexDirection="column" textAlign="center">
          <Box minW={0}>
            <Heading size="lg">Crypto</Heading>
            <Text color="gray.600" fontSize="sm" mt={1}>
              `/api/v1/crypto`
            </Text>
          </Box>
          <CopyButton value={generatedEnvValue(generated, outputEncoding)} label="Copy env" />
        </Flex>

        <Grid templateColumns={{ base: '1fr', xl: '1fr 1fr' }} gap={5} alignItems="start" w="100%">
          <ToolPanel title="Key Generator" icon={KeyRound} badge={standard === 'ES256' ? 'Thingtime auth' : undefined}>
            <Stack spacing={4}>
              <Flex gap={2} wrap="wrap">
                {standards.map((item) => (
                  <Button key={item.value} size="sm" variant={standard === item.value ? 'solid' : 'outline'} colorScheme={standard === item.value ? 'teal' : 'gray'} onClick={() => selectStandard(item.value)}>
                    {item.label}
                  </Button>
                ))}
              </Flex>
              <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={3}>
                <FormControl>
                  <FormLabel fontSize="sm">Output encoding</FormLabel>
                  <Select value={outputEncoding} onChange={(event) => setOutputEncoding(event.target.value as OutputEncoding)}>
                    {outputEncodingOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </FormControl>
                <FormControl>
                  <FormLabel fontSize="sm">JWT_KEY_ID</FormLabel>
                  <Input value={keyId} onChange={(event) => setKeyId(event.target.value)} />
                </FormControl>
              </Grid>
              <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={3}>
                <FormControl>
                  <FormLabel fontSize="sm">JWT_ISSUER</FormLabel>
                  <Input value={issuer} onChange={(event) => setIssuer(event.target.value)} />
                </FormControl>
              </Grid>
              <Button leftIcon={<Icon as={RefreshCw} boxSize={4} />} colorScheme="teal" onClick={generateKeys} isLoading={loadingGenerate} width="fit-content">
                Generate
              </Button>
              {generateError ? (
                <Alert status="error" borderRadius="md">
                  <AlertIcon />
                  {generateError}
                </Alert>
              ) : null}
              {generated ? (
                <Stack spacing={4}>
                  <OutputTextarea label={`Vercel env (${encodingLabel(outputEncoding)})`} value={generatedEnvValue(generated, outputEncoding)} minH="110px" />
                  <OutputTextarea label={`Private key (${encodingLabel(outputEncoding)})`} value={generatedKeyValue(generated, outputEncoding, 'private')} />
                  <OutputTextarea label={`Public key (${encodingLabel(outputEncoding)})`} value={generatedKeyValue(generated, outputEncoding, 'public')} />
                </Stack>
              ) : null}
            </Stack>
          </ToolPanel>

          <ToolPanel title="JWT Verify" icon={ShieldCheck}>
            <Stack spacing={4}>
              <FormControl>
                <FormLabel fontSize="sm">JWT</FormLabel>
                <Textarea value={jwtToken} onChange={(event) => setJwtToken(event.target.value)} minH="120px" fontFamily="mono" fontSize="xs" />
              </FormControl>
              <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={3}>
                <FormControl>
                  <FormLabel fontSize="sm">Public key</FormLabel>
                  <Textarea value={jwtPublicKey} onChange={(event) => setJwtPublicKey(event.target.value)} minH="110px" fontFamily="mono" fontSize="xs" />
                </FormControl>
                <FormControl>
                  <FormLabel fontSize="sm">Private key</FormLabel>
                  <Textarea value={jwtPrivateKey} onChange={(event) => setJwtPrivateKey(event.target.value)} minH="110px" fontFamily="mono" fontSize="xs" />
                </FormControl>
              </Grid>
              <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={3}>
                <FormControl>
                  <FormLabel fontSize="sm">Key encoding</FormLabel>
                  <Select value={jwtKeyEncoding} onChange={(event) => setJwtKeyEncoding(event.target.value as KeyEncoding)}>
                    {keyEncodingOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </FormControl>
                <FormControl>
                  <FormLabel fontSize="sm">Issuer</FormLabel>
                  <Input value={jwtIssuer} onChange={(event) => setJwtIssuer(event.target.value)} />
                </FormControl>
              </Grid>
              <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={3}>
                <FormControl>
                  <FormLabel fontSize="sm">HS secret</FormLabel>
                  <Input value={jwtSecret} onChange={(event) => setJwtSecret(event.target.value)} type="password" />
                </FormControl>
              </Grid>
              <Button leftIcon={<Icon as={ShieldCheck} boxSize={4} />} colorScheme="teal" onClick={verifyJwt} isLoading={loadingJwt} width="fit-content">
                Verify JWT
              </Button>
              {jwtError ? (
                <Alert status="error" borderRadius="md">
                  <AlertIcon />
                  {jwtError}
                </Alert>
              ) : null}
              <JsonOutput value={jwtResult} />
            </Stack>
          </ToolPanel>

          <ToolPanel title="Key Match" icon={Link2}>
            <Stack spacing={4}>
              <FormControl maxW={{ base: '100%', md: '280px' }}>
                <FormLabel fontSize="sm">Key encoding</FormLabel>
                <Select value={matchKeyEncoding} onChange={(event) => setMatchKeyEncoding(event.target.value as KeyEncoding)}>
                  {keyEncodingOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </FormControl>
              <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={3}>
                <FormControl>
                  <FormLabel fontSize="sm">Private key</FormLabel>
                  <Textarea value={matchPrivateKey} onChange={(event) => setMatchPrivateKey(event.target.value)} minH="140px" fontFamily="mono" fontSize="xs" />
                </FormControl>
                <FormControl>
                  <FormLabel fontSize="sm">Public key</FormLabel>
                  <Textarea value={matchPublicKey} onChange={(event) => setMatchPublicKey(event.target.value)} minH="140px" fontFamily="mono" fontSize="xs" />
                </FormControl>
              </Grid>
              <Button leftIcon={<Icon as={Link2} boxSize={4} />} colorScheme="teal" onClick={matchKeys} isLoading={loadingMatch} width="fit-content">
                Match keys
              </Button>
              {matchError ? (
                <Alert status="error" borderRadius="md">
                  <AlertIcon />
                  {matchError}
                </Alert>
              ) : null}
              <JsonOutput value={matchResult} />
            </Stack>
          </ToolPanel>

          <ToolPanel title="Signature Verify" icon={FileCheck2}>
            <Stack spacing={4}>
              <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={3}>
                <FormControl>
                  <FormLabel fontSize="sm">Standard</FormLabel>
                  <Select value={signatureStandard} onChange={(event) => setSignatureStandard(event.target.value as CryptoStandard)}>
                    {standards.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </FormControl>
                <FormControl>
                  <FormLabel fontSize="sm">Key encoding</FormLabel>
                  <Select value={signatureKeyEncoding} onChange={(event) => setSignatureKeyEncoding(event.target.value as KeyEncoding)}>
                    {keyEncodingOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={3}>
                <FormControl>
                  <FormLabel fontSize="sm">Message encoding</FormLabel>
                  <Select value={messageEncoding} onChange={(event) => setMessageEncoding(event.target.value as TextEncoding)}>
                    {textEncodingOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </FormControl>
                <FormControl>
                  <FormLabel fontSize="sm">Signature encoding</FormLabel>
                  <Select value={signatureEncoding} onChange={(event) => setSignatureEncoding(event.target.value as 'base64' | 'base64url' | 'hex')}>
                    <option value="base64">base64</option>
                    <option value="base64url">base64url</option>
                    <option value="hex">hex</option>
                  </Select>
                </FormControl>
              </Grid>
              <FormControl>
                <FormLabel fontSize="sm">Message</FormLabel>
                <Textarea value={message} onChange={(event) => setMessage(event.target.value)} minH="90px" fontFamily="mono" fontSize="xs" />
              </FormControl>
              <FormControl>
                <FormLabel fontSize="sm">Signature</FormLabel>
                <Textarea value={signature} onChange={(event) => setSignature(event.target.value)} minH="90px" fontFamily="mono" fontSize="xs" />
              </FormControl>
              <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={3}>
                <FormControl>
                  <FormLabel fontSize="sm">Public key</FormLabel>
                  <Textarea value={signaturePublicKey} onChange={(event) => setSignaturePublicKey(event.target.value)} minH="110px" fontFamily="mono" fontSize="xs" />
                </FormControl>
                <FormControl>
                  <FormLabel fontSize="sm">Private key</FormLabel>
                  <Textarea value={signaturePrivateKey} onChange={(event) => setSignaturePrivateKey(event.target.value)} minH="110px" fontFamily="mono" fontSize="xs" />
                </FormControl>
              </Grid>
              <Button leftIcon={<Icon as={FileCheck2} boxSize={4} />} colorScheme="teal" onClick={verifySignature} isLoading={loadingSignature} width="fit-content">
                Verify signature
              </Button>
              {signatureError ? (
                <Alert status="error" borderRadius="md">
                  <AlertIcon />
                  {signatureError}
                </Alert>
              ) : null}
              <JsonOutput value={signatureResult} />
            </Stack>
          </ToolPanel>
        </Grid>
      </Box>
    </Box>
  );
}
