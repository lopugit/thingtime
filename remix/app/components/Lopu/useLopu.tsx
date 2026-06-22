import { useCallback } from 'react';
import { Box, Flex, Text, useToast } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';

// 🦄 Lopu — the Thingtime AI. A minimal, modern toast: a rainbow gradient
// "unicorn vomit" border around a clean white card, shown as a little message
// from Lopu, below the fixed nav. `useLopu` shows a one-shot toast; the streaming
// variant `useLopuStream` pops instantly and types the response in live.

const RAINBOW = 'linear-gradient(120deg, #47b5e6, #a555e8, #f34a4a, #ffbc48, #58ca70, #47b5e6)';

// A full-viewport flex container centers the card via flow (immune to the
// ancestor-transform quirk that broke translateX(-50%) centering). translateY
// offsets each toast below the nav *visually only* — it doesn't affect layout,
// so Chakra's native tight stacking + slide/fade animation is preserved
// (marginTop would compound into big gaps). pointerEvents:none keeps the wide
// invisible container from eating clicks (the card re-enables them).
const CONTAINER_STYLE = {
  transform: 'translateY(70px)',
  width: '100vw',
  maxWidth: '100vw',
  display: 'flex',
  justifyContent: 'center',
  pointerEvents: 'none'
} as const;

const blink = keyframes`0%, 100% { opacity: 1 } 50% { opacity: 0 }`;

type LopuStatus = 'success' | 'error' | 'info';

type LopuLink = { label: string; href: string };

type LopuArgs = {
  title?: string;
  description?: string;
  status?: LopuStatus;
  duration?: number;
  link?: LopuLink;
};

const statusEmoji = (status?: LopuStatus) => (status === 'success' ? '✨ ' : status === 'error' ? '🌧️ ' : '');

const LopuToast = ({
  title,
  description,
  status,
  link,
  loading,
  onClose
}: LopuArgs & { loading?: boolean; onClose: () => void }) => (
  <Box
    role="status"
    pointerEvents="auto"
    p="2px"
    borderRadius="20px"
    backgroundImage={RAINBOW}
    boxShadow="0 10px 34px rgba(0,0,0,0.14)"
    width="360px"
    maxWidth="calc(100vw - 24px)"
  >
    <Box bg="white" borderRadius="18px" px={4} py={3}>
      <Flex align="center" gap={2} mb={title || description || loading ? 1.5 : 0}>
        <Text fontSize="md" lineHeight={1}>
          🦄
        </Text>
        <Text
          fontWeight="800"
          fontSize="sm"
          backgroundImage={RAINBOW}
          sx={{ WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
        >
          Lopu
        </Text>
        <Text fontSize="10px" opacity={0.4} fontWeight="500">
          Thingtime AI
        </Text>
        <Box flex={1} />
        <Box
          as="button"
          type="button"
          onClick={onClose}
          aria-label="Close"
          fontSize="xs"
          lineHeight={1}
          color="gray.400"
          _hover={{ color: 'gray.700' }}
          transition="color 120ms"
        >
          ✕
        </Box>
      </Flex>

      {loading && !title ? (
        <Text fontSize="sm" fontWeight="500" color="gray.400" fontStyle="italic">
          Lopu is thinking
          <Box as="span" sx={{ animation: `${blink} 1s steps(1) infinite` }}>
            …
          </Box>
        </Text>
      ) : (
        title && (
          <Text fontSize="sm" fontWeight="600" color="gray.800">
            {statusEmoji(status)}
            {title}
            {loading && (
              <Box as="span" ml="1px" color="gray.400" sx={{ animation: `${blink} 1s steps(1) infinite` }}>
                ▍
              </Box>
            )}
          </Text>
        )
      )}
      {description && (
        <Text fontSize="xs" color="gray.500" mt="2px">
          {description}
        </Text>
      )}
      {link && (
        <Box
          as="a"
          href={link.href}
          mt={2}
          display="inline-block"
          fontSize="xs"
          fontWeight="700"
          color="purple.500"
          textDecoration="underline"
          wordBreak="break-all"
        >
          {link.label}
        </Box>
      )}
    </Box>
  </Box>
);

export const useLopu = () => {
  const toast = useToast();

  return useCallback(
    ({ title, description, status, duration = 5000, link }: LopuArgs) =>
      toast({
        duration,
        position: 'top',
        containerStyle: CONTAINER_STYLE,
        render: ({ onClose }) => (
          <LopuToast title={title} description={description} status={status} link={link} onClose={onClose} />
        )
      }),
    [toast]
  );
};

const sourceLabel = (source?: string) =>
  source === 'claude' ? 'via Claude 🤖' : source === 'openai' ? 'via ChatGPT 🤖' : "from Lopu's little book 📖";

// Streaming musing toast: appears immediately with "Lopu is thinking…", then the
// response types in live (NDJSON from /api/v1/lopu/musing), à la modern AI chat.
export const useLopuStream = () => {
  const toast = useToast();

  return useCallback(
    async (url: string) => {
      const controller = new AbortController();

      const render =
        (props: LopuArgs & { loading?: boolean }) =>
        ({ onClose }: { onClose: () => void }) => {
          const close = () => {
            controller.abort();
            onClose();
          };
          return <LopuToast {...props} onClose={close} />;
        };

      // Pop instantly; duration:null keeps it open while streaming.
      const id = toast({
        duration: null,
        position: 'top',
        containerStyle: CONTAINER_STYLE,
        render: render({ loading: true })
      });

      const update = (props: LopuArgs & { loading?: boolean }, duration: number | null) =>
        toast.update(id, { duration, containerStyle: CONTAINER_STYLE, render: render(props) });

      let text = '';
      let source: string | undefined;

      try {
        const resp = await fetch(url, { signal: controller.signal });
        if (!resp.ok || !resp.body) throw new Error('no stream');
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            let ev: any;
            try {
              ev = JSON.parse(line);
            } catch {
              continue;
            }
            if (ev.type === 'meta') {
              source = ev.source;
            } else if (ev.type === 'delta') {
              text += ev.text;
              update({ title: text, description: sourceLabel(source), loading: true }, null);
            }
          }
        }

        update({ title: text.trim() || 'Lopu is daydreaming…', description: sourceLabel(source) }, 6000);
      } catch (err: any) {
        if (err?.name === 'AbortError') return; // user closed it — leave closed
        update({ title: 'Lopu is daydreaming… try again 🔮', status: 'error' }, 5000);
      }
    },
    [toast]
  );
};
