import { Box, Button, Collapse, Flex, Heading, Input, Text } from '@chakra-ui/react';
import React from 'react';

import { useLopu } from '~/components/Lopu/useLopu';
import { downloadBrandExport } from './brandingExport';
import { buildLogoSvg } from './logoMatrix';
import type { LogoColourMap, LogoMatrix } from './logoMatrix';

// One full-width brand section per logo variant (branding redesign of
// claude-todo/08 §3): big clean preview, ready-made file grid from the
// committed manifest, and a tucked-away custom exporter with per-side padding.

type ManifestPng = { w: number; h: number; url: string; bytes: number };
export type ManifestVariant = {
  slug: string;
  name: string;
  aspect: { cols: number; rows: number };
  svg: { url: string; bytes: number };
  pngs: ManifestPng[];
};

const MONO = 'var(--tt-font-mono, "JetBrains Mono", monospace)';
const HEAD = 'var(--tt-font-heading, "Space Grotesk", sans-serif)';

const formatBytes = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <Text fontFamily={MONO} fontSize="11px" fontWeight={600} letterSpacing="0.16em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)">
    {children}
  </Text>
);

const PrimaryButton = (props: React.ComponentProps<typeof Button>) => (
  <Button
    size="sm"
    height="38px"
    px={5}
    borderRadius="11px"
    bg="var(--tt-ink, #16161a)"
    color="var(--tt-card, #fff)"
    fontWeight={600}
    _hover={{ opacity: 0.88, boxShadow: '0 6px 20px rgba(0,0,0,.16)' }}
    _active={{ opacity: 0.8 }}
    {...props}
  />
);

const QuietButton = (props: React.ComponentProps<typeof Button>) => (
  <Button
    size="sm"
    height="38px"
    px={4}
    borderRadius="11px"
    bg="transparent"
    color="var(--tt-text, #5a5a66)"
    fontWeight={600}
    _hover={{ bg: 'var(--tt-surface-alt, #f5f5f7)' }}
    _active={{ bg: 'var(--tt-surface-alt, #f5f5f7)' }}
    {...props}
  />
);

// Design-language segmented control (Prism): soft container, white active pill.
const Segmented = <T extends string>({
  options,
  value,
  onChange,
  label
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  label: string;
}) => (
  <Flex role="group" aria-label={label} bg="var(--tt-surface-alt, #f1f1f3)" borderRadius="11px" p="3px" width="fit-content">
    {options.map((option) => {
      const active = option.value === value;
      return (
        <Box
          as="button"
          type="button"
          key={option.value}
          onClick={() => onChange(option.value)}
          px="12px"
          height="30px"
          borderRadius="9px"
          fontSize="13px"
          fontWeight={600}
          fontFamily="inherit"
          color={active ? 'var(--tt-ink, #16161a)' : 'var(--tt-muted, #9a9aa6)'}
          bg={active ? 'var(--tt-card, #fff)' : 'transparent'}
          boxShadow={active ? '0 1px 2px rgba(0,0,0,.06)' : 'none'}
          transition="all 140ms ease"
        >
          {option.label}
        </Box>
      );
    })}
  </Flex>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <Flex flexDir="column" gap="6px">
    <Text fontFamily={MONO} fontSize="10px" fontWeight={600} letterSpacing="0.12em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)">
      {label}
    </Text>
    {children}
  </Flex>
);

const NumberBox = ({
  value,
  onChange,
  width = '92px',
  min = 0,
  max = 20000,
  ariaLabel
}: {
  value: number;
  onChange: (next: number) => void;
  width?: string;
  min?: number;
  max?: number;
  ariaLabel: string;
}) => (
  <Input
    type="number"
    aria-label={ariaLabel}
    value={Number.isFinite(value) ? value : ''}
    min={min}
    max={max}
    onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value) || 0)))}
    width={width}
    height="34px"
    fontSize="14px"
    fontFamily={MONO}
    bg="var(--tt-surface-alt, #f5f5f7)"
    border="none"
    borderRadius="9px"
    _focusVisible={{ boxShadow: '0 0 0 2px var(--tt-rainbow-4, #47b5e6)' }}
  />
);

