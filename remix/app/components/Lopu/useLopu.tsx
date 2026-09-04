import { useCallback } from 'react';
import { Box, Flex, Text, useToast } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';
import { Link as RouterLink } from 'react-router';

import { RAINBOW, RAINBOW_PALETTE } from '~/theme/rainbow';
import { normalizeLopuMessage } from './lopuMessage';
import { lopuToastPlacement } from './lopuPosition';

// 🦄 Lopu — the Thingtime AI. A minimal, modern toast: a rainbow gradient
// "unicorn vomit" border around a clean white card, shown as a little message
// from Lopu in the corner the user picked (Settings → Appearance → Lopu
// messages; bottom-left by default). `useLopu` shows a one-shot toast; the
// streaming variant `useLopuStream` pops instantly and types the response in
// live. Placement (Chakra position + the per-toast flex container) comes from
// lopuToastPlacement() in lopuPosition.ts, read at fire time from the
// synchronous tt-lopu-position cache so no caller subscribes to settings state.

// Blinking caret/ellipsis uses the shared global `tt-blink` keyframes
// (defined once in GlobalStyles).

// Tiny rainbow countdown ring (bottom-right) that drains over the toast's
// remaining lifetime, then vanishes — a gentle "time left to read" cue. r=5 →
// circumference ≈ 31.42, animated via stroke-dashoffset (full → empty).
const drain = keyframes`from { stroke-dashoffset: 0 } to { stroke-dashoffset: 31.42 }`;

