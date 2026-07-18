import React from 'react';
import { Box, Flex, Icon, IconButton, Text } from '@chakra-ui/react';
import { Check, Copy } from 'lucide-react';

// Shared docs code rendering: the dark code palette, the line-based syntax
// highlighter, the numbered CodeBlock, and the mac-chrome CodeWindow used by
// /docs/api and /docs/embed. Keep every docs code sample on this one path.

export const CODE_BG = '#0b0b0f';
export const CODE_BORDER = 'var(--tt-dark-border, #2a2a33)';
export const CODE_TEXT = '#e6e6ec';
export const CODE_MUTED = 'var(--tt-dark-muted, #8a8a95)';
export const CODE_GREEN = 'var(--tt-dark-accent, #59ff9c)';
export const CODE_BLUE = '#59bdff';
export const CODE_YELLOW = '#ffc20e';
export const CODE_ACCENT = 'var(--tt-accent, hotpink)';

export type CodeLanguage = 'json' | 'shell' | 'javascript' | 'python' | 'ruby' | 'html' | 'text';

export const copyToClipboard = async (value: string) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the legacy path for sandboxed preview browsers.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
};

const KEYWORDS =
  'const|let|var|await|async|function|return|if|else|throw|new|typeof|import|from|with|do|end|require|payload|response|request|headers|method|body|JSON|Net|HTTP|URI|document|window';

const tokenColor = (token: string, line: string, index: number, language: CodeLanguage) => {
  if (token.startsWith('#') || token.startsWith('//')) return CODE_MUTED;
  if (language === 'html' && (token.startsWith('<') || token === '>' || token === '/>')) return CODE_ACCENT;
  if (token === '$') return CODE_ACCENT;
  if (token.startsWith('-')) return CODE_BLUE;
  if (/^(GET|POST|PUT|PATCH|DELETE|HEAD)$/.test(token)) return CODE_YELLOW;
  if (/^-?\d+(?:\.\d+)?$/.test(token)) return CODE_YELLOW;
  if (/^(true|false|null|None|True|False)$/.test(token)) return CODE_ACCENT;
  if (/^['"]/.test(token)) {
    if (language === 'json' && token.startsWith('"') && /^\s*:/.test(line.slice(index + token.length))) {
      return CODE_BLUE;
    }

    return CODE_GREEN;
  }

  if (new RegExp(`^(${KEYWORDS})$`).test(token)) {
    return CODE_BLUE;
  }

  if (/^[{}[\]():,.;=+\\]$/.test(token)) return CODE_MUTED;

  return CODE_TEXT;
};

const buildTokenPattern = (tagAlternative: string) =>
  new RegExp(
    `${tagAlternative}("(?:\\\\.|[^"\\\\])*")|('(?:\\\\.|[^'\\\\])*')|(#[^\\n]*)|(\\/\\/[^\\n]*)|(\\$)|\\b(${KEYWORDS})\\b|\\b(GET|POST|PUT|PATCH|DELETE|HEAD)\\b|(--?[A-Za-z][A-Za-z0-9-]*)|(-?\\b\\d+(?:\\.\\d+)?\\b)|\\b(true|false|null|None|True|False)\\b|([{}\\[\\]():,.;=+\\\\])`,
    'g'
  );

const TOKEN_PATTERN = buildTokenPattern('');
// The html grammar adds tag delimiters (<div, </script, >, />) up front so
// they win over the operator group; every other language shares one pattern.
const HTML_TOKEN_PATTERN = buildTokenPattern('(<\\/?[A-Za-z][\\w-]*|\\/?>)|');

const tokenPatternFor = (language: CodeLanguage) => (language === 'html' ? HTML_TOKEN_PATTERN : TOKEN_PATTERN);

export const highlightLine = (line: string, language: CodeLanguage) => {
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const match of line.matchAll(tokenPatternFor(language))) {
    const token = match[0];
    const index = match.index || 0;

    if (index > cursor) {
      parts.push(line.slice(cursor, index));
    }

    parts.push(
      <Box as="span" color={tokenColor(token, line, index, language)} key={`${index}-${token}`}>
        {token}
      </Box>
    );
    cursor = index + token.length;
  }

  if (cursor < line.length) {
    parts.push(line.slice(cursor));
  }

  return parts.length ? parts : '\u00a0';
};

