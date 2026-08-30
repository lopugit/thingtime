import React from 'react';
import {
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Icon,
  Link as ChakraLink,
  SimpleGrid,
  Stack,
  Text
} from '@chakra-ui/react';
import { Check, CheckCircle2, Copy, ExternalLink, Radio, ShieldCheck, Sparkles, Workflow } from 'lucide-react';

import {
  MCP_DEMO_FALLBACK_SNAPSHOT,
  mcpDemoScenarios,
  parseMcpDemoSnapshot,
  reviewPayloadForScenario,
  type McpDemoScenario,
  type McpDemoSnapshot,
  type McpDemoStep
} from './mcpDemoCore';

const MCP_PATH = '/api/v1/integrations/chatgpt/mcp';
const MANIFEST_PATH = '/.well-known/thingtime-chatgpt-capabilities.json';
const REVIEW_RESOURCE_URI = 'ui://thingtime/review.html';

type RpcResult = Record<string, unknown>;

const rpc = async (method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<RpcResult> => {
  const response = await fetch(MCP_PATH, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: `mcp-demo:${method}`, method, params }),
    signal
  });
  const payload = (await response.json()) as { result?: RpcResult; error?: { message?: string } };

  if (!response.ok || payload.error || !payload.result) {
    throw new Error(payload.error?.message || `MCP ${method} discovery failed (${response.status})`);
  }

  return payload.result;
};

const boundaryStyle: Record<McpDemoStep['boundary'], { label: string; bg: string; color: string }> = {
  read: { label: 'Read', bg: '#e9f7ef', color: '#17633a' },
  compose: { label: 'Compose', bg: '#eef1ff', color: '#394680' },
  confirm: { label: 'Confirm', bg: '#fff2d8', color: '#7a4a00' },
  recover: { label: 'Recover', bg: '#f7eefe', color: '#6e3687' }
};

const statItems = (snapshot: McpDemoSnapshot) => [
  { label: 'MCP version', value: snapshot.serverVersion },
  { label: 'Tools', value: String(snapshot.toolCount) },
  { label: 'Prompts', value: String(snapshot.promptCount) },
  { label: 'Resources', value: `${snapshot.resourceCount} + ${snapshot.resourceTemplateCount} templates` },
  { label: 'Features', value: String(snapshot.featureCount) },
  { label: 'Operations', value: String(snapshot.operationCount) }
];

const ScenarioButton = ({ scenario, selected, onSelect }: { scenario: McpDemoScenario; selected: boolean; onSelect: () => void }) => (
  <Box
    _hover={{ borderColor: selected ? 'var(--tt-docs-accent, #008060)' : 'var(--tt-faint, #b6b6c0)' }}
    aria-pressed={selected}
    as="button"
    bg={selected ? 'var(--tt-card, #ffffff)' : 'transparent'}
    border="1px solid"
    borderColor={selected ? 'var(--tt-docs-accent, #008060)' : 'var(--tt-border, #ececef)'}
    borderRadius="var(--tt-radius-lg, 16px)"
    boxShadow={selected ? '0 0 0 3px color-mix(in srgb, var(--tt-docs-accent, #008060) 10%, transparent)' : 'none'}
    cursor="pointer"
    data-testid={`mcp-scenario-${scenario.id}`}
    onClick={onSelect}
    p={4}
    textAlign="left"
    transition="border-color 140ms ease, box-shadow 140ms ease, background 140ms ease"
    type="button"
    w="100%"
  >
    <Text color="var(--tt-docs-accent, #008060)" fontFamily="mono" fontSize="10px" fontWeight="700" letterSpacing="0.1em" textTransform="uppercase">
      {scenario.eyebrow}
    </Text>
    <Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight="700" mt={1}>
      {scenario.title}
    </Text>
    <Text color="var(--tt-text, #5a5a66)" fontSize="xs" lineHeight="1.55" mt={1.5}>
      {scenario.summary}
    </Text>
  </Box>
);

