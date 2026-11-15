import { Box, Button, Collapse, Flex, Heading, Input, Select, Slider, SliderFilledTrack, SliderThumb, SliderTrack, Text } from '@chakra-ui/react';
import React from 'react';

import { useLopu } from '~/components/Lopu/useLopu';
import { Chevron, Eyebrow, Segmented } from './BrandAssetSection';
import { ChipGroup, ChipLabel } from './BrandChips';
import { downloadBlob } from './brandingExport';
import {
  BRAND_BACKDROPS,
  BRAND_PATTERNS,
  IMAGERY_FORMATS,
  SCENE_LIMITS,
  buildBrandScene,
  describeScene,
  normaliseSceneOptions,
  paintScene,
  sceneSlug,
  sceneToSvg
} from './brandScenes';
import type { BrandSceneOptions, BrandScenePlate } from './brandScenes';
import { BRAND_LOGO_VARIANTS } from './logoVariants';

// The imagery studio: pick a size, a logo cut, a background and a pattern,
// shuffle until it sings, download. The picture is the same rectangle list the
// committed gallery files are painted from (brandScenes.ts), drawn on a canvas
// here — so "Remix" on a gallery picture reopens exactly that picture.

const MONO = 'var(--tt-font-mono, "JetBrains Mono", monospace)';
const HEAD = 'var(--tt-font-heading, "Space Grotesk", sans-serif)';

// The preview canvas never needs more pixels than this on its long side; the
// download is always painted at full size.
const PREVIEW_LONG_SIDE = 1400;

const CUSTOM = 'custom';

const BACKDROP_OPTIONS = BRAND_BACKDROPS.map((backdrop) => ({ value: backdrop.key, label: backdrop.label, swatch: backdrop.swatch }));
const PATTERN_OPTIONS = BRAND_PATTERNS.map((pattern) => ({ value: pattern.key, label: pattern.label }));
const PLATE_OPTIONS: Array<{ value: BrandScenePlate; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'none', label: 'None' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
];
const LOGO_GROUPS: Array<{ group: string; label: string }> = [
  { group: 'core', label: 'Lock-ups' },
  { group: 'pink', label: 'Hotpink' },
  { group: 'fun', label: 'Ways to play' }
];

const selectStyles = {
  size: 'sm' as const,
  height: '38px',
  borderRadius: '11px',
  borderColor: 'var(--tt-border, #e6e6ea)',
  bg: 'var(--tt-card, #fff)',
  color: 'var(--tt-ink, #16161a)',
  fontWeight: 600,
  fontSize: '13.5px'
};

const randomSeed = () => Math.floor(Math.random() * 1_000_000);
const randomOf = <T,>(from: readonly T[]): T => from[Math.floor(Math.random() * from.length)];

const Range = ({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (next: number) => void;
}) => (
  <Box>
    <Flex justifyContent="space-between" alignItems="baseline" mb="2px">
      <ChipLabel>{label}</ChipLabel>
      <Text fontFamily={MONO} fontSize="11px" color="var(--tt-muted, #9a9aa6)">
        {display}
      </Text>
    </Flex>
    <Slider aria-label={label} value={value} min={min} max={max} step={step} onChange={onChange} focusThumbOnChange={false}>
      <SliderTrack bg="var(--tt-surface-alt, #f1f1f3)" height="6px" borderRadius="full">
        <SliderFilledTrack bg="var(--tt-ink, #16161a)" />
      </SliderTrack>
      <SliderThumb boxSize="18px" bg="var(--tt-card, #fff)" boxShadow="0 0 0 2px var(--tt-ink, #16161a)" />
    </Slider>
  </Box>
);