// html samples embed <script> bodies — highlight those inner lines as
// javascript so one quick-start snippet reads correctly end to end.
const lineLanguages = (lines: string[], language: CodeLanguage): CodeLanguage[] => {
  if (language !== 'html') return lines.map(() => language);

  let inScript = false;

  return lines.map((line) => {
    if (inScript) {
      if (/<\/script>/i.test(line)) {
        inScript = false;
        return 'html';
      }
      return 'javascript';
    }
    if (/<script\b[^>]*>(?!.*<\/script>)/i.test(line)) inScript = true;
    return 'html';
  });
};

export function CopyCodeButton({ code, label = 'Copy code' }: { code: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);

  const copy = React.useCallback(async () => {
    try {
      const copiedValue = await copyToClipboard(code);

      if (copiedValue) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1100);
      }
    } catch {
      // Clipboard access can be unavailable in sandboxed preview browsers.
    }
  }, [code]);

  return (
    <IconButton
      aria-label={copied ? 'Copied' : label}
      bg="rgba(255, 255, 255, 0.08)"
      border="1px solid rgba(255, 255, 255, 0.08)"
      color={copied ? CODE_GREEN : CODE_TEXT}
      _hover={{ bg: 'rgba(255, 255, 255, 0.14)' }}
      icon={<Icon as={copied ? Check : Copy} boxSize={4} />}
      onClick={copy}
      size="sm"
      variant="ghost"
    />
  );
}

export function CodeBlock({
  children,
  language = 'text',
  framed = true,
  maxH = '320px'
}: {
  children: string;
  language?: CodeLanguage;
  framed?: boolean;
  maxH?: string;
}) {
  const lines = String(children || '').split('\n');
  const lineLangs = lineLanguages(lines, language);

  return (
    <Box
      bg={CODE_BG}
      border={framed ? '2px solid' : '0'}
      borderColor={CODE_BORDER}
      color={CODE_TEXT}
      fontFamily="var(--tt-font-mono, ui-monospace, Menlo, monospace)"
      fontSize={{ base: '12px', md: '13px' }}
      lineHeight="1.75"
      maxH={maxH}
      overflow="auto"
      position="relative"
    >
      {framed ? (
        <Box position="absolute" right={2} top={2} zIndex={1}>
          <CopyCodeButton code={children} />
        </Box>
      ) : null}
      <Box as="pre" m={0} minW="max-content" px={{ base: 3, md: 4 }} py={framed ? 4 : 3} pr={framed ? 12 : 4}>
        <Box as="code" display="block">
          {lines.map((line, index) => (
            <Box
              as="span"
              display="grid"
              gap={3}
              gridTemplateColumns="3ch minmax(0, 1fr)"
              key={`${index}-${line}`}
              whiteSpace="pre"
            >
              <Box as="span" color={CODE_MUTED} textAlign="right" userSelect="none">
                {index + 1}
              </Box>
              <Box as="span">{highlightLine(line, lineLangs[index])}</Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

// A CodeBlock wrapped in editor-window chrome: traffic lights, a filename,
// the language tag, and a copy button.
export function CodeWindow({
  children,
  language = 'text',
  maxH = '480px',
  title
}: {
  children: string;
  language?: CodeLanguage;
  maxH?: string;
  title: string;
}) {
  return (
    <Box
      bg={CODE_BG}
      border="2px solid"
      borderColor={CODE_BORDER}
      borderRadius="var(--tt-radius-md, 12px)"
      color={CODE_TEXT}
      overflow="hidden"
    >
      <Flex
        align="center"
        bg="rgba(255, 255, 255, 0.04)"
        borderBottom="2px solid"
        borderColor={CODE_BORDER}
        gap={3}
        px={3}
        py={2}
      >
        <Flex flexShrink={0} gap="6px">
          <Box bg="#ff5f57" borderRadius="full" boxSize="10px" />
          <Box bg="#febc2e" borderRadius="full" boxSize="10px" />
          <Box bg="#28c840" borderRadius="full" boxSize="10px" />
        </Flex>
        <Text
          color={CODE_MUTED}
          fontFamily="var(--tt-font-mono, ui-monospace, Menlo, monospace)"
          fontSize="12px"
          noOfLines={1}
        >
          {title}
        </Text>
        <Flex align="center" gap={2} ml="auto">
          <Text
            color={CODE_MUTED}
            fontFamily="var(--tt-font-mono, ui-monospace, Menlo, monospace)"
            fontSize="11px"
            textTransform="uppercase"
          >
            {language}
          </Text>
          <CopyCodeButton code={children} />
        </Flex>
      </Flex>
      <CodeBlock framed={false} language={language} maxH={maxH}>
        {children}
      </CodeBlock>
    </Box>
  );
}