const BACKGROUNDS: Array<{ value: string; label: string }> = [
  { value: 'transparent', label: 'Transparent' },
  { value: '#ffffff', label: 'White' },
  { value: '#16161a', label: 'Ink' }
];

export const BrandAssetSection = ({
  eyebrow,
  title,
  description,
  slug,
  matrix,
  colourMap,
  manifest
}: {
  eyebrow: string;
  title: string;
  description: string;
  slug: string;
  matrix: LogoMatrix;
  colourMap: LogoColourMap;
  manifest?: ManifestVariant;
}) => {
  const lopu = useLopu();
  const [panel, setPanel] = React.useState<'light' | 'dark'>('light');
  const [exportOpen, setExportOpen] = React.useState(false);
  const [format, setFormat] = React.useState<'svg' | 'png'>('png');
  const [width, setWidth] = React.useState(1024);
  const [padAll, setPadAll] = React.useState(0);
  const [perSide, setPerSide] = React.useState(false);
  const [pads, setPads] = React.useState({ top: 0, right: 0, bottom: 0, left: 0 });
  const [background, setBackground] = React.useState('transparent');
  const [busy, setBusy] = React.useState(false);

  const { svg, columns, rows } = React.useMemo(() => buildLogoSvg({ matrix, colourMap }), [matrix, colourMap]);
  const previewUri = React.useMemo(() => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, [svg]);
  const horizontal = columns > rows;

  const padding = perSide ? pads : { top: padAll, right: padAll, bottom: padAll, left: padAll };

  const runExport = async () => {
    setBusy(true);
    try {
      const { filename } = await downloadBrandExport({
        matrix,
        colourMap,
        slug,
        format,
        width,
        padding,
        background: background === 'transparent' ? undefined : background
      });
      lopu({ title: 'Exported ✨', description: filename, status: 'success' });
    } catch (err) {
      lopu({
        title: 'Export failed',
        description: `The export hit a snag: ${err instanceof Error ? err.message : String(err)} 🥺`,
        status: 'error'
      });
    } finally {
      setBusy(false);
    }
  };

  const copySvgCode = async () => {
    try {
      await navigator.clipboard.writeText(svg);
      lopu({ title: 'SVG copied 🌈', description: 'The SVG code is on your clipboard.', status: 'success' });
    } catch {
      lopu({ title: 'Copy failed', description: 'Your browser blocked clipboard access 🥺', status: 'error' });
    }
  };

  const defaultPng = manifest?.pngs.find((png) => png.w === 1024) ?? manifest?.pngs[manifest.pngs.length - 1];

  return (
    <Box as="section" id={slug} pt={{ base: '72px', md: '112px' }}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <Heading
        as="h2"
        fontFamily={HEAD}
        fontWeight={700}
        letterSpacing="-0.025em"
        fontSize="clamp(28px, 3.4vw, 42px)"
        color="var(--tt-ink, #16161a)"
        mt="10px"
      >
        {title}
      </Heading>
      <Text mt="12px" mb={{ base: '20px', md: '28px' }} maxW="620px" fontSize={{ base: '15px', md: '16px' }} lineHeight={1.65} color="var(--tt-text, #5a5a66)">
        {description}
      </Text>

      {/* Preview: one soft panel, no borders, no checkerboards — the asset is the hero. */}
      <Flex
        position="relative"
        alignItems="center"
        justifyContent="center"
        borderRadius={{ base: '20px', md: '28px' }}
        minH={{ base: '220px', md: '360px' }}
        py={{ base: '48px', md: '72px' }}
        px={{ base: '24px', md: '48px' }}
        bg={panel === 'light' ? 'var(--tt-surface-alt, #f5f5f7)' : '#16161c'}
        transition="background 200ms ease"
      >
        <img
          src={previewUri}
          alt={`Thingtime ${title} logo`}
          style={{
            imageRendering: 'pixelated',
            width: horizontal ? 'min(100%, 640px)' : 'min(46%, 208px)',
            display: 'block'
          }}
        />
        <Flex position="absolute" top={{ base: '14px', md: '20px' }} right={{ base: '14px', md: '20px' }} gap="8px" aria-label="Preview surface">
          {(['light', 'dark'] as const).map((mode) => (
            <Box
              as="button"
              type="button"
              key={mode}
              aria-label={`Preview on ${mode} surface`}
              aria-pressed={panel === mode}
              onClick={() => setPanel(mode)}
              width="22px"
              height="22px"
              borderRadius="full"
              bg={mode === 'light' ? '#ffffff' : '#16161a'}
              boxShadow={panel === mode ? '0 0 0 2px var(--tt-rainbow-4, #47b5e6)' : 'inset 0 0 0 1px rgba(128,128,140,.35)'}
              transition="box-shadow 140ms ease"
            />
          ))}
        </Flex>
      </Flex>

      {/* Primary downloads + the tucked-away custom exporter trigger. */}
      <Flex mt="18px" gap="10px" alignItems="center" flexWrap="wrap">
        <PrimaryButton as="a" href={manifest?.svg.url} download data-testid={`download-svg-${slug}`}>
          Download SVG
        </PrimaryButton>
        {defaultPng ? (
          <PrimaryButton
            as="a"
            href={defaultPng.url}
            download
            bg="var(--tt-card, #fff)"
            color="var(--tt-ink, #16161a)"
            boxShadow="inset 0 0 0 1px #e2e2e6"
            _hover={{ bg: 'var(--tt-surface-alt, #f5f5f7)' }}
            data-testid={`download-png-${slug}`}
          >
            PNG · {defaultPng.w}px
          </PrimaryButton>
        ) : null}
        <QuietButton onClick={copySvgCode}>Copy SVG code</QuietButton>
        <Box flex="1" />
        <QuietButton onClick={() => setExportOpen((open) => !open)} aria-expanded={exportOpen} data-testid={`custom-export-toggle-${slug}`}>
          Custom export
          <Box as="span" ml="8px" transform={exportOpen ? 'rotate(180deg)' : 'none'} transition="transform 160ms ease" aria-hidden>
            ⌄
          </Box>
        </QuietButton>
      </Flex>

      <Collapse in={exportOpen} animateOpacity>
        <Flex mt="16px" p={{ base: '16px', md: '20px' }} borderRadius="16px" bg="var(--tt-surface, #fafafb)" gap={{ base: '16px', md: '24px' }} flexWrap="wrap" alignItems="flex-end">
          <Field label="Format">
            <Segmented
              label="Export format"
              value={format}
              onChange={(next) => setFormat(next === 'svg' ? 'svg' : 'png')}
              options={[
                { value: 'png', label: 'PNG' },
                { value: 'svg', label: 'SVG' }
              ]}
            />
          </Field>
          <Field label="Width px">
            <NumberBox ariaLabel="Export width in pixels" value={width} onChange={setWidth} min={1} max={10000} />
          </Field>
          <Field label={perSide ? 'Padding px · sides' : 'Padding px'}>
            <Flex gap="8px" alignItems="center" flexWrap="wrap">
              {perSide ? (
                <>
                  {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                    <Flex key={side} flexDir="column" gap="2px">
                      <NumberBox
                        ariaLabel={`Padding ${side} in pixels`}
                        width="68px"
                        value={pads[side]}
                        onChange={(next) => setPads((prev) => ({ ...prev, [side]: next }))}
                      />
                      <Text fontFamily={MONO} fontSize="9px" color="var(--tt-faint, #b6b6c0)" textAlign="center" textTransform="uppercase">
                        {side[0]}
                      </Text>
                    </Flex>
                  ))}
                </>
              ) : (
                <NumberBox ariaLabel="Padding on all sides in pixels" width="76px" value={padAll} onChange={setPadAll} />
              )}
              <QuietButton
                height="34px"
                px={3}
                fontSize="12px"
                onClick={() => {
                  if (!perSide) setPads({ top: padAll, right: padAll, bottom: padAll, left: padAll });
                  setPerSide((prev) => !prev);
                }}
              >
                {perSide ? 'All sides' : 'Per side'}
              </QuietButton>
            </Flex>
          </Field>
          <Field label="Background">
            <Segmented label="Export background" value={background} onChange={setBackground} options={BACKGROUNDS} />
          </Field>
          <PrimaryButton onClick={runExport} isLoading={busy} data-testid={`custom-export-download-${slug}`}>
            Download
          </PrimaryButton>
        </Flex>
      </Collapse>

      {/* Ready-made ladder — real committed files, so they're linkable + indexable. */}
      {manifest ? (
        <Box mt={{ base: '28px', md: '36px' }}>
          <Text fontFamily={MONO} fontSize="11px" fontWeight={600} letterSpacing="0.14em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)" mb="12px">
            Ready-made sizes
          </Text>
          {/* One line of SVG variations, one line of PNGs — each chip labelled
              format · dimensions · filesize. */}
          <Flex flexDir="column" rowGap="6px">
            <Flex flexWrap="wrap" columnGap="6px" rowGap="10px">
              <Flex
                as="a"
                href={manifest.svg.url}
                download
                flexDir="column"
                alignItems="center"
                gap="6px"
                px="12px"
                py="10px"
                borderRadius="12px"
                _hover={{ bg: 'var(--tt-surface-alt, #f5f5f7)' }}
                transition="background 140ms ease"
                title={`Scalable SVG · ${formatBytes(manifest.svg.bytes)}`}
              >
                <Flex height="40px" alignItems="center">
                  <img src={manifest.svg.url} alt={`Thingtime ${title} logo — scalable SVG`} loading="lazy" decoding="async" style={{ maxHeight: '32px', maxWidth: '84px', display: 'block' }} />
                </Flex>
                <Text fontFamily={MONO} fontSize="10.5px" color="var(--tt-text, #5a5a66)" whiteSpace="nowrap">
                  SVG · scalable · {formatBytes(manifest.svg.bytes)}
                </Text>
              </Flex>
            </Flex>
            <Flex flexWrap="wrap" columnGap="6px" rowGap="10px">
              {manifest.pngs.map((png) => (
                <Flex
                  key={png.url}
                  as="a"
                  href={png.url}
                  download
                  flexDir="column"
                  alignItems="center"
                  gap="6px"
                  px="12px"
                  py="10px"
                  borderRadius="12px"
                  _hover={{ bg: 'var(--tt-surface-alt, #f5f5f7)' }}
                  transition="background 140ms ease"
                  title={`PNG · ${png.w}×${png.h} · ${formatBytes(png.bytes)}`}
                >
                  <Flex height="40px" alignItems="center">
                    <img
                      src={png.url}
                      alt={`Thingtime ${title} logo — ${png.w}×${png.h} transparent PNG`}
                      width={png.w}
                      height={png.h}
                      loading="lazy"
                      decoding="async"
                      style={{ maxHeight: '32px', maxWidth: '84px', width: 'auto', height: 'auto', display: 'block' }}
                    />
                  </Flex>
                  <Text fontFamily={MONO} fontSize="10.5px" color="var(--tt-text, #5a5a66)" whiteSpace="nowrap">
                    PNG · {png.w}×{png.h} · {formatBytes(png.bytes)}
                  </Text>
                </Flex>
              ))}
            </Flex>
          </Flex>
        </Box>
      ) : null}
    </Box>
  );
};