export const BrandImageryStudio = ({
  eyebrow,
  scene,
  onChange
}: {
  eyebrow: string;
  scene: BrandSceneOptions;
  onChange: (next: BrandSceneOptions) => void;
}) => {
  const lopu = useLopu();
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [customSize, setCustomSize] = React.useState(false);
  const [fineTune, setFineTune] = React.useState(false);
  const [busy, setBusy] = React.useState<'png' | 'svg' | null>(null);
  // Size fields are free text while typing; they commit on blur / Enter.
  const [sizeDraft, setSizeDraft] = React.useState({ width: String(scene.width), height: String(scene.height) });

  const options = React.useMemo(() => normaliseSceneOptions(scene), [scene]);
  const built = React.useMemo(() => buildBrandScene(options), [options]);
  const preset = IMAGERY_FORMATS.find((format) => format.width === options.width && format.height === options.height);
  const formatKey = customSize || !preset ? CUSTOM : preset.key;
  const set = (patch: Partial<BrandSceneOptions>) => onChange(normaliseSceneOptions({ ...options, ...patch }));

  React.useEffect(() => {
    setSizeDraft({ width: String(options.width), height: String(options.height) });
  }, [options.width, options.height]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scale = Math.min(1, PREVIEW_LONG_SIDE / Math.max(built.width, built.height));
    canvas.width = Math.max(1, Math.round(built.width * scale));
    canvas.height = Math.max(1, Math.round(built.height * scale));
    const context = canvas.getContext('2d');
    if (context) paintScene(built, context, scale);
  }, [built]);

  const commitSize = () => {
    const width = Number.parseInt(sizeDraft.width, 10);
    const height = Number.parseInt(sizeDraft.height, 10);
    set({
      width: Number.isFinite(width) && width > 0 ? width : options.width,
      height: Number.isFinite(height) && height > 0 ? height : options.height
    });
  };

  const filename = (extension: string) =>
    `thingtime-${formatKey === CUSTOM ? 'custom' : formatKey}-${sceneSlug(options)}-${options.seed}-${options.width}x${options.height}.${extension}`;

  const downloadSvg = () => {
    setBusy('svg');
    try {
      downloadBlob(new Blob([sceneToSvg(built)], { type: 'image/svg+xml' }), filename('svg'));
      lopu({ title: `${filename('svg')} downloaded 🎉`, status: 'success' });
    } catch {
      lopu({ title: 'SVG export failed', description: 'Your browser could not save the file 🥺', status: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const downloadPng = async () => {
    setBusy('png');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = built.width;
      canvas.height = built.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas 2D context unavailable');
      paintScene(built, context);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('The PNG could not be rendered');
      downloadBlob(blob, filename('png'));
      lopu({ title: `${filename('png')} downloaded 🎉`, status: 'success' });
    } catch {
      // Browsers cap how many pixels one canvas may hold; the SVG has no such cap.
      lopu({
        title: 'PNG export failed',
        description: `Your browser could not draw a ${options.width}×${options.height} canvas. The SVG scales to any size — try that instead.`,
        status: 'error'
      });
    } finally {
      setBusy(null);
    }
  };

  const surprise = () =>
    set({
      logo: randomOf(BRAND_LOGO_VARIANTS).slug,
      backdrop: randomOf(BRAND_BACKDROPS).key,
      pattern: randomOf(BRAND_PATTERNS.filter((pattern) => pattern.key !== 'none')).key,
      seed: randomSeed(),
      plate: 'auto'
    });

  return (
    <Box as="section" id="studio" pt={{ base: '72px', md: '112px' }}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <Heading as="h2" fontFamily={HEAD} fontWeight={700} letterSpacing="-0.025em" fontSize="clamp(28px, 3.4vw, 42px)" color="var(--tt-ink, #16161a)" mt="10px">
        Make your own
      </Heading>
      <Text mt="12px" mb={{ base: '24px', md: '32px' }} maxW="640px" fontSize={{ base: '15px', md: '16px' }} lineHeight={1.65} color="var(--tt-text, #5a5a66)">
        Every picture above came out of this. Choose a size, a logo, a background and a pattern, then shuffle until
        it sings — each shuffle deals a fresh arrangement. Download it as a PNG, or as an SVG that scales forever.
      </Text>

      <Flex flexDir={{ base: 'column', lg: 'row' }} gap={{ base: '24px', lg: '40px' }} alignItems={{ base: 'stretch', lg: 'flex-start' }}>
        {/* Preview */}
        {/* stacked on phones, so it must size to the picture rather than share a row */}
        <Flex
          flex={{ base: 'none', lg: '1 1 0' }}
          minW={0}
          minH={{ base: '260px', md: '420px' }}
          alignItems="center"
          justifyContent="center"
          borderRadius="24px"
          bg="var(--tt-surface-alt, #f5f5f7)"
          p={{ base: '16px', md: '32px' }}
          position={{ base: 'static', lg: 'sticky' }}
          top={{ lg: 'calc(var(--thingtime-safe-area-top, 0px) + 88px)' }}
        >
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`Preview — ${describeScene(options)}, ${options.width}×${options.height}`}
            data-testid="studio-canvas"
            style={{
              display: 'block',
              maxWidth: '100%',
              maxHeight: 'min(72vh, 620px)',
              width: 'auto',
              height: 'auto',
              borderRadius: '14px',
              boxShadow: '0 1px 3px rgba(20,20,40,.1), 0 24px 56px -30px rgba(20,20,40,.35)'
            }}
          />
        </Flex>

        {/* Controls */}
        <Flex flexDir="column" gap="18px" width={{ base: '100%', lg: '400px' }} flex="none" minW={0}>
          <Flex gap="12px" flexWrap="wrap">
            <Flex flexDir="column" gap="8px" flex="1 1 170px" minW={0}>
              <ChipLabel>Size</ChipLabel>
              <Select
                {...selectStyles}
                aria-label="Size"
                data-testid="studio-format"
                value={formatKey}
                onChange={(event) => {
                  const next = IMAGERY_FORMATS.find((format) => format.key === event.target.value);
                  setCustomSize(!next);
                  if (next) set({ width: next.width, height: next.height });
                }}
              >
                {IMAGERY_FORMATS.map((format) => (
                  <option key={format.key} value={format.key}>
                    {format.label} · {format.width}×{format.height}
                  </option>
                ))}
                <option value={CUSTOM}>Custom size…</option>
              </Select>
            </Flex>
            <Flex flexDir="column" gap="8px" flex="1 1 170px" minW={0}>
              <ChipLabel>Logo</ChipLabel>
              <Select {...selectStyles} aria-label="Logo" data-testid="studio-logo" value={options.logo} onChange={(event) => set({ logo: event.target.value })}>
                {LOGO_GROUPS.map(({ group, label }) => (
                  <optgroup key={group} label={label}>
                    {BRAND_LOGO_VARIANTS.filter((variant) => variant.group === group).map((variant) => (
                      <option key={variant.slug} value={variant.slug}>
                        {variant.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Flex>
          </Flex>

          {formatKey === CUSTOM ? (
            <Flex gap="10px" alignItems="flex-end">
              {(['width', 'height'] as const).map((side) => (
                <Flex key={side} flexDir="column" gap="8px" flex="1 1 0" minW={0}>
                  <ChipLabel>{side === 'width' ? 'Width · px' : 'Height · px'}</ChipLabel>
                  <Input
                    size="sm"
                    height="38px"
                    borderRadius="11px"
                    borderColor="var(--tt-border, #e6e6ea)"
                    fontFamily={MONO}
                    fontSize="13px"
                    inputMode="numeric"
                    aria-label={side === 'width' ? 'Width in pixels' : 'Height in pixels'}
                    data-testid={`studio-${side}`}
                    value={sizeDraft[side]}
                    onChange={(event) => setSizeDraft((draft) => ({ ...draft, [side]: event.target.value.replace(/[^0-9]/g, '') }))}
                    onBlur={commitSize}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitSize();
                    }}
                  />
                </Flex>
              ))}
            </Flex>
          ) : null}

          <ChipGroup label="Background" options={BACKDROP_OPTIONS} value={options.backdrop} onChange={(next) => set({ backdrop: next })} testId="studio-backdrop" />
          <ChipGroup label="Pattern" options={PATTERN_OPTIONS} value={options.pattern} onChange={(next) => set({ pattern: next })} testId="studio-pattern" />

          <Flex gap="8px" flexWrap="wrap">
            <Button
              size="sm"
              height="38px"
              px={4}
              borderRadius="11px"
              bg="var(--tt-surface-alt, #f5f5f7)"
              color="var(--tt-ink, #16161a)"
              fontWeight={600}
              _hover={{ bg: 'var(--tt-border, #e6e6ea)' }}
              onClick={() => set({ seed: randomSeed() })}
              data-testid="studio-shuffle"
            >
              🎲 Shuffle
            </Button>
            <Button
              size="sm"
              height="38px"
              px={4}
              borderRadius="11px"
              bg="var(--tt-surface-alt, #f5f5f7)"
              color="var(--tt-ink, #16161a)"
              fontWeight={600}
              _hover={{ bg: 'var(--tt-border, #e6e6ea)' }}
              onClick={surprise}
              data-testid="studio-surprise"
            >
              ✨ Surprise me
            </Button>
          </Flex>

          {/* Fine-tune: collapsed until asked for */}
          <Box>
            <Box
              as="button"
              type="button"
              onClick={() => setFineTune((open) => !open)}
              aria-expanded={fineTune}
              aria-controls="studio-fine-tune"
              data-testid="studio-fine-tune-toggle"
              display="flex"
              alignItems="center"
              gap="8px"
              fontSize="13.5px"
              fontWeight={600}
              fontFamily="inherit"
              color="var(--tt-ink, #16161a)"
            >
              Fine-tune
              <Text as="span" fontWeight={500} color="var(--tt-muted, #9a9aa6)">
                logo size, density, voxels, plate, seed
              </Text>
              <Chevron open={fineTune} />
            </Box>
            <Collapse in={fineTune} animateOpacity unmountOnExit>
              <Flex id="studio-fine-tune" flexDir="column" gap="16px" pt="16px" px="2px">
                <Range
                  label="Logo size"
                  value={options.logoSize}
                  min={SCENE_LIMITS.logoSize.min}
                  max={SCENE_LIMITS.logoSize.max}
                  step={0.05}
                  display={`${Math.round(options.logoSize * 100)}%`}
                  onChange={(next) => set({ logoSize: next })}
                />
                <Range
                  label="Pattern density"
                  value={options.density}
                  min={SCENE_LIMITS.density.min}
                  max={SCENE_LIMITS.density.max}
                  step={0.05}
                  display={`${Math.round(options.density * 100)}%`}
                  onChange={(next) => set({ density: next })}
                />
                <Range
                  label="Voxel detail"
                  value={options.grain}
                  min={SCENE_LIMITS.grain.min}
                  max={SCENE_LIMITS.grain.max}
                  step={1}
                  display={`${options.grain} across`}
                  onChange={(next) => set({ grain: next })}
                />
                <Flex gap="16px" flexWrap="wrap" alignItems="flex-end">
                  <Flex flexDir="column" gap="8px">
                    <ChipLabel>Plate behind logo</ChipLabel>
                    <Segmented label="Plate behind logo" options={PLATE_OPTIONS} value={options.plate} onChange={(next) => set({ plate: next })} />
                  </Flex>
                  <Flex flexDir="column" gap="8px" width="120px">
                    <ChipLabel>Seed</ChipLabel>
                    <Input
                      size="sm"
                      height="36px"
                      borderRadius="11px"
                      borderColor="var(--tt-border, #e6e6ea)"
                      fontFamily={MONO}
                      fontSize="13px"
                      inputMode="numeric"
                      aria-label="Seed"
                      data-testid="studio-seed"
                      value={String(options.seed)}
                      onChange={(event) => set({ seed: Number.parseInt(event.target.value.replace(/[^0-9]/g, '') || '0', 10) })}
                    />
                  </Flex>
                </Flex>
              </Flex>
            </Collapse>
          </Box>

          <Box height="1px" bg="var(--tt-border, #e6e6ea)" />

          <Flex gap="8px" flexWrap="wrap" alignItems="center">
            <Button
              size="sm"
              height="40px"
              px={5}
              borderRadius="11px"
              bg="var(--tt-ink, #16161a)"
              color="var(--tt-card, #fff)"
              fontWeight={600}
              _hover={{ opacity: 0.88, boxShadow: '0 6px 20px rgba(0,0,0,.16)' }}
              _active={{ opacity: 0.8 }}
              isLoading={busy === 'png'}
              onClick={downloadPng}
              data-testid="studio-download-png"
            >
              Download PNG ↓
            </Button>
            <Button
              size="sm"
              height="40px"
              px={4}
              borderRadius="11px"
              bg="transparent"
              color="var(--tt-text, #5a5a66)"
              fontWeight={600}
              _hover={{ bg: 'var(--tt-surface-alt, #f5f5f7)' }}
              isLoading={busy === 'svg'}
              onClick={downloadSvg}
              data-testid="studio-download-svg"
            >
              SVG ↓
            </Button>
          </Flex>
          <Text fontFamily={MONO} fontSize="11px" color="var(--tt-muted, #9a9aa6)" data-testid="studio-summary">
            {describeScene(options)} · {options.width}×{options.height} · seed {options.seed}
          </Text>
        </Flex>
      </Flex>
    </Box>
  );
};