const CountdownRing = ({ ms }: { ms: number }) => (
	<Box position="absolute" bottom="6px" right="8px" pointerEvents="none" sx={{ '& .lopu-drain': { animation: `${drain} ${ms}ms linear forwards` } }}>
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <defs>
        {/* SVG gradient stops can't read CSS var() — use the palette hexes,
            ordered to match the RAINBOW border gradient (blue → purple → red → amber → green). */}
        <linearGradient id="lopu-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={RAINBOW_PALETTE[3]} />
          <stop offset="25%" stopColor={RAINBOW_PALETTE[4]} />
          <stop offset="50%" stopColor={RAINBOW_PALETTE[0]} />
          <stop offset="75%" stopColor={RAINBOW_PALETTE[1]} />
          <stop offset="100%" stopColor={RAINBOW_PALETTE[2]} />
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

type LopuStatus = 'success' | 'error' | 'info' | 'warning';

type LopuLink = { label: string; href: string };

const LOPU_LINK_STYLE = {
  mt: 2,
  display: 'inline-block',
  fontSize: 'xs',
  fontWeight: '700',
  color: 'purple.500',
  textDecoration: 'underline',
  wordBreak: 'break-all'
} as const;

const isInternalLopuHref = (href: string) => href.startsWith('/') && !href.startsWith('//');

type LopuArgs = {
  title?: string;
  description?: string;
  status?: LopuStatus;
  duration?: number;
  link?: LopuLink;
	announceDescription?: boolean;
	descriptionLabel?: string;
};

const statusEmoji = (status?: LopuStatus) => (status === 'success' ? '✨ ' : status === 'error' ? '🌧️ ' : '');

const LopuToast = ({
  title,
  description,
  status,
  link,
	announceDescription = true,
	descriptionLabel,
  loading,
  countdown,
  onClose
}: LopuArgs & { loading?: boolean; countdown?: number | null; onClose: () => void }) => (
  <Box
		className="lopuToast"
		role={announceDescription ? 'status' : 'group'}
    pointerEvents="auto"
    userSelect="text"
    p="2px"
    borderRadius="var(--tt-radius-xl, 20px)"
    background={RAINBOW}
    boxShadow="var(--tt-shadow-toast, 0 14px 38px rgba(20,20,40,0.18))"
    width="360px"
    maxWidth="calc(100vw - 24px)"
  >
		<Box bg="var(--tt-card, #ffffff)" borderRadius="calc(var(--tt-radius-xl, 20px) - 2px)" px={4} py={3} position="relative">
      <Flex align="center" gap={2} mb={title || description || loading ? 1.5 : 0}>
        <Text fontSize="md" lineHeight={1}>
          🦄
        </Text>
        <Text
          fontWeight="800"
          fontSize="sm"
          background={RAINBOW}
          sx={{ WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
        >
          Lopu
        </Text>
				<Text fontFamily="mono" fontSize="10px" fontWeight="500" letterSpacing="0.1em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)">
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
          width="28px"
          height="28px"
          margin="-4px"
          borderRadius="full"
          fontSize="xs"
          lineHeight={1}
          cursor="pointer"
          userSelect="none"
          color="var(--tt-faint, #b6b6c0)"
          _hover={{ color: 'var(--tt-ink, #16161a)', bg: 'var(--tt-surface-alt, #f5f5f7)' }}
          transition="all 140ms ease"
        >
          ✕
        </Box>
      </Flex>

      {loading && !title ? (
        <Text fontSize="sm" fontWeight="500" color="var(--tt-muted, #9a9aa6)" fontStyle="italic">
          Lopu is thinking
          <Box as="span" sx={{ animation: 'tt-blink 1s steps(1) infinite' }}>
            …
          </Box>
        </Text>
      ) : (
        title && (
					<Text role={announceDescription ? undefined : 'status'} fontSize="sm" fontWeight="600" color="var(--tt-ink, #16161a)">
            {statusEmoji(status)}
            {title}
            {loading && (
							<Box as="span" ml="1px" color="var(--tt-faint, #b6b6c0)" sx={{ animation: 'tt-blink 1s steps(1) infinite' }}>
                ▍
              </Box>
            )}
          </Text>
        )
      )}
      {description && (
				<Text
					fontSize="xs"
					color="var(--tt-muted, #9a9aa6)"
					mt="2px"
					maxH="min(55vh, 460px)"
					overflowY="auto"
					overflowWrap="anywhere"
					pr={1}
					whiteSpace="pre-wrap"
					role={announceDescription ? undefined : 'region'}
					aria-label={announceDescription ? undefined : descriptionLabel || 'Additional Thingtime message detail'}
					aria-live={announceDescription ? undefined : 'off'}
					tabIndex={announceDescription ? undefined : 0}
				>
          {description}
        </Text>
      )}
      {link &&
        (isInternalLopuHref(link.href) ? (
          <Box as={RouterLink} to={link.href} {...LOPU_LINK_STYLE}>
            {link.label}
          </Box>
        ) : (
          <Box as="a" href={link.href} {...LOPU_LINK_STYLE}>
            {link.label}
          </Box>
        ))}
      {!loading && countdown ? <CountdownRing ms={countdown} /> : null}
    </Box>
  </Box>
);

export const useLopu = () => {
  const toast = useToast();

  return useCallback(
		({ title, description, status, duration = 13000, link, announceDescription, descriptionLabel }: LopuArgs) => {
      const message = normalizeLopuMessage({ title, description, status });
      return toast({
        duration,
        ...lopuToastPlacement(),
        render: ({ onClose }) => (
          <LopuToast
            title={message.title}
            description={message.description}
            status={status}
            link={link}
						announceDescription={announceDescription}
						descriptionLabel={descriptionLabel}
            countdown={duration}
            onClose={onClose}
          />
        )
      });
    },
    [toast]
  );
};

// Privacy-sensitive callers can close every Lopu surface when their owning
// screen unmounts or the authenticated account changes.
export const useDismissLopu = () => {
	const toast = useToast();
	return useCallback(() => toast.closeAll(), [toast]);
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

      // Pop instantly; duration:null keeps it open while streaming. Placement is
      // fixed for the toast's lifetime (Chakra can't move an open toast).
      const placement = lopuToastPlacement();
      const id = toast({
        duration: null,
        ...placement,
        render: render({ loading: true })
      });

      const update = (props: LopuArgs & { loading?: boolean; countdown?: number | null }, duration: number | null) =>
        toast.update(id, { duration, containerStyle: placement.containerStyle, render: render(props) });

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
        update({ title: text.trim() || 'Lopu is daydreaming…', description: sourceLabel(source), countdown: 16000 }, 16000);
      } catch (err: any) {
        if (err?.name === 'AbortError') return; // user closed it — leave closed
        update({ title: 'Lopu is daydreaming… try again 🔮', status: 'error', countdown: 13000 }, 13000);
      }
    },
    [toast]
  );
};