export default function McpDemoPage() {
  const [selectedId, setSelectedId] = React.useState(mcpDemoScenarios[0].id);
  const [snapshot, setSnapshot] = React.useState<McpDemoSnapshot>(MCP_DEMO_FALLBACK_SNAPSHOT);
  const [liveState, setLiveState] = React.useState<'checking' | 'live' | 'fallback'>('checking');
  const [reviewHtml, setReviewHtml] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const reviewRef = React.useRef<HTMLIFrameElement>(null);
  const selected = mcpDemoScenarios.find((scenario) => scenario.id === selectedId) || mcpDemoScenarios[0];

  React.useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;

    const discover = async () => {
      try {
        const [initialize, tools, prompts, resources, resourceTemplates, resource, manifestResponse] = await Promise.all([
          rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'thingtime-limitless-lab', version: '1' } }, signal),
          rpc('tools/list', {}, signal),
          rpc('prompts/list', {}, signal),
          rpc('resources/list', {}, signal),
          rpc('resources/templates/list', {}, signal),
          rpc('resources/read', { uri: REVIEW_RESOURCE_URI }, signal),
          fetch(MANIFEST_PATH, { credentials: 'same-origin', signal })
        ]);
        let manifest: unknown;
        try {
          manifest = await manifestResponse.json();
        } catch {
          manifest = null;
        }
        const parsed = parseMcpDemoSnapshot({ initialize, tools, prompts, resources, resourceTemplates, manifest });
        const contents = resource.contents as Array<{ text?: unknown }> | undefined;
        const html = contents?.find((content) => typeof content.text === 'string')?.text;

        if (typeof html !== 'string') {
          throw new Error('Thingtime MCP discovery did not return the embedded review resource.');
        }
        setReviewHtml(html);

        if (!manifestResponse.ok || !parsed) {
          throw new Error('Thingtime MCP discovery returned an incomplete contract.');
        }

        setSnapshot(parsed);
        setLiveState('live');
      } catch (error) {
        if (!signal.aborted) {
          setLiveState('fallback');
        }
      }
    };

    void discover();
    return () => controller.abort();
  }, []);

  const sendReviewPayload = React.useCallback(() => {
    reviewRef.current?.contentWindow?.postMessage(
      {
        jsonrpc: '2.0',
        method: 'ui/notifications/tool-result',
        params: { structuredContent: reviewPayloadForScenario(selected) }
      },
      '*'
    );
  }, [selected]);

  React.useEffect(() => {
    if (reviewHtml) {
      sendReviewPayload();
    }
  }, [reviewHtml, sendReviewPayload]);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(selected.prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Stack spacing={{ base: 8, md: 10 }} minW={0}>
      <Box borderBottom="1px solid" borderColor="var(--tt-border, #ececef)" pb={{ base: 7, md: 9 }}>
        <Flex align="center" gap={2} mb={4} wrap="wrap">
          <Badge bg="#f0eaff" borderRadius="sm" color="#5a3d8d" px={2}>
            Limitless Lab
          </Badge>
          <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="sm">
            /docs/mcp
          </Text>
          <Flex align="center" gap={1.5} ml={{ base: 0, md: 'auto' }}>
            <Icon as={Radio} boxSize={3.5} color={liveState === 'live' ? '#16803a' : 'var(--tt-muted, #9a9aa6)'} />
            <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="xs">
              {liveState === 'live' ? 'Live contract verified' : liveState === 'checking' ? 'Checking live contract' : 'Showing release contract'}
            </Text>
          </Flex>
        </Flex>

        <Heading as="h2" color="var(--tt-ink, #16161a)" fontSize={{ base: '3xl', md: '5xl' }} letterSpacing="-0.035em" lineHeight="1.02" maxW="880px">
          One MCP. Tiny primitives. Limitless compositions.
        </Heading>
        <Text color="var(--tt-text, #5a5a66)" fontSize={{ base: 'md', md: 'lg' }} lineHeight="1.75" mt={5} maxW="780px">
          Explore five real workflows built from Thingtime's live MCP contract. Reads can flow freely; composed writes become bounded previews, signed receipts, explicit confirmation, history, and recoverable undo.
        </Text>

        <Flex gap={3} mt={6} wrap="wrap">
          <Button
            as={ChakraLink}
            bg="var(--tt-docs-accent, #008060)"
            borderRadius="var(--tt-radius-sm, 9px)"
            color="white"
            href={MANIFEST_PATH}
            isExternal
            rightIcon={<Icon as={ExternalLink} boxSize={4} />}
            size="sm"
            _hover={{ bg: 'var(--tt-docs-accent-hover, #006e52)', textDecoration: 'none' }}
          >
            Open capability manifest
          </Button>
          <Button
            as={ChakraLink}
            borderColor="var(--tt-border, #ececef)"
            borderRadius="var(--tt-radius-sm, 9px)"
            href="/docs/api/integrations/chatgpt-mcp"
            size="sm"
            variant="outline"
            _hover={{ textDecoration: 'none' }}
          >
            MCP API reference
          </Button>
        </Flex>
      </Box>

      <SimpleGrid columns={{ base: 2, md: 3, xl: 6 }} spacing={3}>
        {statItems(snapshot).map((item) => (
          <Box key={item.label} bg="var(--tt-card, #ffffff)" border="1px solid" borderColor="var(--tt-border, #ececef)" borderRadius="var(--tt-radius-md, 12px)" p={4}>
            <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="10px" letterSpacing="0.08em" textTransform="uppercase">
              {item.label}
            </Text>
            <Text color="var(--tt-ink, #16161a)" fontSize={{ base: 'md', md: 'lg' }} fontWeight="750" mt={1}>
              {item.value}
            </Text>
          </Box>
        ))}
      </SimpleGrid>

      <Box>
        <Flex align={{ base: 'flex-start', md: 'center' }} direction={{ base: 'column', md: 'row' }} gap={3} justify="space-between" mb={4}>
          <Box>
            <Text color="var(--tt-docs-accent, #008060)" fontFamily="mono" fontSize="11px" fontWeight="700" letterSpacing="0.12em" textTransform="uppercase">
              Choose a mission
            </Text>
            <Heading as="h3" color="var(--tt-ink, #16161a)" fontSize={{ base: 'xl', md: '2xl' }} mt={1}>
              Five examples, one composable contract
            </Heading>
          </Box>
          <Flex align="center" color="var(--tt-muted, #9a9aa6)" gap={2}>
            <Icon as={Workflow} boxSize={4} />
            <Text fontSize="sm">Select any card to replay its plan</Text>
          </Flex>
        </Flex>

        <SimpleGrid columns={{ base: 1, md: 2, xl: 5 }} spacing={3}>
          {mcpDemoScenarios.map((scenario) => (
            <ScenarioButton key={scenario.id} scenario={scenario} selected={scenario.id === selected.id} onSelect={() => setSelectedId(scenario.id)} />
          ))}
        </SimpleGrid>
      </Box>

      <Grid templateColumns={{ base: 'minmax(0, 1fr)', xl: 'minmax(0, 0.92fr) minmax(420px, 1.08fr)' }} gap={6} alignItems="start">
        <Stack spacing={5} minW={0}>
          <Box bg="var(--tt-card, #ffffff)" border="1px solid" borderColor="var(--tt-border, #ececef)" borderRadius="var(--tt-radius-lg, 16px)" p={{ base: 5, md: 6 }}>
            <Flex align="flex-start" gap={3} justify="space-between">
              <Box minW={0}>
                <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="10px" letterSpacing="0.1em" textTransform="uppercase">
                  Prompt to try
                </Text>
                <Heading as="h3" color="var(--tt-ink, #16161a)" fontSize="xl" mt={1}>
                  {selected.title}
                </Heading>
              </Box>
              <Button leftIcon={<Icon as={copied ? Check : Copy} boxSize={4} />} onClick={copyPrompt} size="xs" variant="outline">
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </Flex>
            <Text bg="var(--tt-surface, #f7f7f8)" borderRadius="var(--tt-radius-md, 12px)" color="var(--tt-text, #5a5a66)" fontFamily="mono" fontSize="sm" lineHeight="1.65" mt={5} p={4} whiteSpace="pre-wrap">
              {selected.prompt}
            </Text>
            <Flex align="flex-start" gap={2.5} mt={4}>
              <Icon as={Sparkles} boxSize={4} color="var(--tt-docs-accent, #008060)" flexShrink={0} mt={0.5} />
              <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.6">
                <Text as="span" color="var(--tt-ink, #16161a)" fontWeight="700">Expected outcome: </Text>
                {selected.result}
              </Text>
            </Flex>
          </Box>

          <Stack spacing={2.5}>
            {selected.steps.map((step, index) => {
              const style = boundaryStyle[step.boundary];
              return (
                <Flex key={`${selected.id}:${step.tool}`} align="flex-start" bg="var(--tt-card, #ffffff)" border="1px solid" borderColor="var(--tt-border, #ececef)" borderRadius="var(--tt-radius-md, 12px)" gap={3} p={4}>
                  <Flex align="center" bg="var(--tt-ink, #16161a)" borderRadius="full" color="white" flexShrink={0} fontFamily="mono" fontSize="11px" h={7} justify="center" w={7}>
                    {index + 1}
                  </Flex>
                  <Box minW={0} flex="1">
                    <Flex align="center" gap={2} wrap="wrap">
                      <Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight="700">{step.title}</Text>
                      <Badge bg={style.bg} color={style.color} fontSize="9px">{style.label}</Badge>
                    </Flex>
                    <Text color="var(--tt-text, #5a5a66)" fontSize="xs" lineHeight="1.55" mt={1}>{step.detail}</Text>
                    <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="10px" mt={2} overflowWrap="anywhere">{step.tool}</Text>
                  </Box>
                </Flex>
              );
            })}
          </Stack>
        </Stack>

        <Box minW={0} position={{ xl: 'sticky' }} top={{ xl: 5 }}>
          <Flex align="flex-start" bg="#f4fbf6" border="1px solid #cfe8d6" borderRadius="var(--tt-radius-md, 12px)" gap={3} mb={3} p={4}>
            <Icon as={ShieldCheck} boxSize={5} color="#17633a" flexShrink={0} />
            <Box>
              <Text color="#174d2f" fontSize="sm" fontWeight="700">The real shipped MCP App, in demo mode</Text>
              <Text color="#356248" fontSize="xs" lineHeight="1.55" mt={1}>
                This sandbox receives synthetic preview data only. It cannot connect an account or mutate a Thing. Try the tabs, selections, diff, details, and confirmation checkbox—the apply boundary will fail closed outside a real MCP host.
              </Text>
            </Box>
          </Flex>

          {reviewHtml ? (
            <Box bg="var(--tt-card, #ffffff)" border="1px solid" borderColor="var(--tt-border, #ececef)" borderRadius="20px" overflow="hidden">
              <Box borderBottom="1px solid" borderColor="var(--tt-border, #ececef)" px={4} py={3}>
                <Flex align="center" justify="space-between" gap={3}>
                  <Flex align="center" gap={2}>
                    <Icon as={CheckCircle2} boxSize={4} color="var(--tt-docs-accent, #008060)" />
                    <Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight="700">Interactive review</Text>
                  </Flex>
                  <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="10px">{REVIEW_RESOURCE_URI}</Text>
                </Flex>
              </Box>
              <Box
                as="iframe"
                border="0"
                data-testid="mcp-review-frame"
                h={{ base: '720px', md: '610px' }}
                onLoad={sendReviewPayload}
                ref={reviewRef}
                sandbox="allow-scripts"
                srcDoc={reviewHtml}
                title="Thingtime MCP review demo"
                w="100%"
              />
            </Box>
          ) : (
            <Flex align="center" bg="var(--tt-card, #ffffff)" border="1px solid" borderColor="var(--tt-border, #ececef)" borderRadius="20px" color="var(--tt-muted, #9a9aa6)" direction="column" h="360px" justify="center" px={6} textAlign="center">
              <Icon as={ShieldCheck} boxSize={7} mb={3} />
              <Text fontSize="sm">The release contract is available above. The live embedded resource could not be loaded in this browser session.</Text>
            </Flex>
          )}
        </Box>
      </Grid>
    </Stack>
  );
}
