import { Box, Button, Collapse, Flex, Heading, Input, Text } from '@chakra-ui/react';
import React from 'react';

import { useLopu } from '~/components/Lopu/useLopu';
import { downloadBrandExport } from './brandingExport';
import { BRAND_SURFACES, brandPngUrl, brandSvgUrl, buildVariantSvg } from './logoVariants';
import type { BrandLogoVariant, BrandSurfaceKey } from './logoVariants';

// One brand section per logo cut (branding redesign of claude-todo/08 §3):
// a clean preview on the chosen background, ready-made files straight from
// the committed manifests, and two tucked-away disclosures — the full size
// ladder and a custom exporter with per-side padding. `compact` is the same
// section at gallery density for the fun cuts.

type ManifestPng = { w: number; h: number; url: string; bytes: number };
export type ManifestVariant = {
  slug: string;
  name: string;
  aspect: { cols: number; rows: number };
  svg: { url: string; bytes: number };
  pngs: ManifestPng[];
};
// brandingSurfaces.generated.json: the light/dark ladders as [w, h, bytes].
export type ManifestSurface = { aspect: { cols: number; rows: number }; svgBytes: number; pngs: number[][] };
export type ManifestSurfaces = Partial<Record<'light' | 'dark', ManifestSurface>>;

const MONO = 'var(--tt-font-mono, "JetBrains Mono", monospace)';
const HEAD = 'var(--tt-font-heading, "Space Grotesk", sans-serif)';

