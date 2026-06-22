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

// Tiny rainbow countdown ring (bottom-right) that drains over the toast's
// remaining lifetime, then vanishes — a gentle "time left to read" cue. r=5 →
// circumference ≈ 31.42, animated via stroke-dashoffset (full → empty).
const drain = keyframes`from { stroke-dashoffset: 0 } to { stroke-dashoffset: 31.42 }`;

const CountdownRing = ({ ms }: { ms: number }) => (
  <Box
    position="absolute"
    bottom="6px"
    right="8px"
    pointerEvents="none"
    sx={{ '& .lopu-drain': { animation: `${drain} ${ms}ms linear forwards` } }}
  >
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <defs>
        <linearGradient id="lopu-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#47b5e6" />
          <stop offset="35%" stopColor="#a555e8" />
          <stop offset="65%" stopColor="#f34a4a" />
          <stop offset="100%" stopColor="#58ca70" />
        </linearGradient>
      </defs>
      <circle cx="7" cy="7" r="5" fill="none" stroke="#edf2f7" strokeWidth="2" />
      <circle
        className="lopu-drain"
        cx="7"
        cy="7"
        r="5"
        fill="none"
        stroke="url(#lopu-ring)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="31.42"
        transform="rotate(-90 7 7)"
      />
    </svg>
  </Box>
);

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
  countdown,
  onClose
}: LopuArgs & { loading?: boolean; countdown?: number | null; onClose: () => void }) => (
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
    <Box bg="white" borderRadius="18px" px={4} py={3} position="relative">
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
          display="flex"
          alignItems="center"
          justifyContent="center"
          width="20px"
          height="20px"
          borderRadius="full"
          fontSize="xs"
          lineHeight={1}
          color="gray.400"
          _hover={{ color: 'gray.700', bg: 'gray.100' }}
          transition="all 120ms"
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
      {!loading && countdown ? <CountdownRing ms={countdown} /> : null}
    </Box>
  </Box>
);

export const useLopu = () => {
  const toast = useToast();

  return useCallback(
    ({ title, description, status, duration = 15000, link }: LopuArgs) =>
      toast({
        duration,
        position: 'top',
        containerStyle: CONTAINER_STYLE,
        render: ({ onClose }) => (
          <LopuToast
            title={title}
            description={description}
            status={status}
            link={link}
            countdown={duration}
            onClose={onClose}
          />
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
        (props: LopuArgs & { loading?: boolean; countdown?: number | null }) =>
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

      const update = (props: LopuArgs & { loading?: boolean; countdown?: number | null }, duration: number | null) =>
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

        // The read-timer starts now (stream finished), not when the toast popped,
        // so you get the full window to read the finished musing.
        update({ title: text.trim() || 'Lopu is daydreaming…', description: sourceLabel(source), countdown: 18000 }, 18000);
      } catch (err: any) {
        if (err?.name === 'AbortError') return; // user closed it — leave closed
        update({ title: 'Lopu is daydreaming… try again 🔮', status: 'error', countdown: 15000 }, 15000);
      }
    },
    [toast]
  );
};