export const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

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
// `onPanel` swaps the container for a translucent tint so the control still
// reads when it sits on a surface-alt preview panel. Pass `onChange` as an
// arrow rather than a bare state setter: a setter's updater-function overload
// widens T to string.
export const Segmented = <T extends string>({
  options,
  value,
  onChange,
  label,
  onPanel = false
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  label: string;
  onPanel?: boolean;
}) => (
  <Flex role="group" aria-label={label} bg={onPanel ? 'rgba(128,128,140,.16)' : 'var(--tt-surface-alt, #f1f1f3)'} borderRadius="11px" p="3px" width="fit-content" maxW="100%">
    {options.map((option) => {
      const active = option.value === value;
      return (
        <Box
          as="button"
          type="button"
          key={option.value}
          aria-pressed={active}
          onClick={() => onChange(option.value)}
          px="12px"
          height="30px"
          borderRadius="9px"
          fontSize="13px"
          fontWeight={600}
          fontFamily="inherit"
          whiteSpace="nowrap"
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

const Chevron = ({ open }: { open: boolean }) => (
  <Box as="span" ml="8px" transform={open ? 'rotate(180deg)' : 'none'} transition="transform 160ms ease" aria-hidden>
    ⌄
  </Box>
);

const SURFACE_OPTIONS = BRAND_SURFACES.map((surface) => ({ value: surface.key, label: surface.label }));
// The custom exporter bakes a CSS colour, so its options carry the colour itself.
const EXPORT_BACKGROUNDS = BRAND_SURFACES.map((surface) => ({ value: surface.colour ?? 'transparent', label: surface.label }));

const FileChip = ({ href, title, label, children }: { href: string; title: string; label: string; children: React.ReactNode }) => (
  <Flex
    as="a"
    href={href}
    download
    flexDir="column"
    alignItems="center"
    gap="6px"
    px="12px"
    py="10px"
    borderRadius="12px"
    _hover={{ bg: 'var(--tt-surface-alt, #f5f5f7)' }}
    transition="background 140ms ease"
    title={title}
  >
    <Flex height="40px" alignItems="center">
      {children}
    </Flex>
    <Text fontFamily={MONO} fontSize="10.5px" color="var(--tt-text, #5a5a66)" whiteSpace="nowrap">
      {label}
    </Text>
  </Flex>
);

export const BrandAssetSection = ({
  variant,
  eyebrow,
  manifest,
  surfaces,
  compact = false
}: {
  variant: BrandLogoVariant;
  eyebrow: string;
  manifest?: ManifestVariant;
  surfaces?: ManifestSurfaces;
  compact?: boolean;
}) => {
  const lopu = useLopu();
  const { slug, title, description, matrix, colourMap } = variant;
  const [surface, setSurface] = React.useState<BrandSurfaceKey>('transparent');
  const [sizesOpen, setSizesOpen] = React.useState(false);
  // the ladder is ~20 thumbnails per cut: mount it the first time it opens
  const [sizesMounted, setSizesMounted] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [format, setFormat] = React.useState<'svg' | 'png'>('png');
  const [width, setWidth] = React.useState(1024);
  const [padAll, setPadAll] = React.useState(0);
  const [perSide, setPerSide] = React.useState(false);
  const [pads, setPads] = React.useState({ top: 0, right: 0, bottom: 0, left: 0 });
  const [background, setBackground] = React.useState('transparent');
  const [canvas, setCanvas] = React.useState<'framed' | 'tight'>('framed');
  const [busy, setBusy] = React.useState(false);

  const art = React.useMemo(() => buildVariantSvg(variant), [variant]);
  const shown = React.useMemo(() => buildVariantSvg(variant, surface), [variant, surface]);
  const previewUri = React.useMemo(() => `data:image/svg+xml;utf8,${encodeURIComponent(shown.svg)}`, [shown.svg]);

  // The committed files for the chosen background, in one shape.
  const files = React.useMemo(() => {
    if (surface === 'transparent') return manifest ? { svg: manifest.svg, pngs: manifest.pngs } : null;
    const entry = surfaces?.[surface];
    if (!entry) return null;
    return {
      svg: { url: brandSvgUrl(slug, surface), bytes: entry.svgBytes },
      pngs: entry.pngs.map(([w, h, bytes]) => ({ w, h, bytes, url: brandPngUrl(slug, surface, w, h) }))
    };
  }, [manifest, surfaces, slug, surface]);

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
        background: background === 'transparent' ? undefined : background,
        trim: variant.trim || canvas === 'tight',
        mergeRuns: variant.unit > 1
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
      await navigator.clipboard.writeText(shown.svg);
      lopu({ title: 'SVG copied 🌈', description: 'The SVG code is on your clipboard.', status: 'success' });
    } catch {
      lopu({ title: 'Copy failed', description: 'Your browser blocked clipboard access 🥺', status: 'error' });
    }
  };

  const defaultPng = files?.pngs.find((png) => png.w === 1024) ?? files?.pngs[files.pngs.length - 1];
  // Ladder chips link to every size, but only the small files are shown as
  // themselves (so a 10px file looks 10px); anything larger borrows one small
  // thumbnail rather than making the browser decode a 10000px bitmap to draw
  // a 32px chip.
  const chipThumb = files?.pngs.find((png) => png.w >= 128) ?? files?.pngs[files.pngs.length - 1];
  const chipFrame: React.CSSProperties =
    surface === 'transparent' ? {} : { borderRadius: '3px', boxShadow: '0 0 0 1px rgba(128,128,140,.28)' };
  // Crawlable preview: search engines never index data: URIs, so the hero
  // <img> points at the committed PNG (SVG fallback) whenever the ready-made
  // manifest has this cut; the client-built SVG only covers anything without
  // a generated file. Both render identical pixels.
  const previewSrc = defaultPng?.url ?? files?.svg.url ?? previewUri;
  const surfaceLabel = BRAND_SURFACES.find((entry) => entry.key === surface)?.label ?? 'Transparent';
  const fileNoun = surface === 'transparent' ? 'transparent' : `${surfaceLabel.toLowerCase()}-background`;
  const previewAlt = surface === 'transparent' ? variant.alt : `${variant.alt}, on a ${surfaceLabel.toLowerCase()} background`;

  // Preview size: the artwork keeps one size whichever background is chosen;
  // a backdrop only adds its breathing room around it (within the panel caps).
  const artMaxW = compact ? 400 : 640;
  const artMaxH = variant.trim ? (compact ? 132 : 208) : compact ? 200 : 340;
  const fileMaxW = compact ? 440 : 760;
  const fileMaxH = compact ? 200 : 340;
  const artWidth = Math.min(artMaxW, artMaxH * (art.totalColumns / art.totalRows));
  const previewWidth = Math.round(
    Math.min(artWidth * (shown.totalColumns / art.totalColumns), fileMaxH * (shown.totalColumns / shown.totalRows), fileMaxW)
  );

  return (
    <Box as="section" id={slug} pt={compact ? 0 : { base: '72px', md: '112px' }}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <Heading
        as={compact ? 'h3' : 'h2'}
        fontFamily={HEAD}
        fontWeight={700}
        letterSpacing="-0.025em"
        fontSize={compact ? 'clamp(21px, 2.2vw, 26px)' : 'clamp(28px, 3.4vw, 42px)'}
        color="var(--tt-ink, #16161a)"
        mt={compact ? '8px' : '10px'}
      >
        {title}
      </Heading>
      <Text
        mt={compact ? '8px' : '12px'}
        mb={compact ? '16px' : { base: '20px', md: '28px' }}
        maxW="620px"
        fontSize={compact ? '14.5px' : { base: '15px', md: '16px' }}
        lineHeight={1.65}
        color="var(--tt-text, #5a5a66)"
      >
        {description}
      </Text>

      {/* Preview: one soft panel, no borders, no checkerboards — the asset is the hero. */}
      <Flex
        flexDir="column"
        alignItems="center"
        borderRadius={compact ? '20px' : { base: '20px', md: '28px' }}
        // gallery panels share one height so a row of cards lines up
        minH={compact ? { base: '220px', md: '320px' } : { base: '220px', md: '360px' }}
        pt={compact ? '14px' : { base: '14px', md: '20px' }}
        pb={compact ? '40px' : { base: '48px', md: '72px' }}
        px={compact ? '20px' : { base: '20px', md: '48px' }}
        bg="var(--tt-surface-alt, #f5f5f7)"
      >
        <Flex width="100%" justifyContent="flex-end">
          <Segmented label={`${title} background`} options={SURFACE_OPTIONS} value={surface} onChange={(next) => setSurface(next)} onPanel />
        </Flex>
        <Flex flex="1" width="100%" alignItems="center" justifyContent="center" pt={compact ? '24px' : { base: '28px', md: '36px' }}>
          <img
            src={previewSrc}
            alt={previewAlt}
            width={defaultPng?.w ?? shown.totalColumns}
            height={defaultPng?.h ?? shown.totalRows}
            data-testid={`preview-${slug}`}
            style={{
              // integer-scaled voxels stay crisp; the fine-grained cuts and
              // the solid-background files look better smoothly downscaled
              imageRendering: surface === 'transparent' && variant.unit === 1 ? 'pixelated' : 'auto',
              width: `${previewWidth}px`,
              maxWidth: '100%',
              height: 'auto',
              display: 'block',
              borderRadius: surface === 'transparent' ? 0 : compact ? '12px' : '16px',
              boxShadow: surface === 'transparent' ? 'none' : '0 1px 3px rgba(20,20,40,.10), 0 18px 44px -24px rgba(20,20,40,.35)'
            }}
          />
        </Flex>
      </Flex>

      {/* Primary downloads for the chosen background + the two disclosures. */}
      <Flex mt={compact ? '14px' : '18px'} gap={compact ? '8px' : '10px'} alignItems="center" flexWrap="wrap">
        <PrimaryButton as="a" href={files?.svg.url} download px={compact ? 4 : 5} data-testid={`download-svg-${slug}`}>
          {compact ? 'SVG ↓' : 'Download SVG'}
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
            px={compact ? 4 : 5}
            data-testid={`download-png-${slug}`}
          >
            PNG · {defaultPng.w}px
          </PrimaryButton>
        ) : null}
        <QuietButton onClick={copySvgCode} px={compact ? 3 : 4}>
          {compact ? 'Copy SVG' : 'Copy SVG code'}
        </QuietButton>
        <Box flex="1" />
        {files ? (
          <QuietButton
            onClick={() => {
              setSizesMounted(true);
              setSizesOpen((open) => !open);
            }}
            aria-expanded={sizesOpen}
            px={compact ? 3 : 4}
            data-testid={`sizes-toggle-${slug}`}
          >
            All sizes
            <Chevron open={sizesOpen} />
          </QuietButton>
        ) : null}
        <QuietButton
          onClick={() => setExportOpen((open) => !open)}
          aria-expanded={exportOpen}
          aria-label={`Custom export for ${title}`}
          px={compact ? 3 : 4}
          data-testid={`custom-export-toggle-${slug}`}
        >
          {compact ? 'Custom' : 'Custom export'}
          <Chevron open={exportOpen} />
        </QuietButton>
      </Flex>

      {/* Ready-made ladder — real committed files, so they're linkable + indexable. */}
      {files ? (
        <Collapse in={sizesOpen} animateOpacity>
          {sizesMounted ? (
            <Box mt="16px" p={{ base: '12px', md: '16px' }} borderRadius="16px" bg="var(--tt-surface, #fafafb)">
              <Text fontFamily={MONO} fontSize="11px" fontWeight={600} letterSpacing="0.14em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)" mb="8px" px="12px">
                Ready-made sizes · {surfaceLabel}
              </Text>
              {/* One line of SVG, one line of PNGs — each chip labelled
                  format · dimensions · filesize. */}
              <Flex flexDir="column" rowGap="6px">
                <Flex flexWrap="wrap" columnGap="6px" rowGap="10px">
                  <FileChip href={files.svg.url} title={`Scalable SVG · ${formatBytes(files.svg.bytes)}`} label={`SVG · scalable · ${formatBytes(files.svg.bytes)}`}>
                    <img
                      src={files.svg.url}
                      alt={`Thingtime ${variant.name} logo — scalable ${fileNoun} SVG`}
                      loading="lazy"
                      decoding="async"
                      style={{ maxHeight: '32px', maxWidth: '84px', display: 'block', ...chipFrame }}
                    />
                  </FileChip>
                </Flex>
                <Flex flexWrap="wrap" columnGap="6px" rowGap="10px">
                  {files.pngs.map((png) => {
                    const thumb = chipThumb && png.w > chipThumb.w ? chipThumb : png;
                    return (
                      <FileChip
                        key={png.url}
                        href={png.url}
                        title={`PNG · ${png.w}×${png.h} · ${formatBytes(png.bytes)}`}
                        label={`PNG · ${png.w}×${png.h} · ${formatBytes(png.bytes)}`}
                      >
                        <img
                          src={thumb.url}
                          alt={`Thingtime ${variant.name} logo — ${png.w}×${png.h} ${fileNoun} PNG`}
                          width={thumb.w}
                          height={thumb.h}
                          loading="lazy"
                          decoding="async"
                          style={{ maxHeight: '32px', maxWidth: '84px', width: 'auto', height: 'auto', display: 'block', ...chipFrame }}
                        />
                      </FileChip>
                    );
                  })}
                </Flex>
              </Flex>
            </Box>
          ) : null}
        </Collapse>
      ) : null}

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
          {variant.trim ? null : (
            <Field label="Canvas">
              <Segmented
                label="Export canvas"
                value={canvas}
                onChange={(next) => setCanvas(next)}
                options={[
                  { value: 'framed', label: 'Square' },
                  { value: 'tight', label: 'Trimmed' }
                ]}
              />
            </Field>
          )}
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
            <Segmented label="Export background" value={background} onChange={setBackground} options={EXPORT_BACKGROUNDS} />
          </Field>
          <PrimaryButton onClick={runExport} isLoading={busy} data-testid={`custom-export-download-${slug}`}>
            Download
          </PrimaryButton>
        </Flex>
      </Collapse>
    </Box>
  );
};
