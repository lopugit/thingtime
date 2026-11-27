import React from 'react';
import {
  Box, Button, Flex, FormControl, FormLabel, Grid, Input, Modal, ModalBody, ModalCloseButton,
  ModalContent, ModalFooter, ModalHeader, ModalOverlay, Select, Tab, TabList, TabPanel, TabPanels, Tabs, Text
} from '@chakra-ui/react';
import { RotateCcw } from 'lucide-react';

import { CssPropertyEditor, HtmlAttributeEditor } from '../ElementInspector/ElementInspector';
import { DRAWER_MODAL_Z } from '../Nav/Drawer/useDrawer';
import { PresentedImage } from './PresentedImage';
import {
  IMAGE_PRESENTATION_DEFAULTS as defaults, isImagePresentationAttribute, normalizeImagePresentation,
  type ImageFit, type ImagePresentation
} from './imagePresentation';

const frameFields = [
  { key: 'zoom', label: 'Zoom (%)', min: 0 },
  { key: 'anchorX', label: 'Horizontal anchor (%)', min: 0, max: 100 },
  { key: 'anchorY', label: 'Vertical anchor (%)', min: 0, max: 100 },
  { key: 'offsetX', label: 'Left offset (px)' },
  { key: 'offsetY', label: 'Top offset (px)' },
  { key: 'paddingX', label: 'Horizontal padding (px)', min: 0 },
  { key: 'paddingY', label: 'Vertical padding (px)', min: 0 }
] as const;

type FrameKey = typeof frameFields[number]['key'];
const focusOutline = { outline: '2px solid var(--tt-accent, #7c5cff)', outlineOffset: '2px' };

export const ImagePresentationDialog = ({
  src, label, round, value, onClose, onApply, triggerRef
}: {
  src: string;
  label: string;
  round: boolean;
  value: ImagePresentation | null;
  onClose: () => void;
  onApply: (value: ImagePresentation | null) => void;
  triggerRef: React.RefObject<HTMLButtonElement>;
}) => {
  const [failedPreview, setFailedPreview] = React.useState(false);
  const [draft, setDraft] = React.useState<ImagePresentation>(() => value || {});
  const [numeric, setNumeric] = React.useState<Partial<Record<FrameKey, string>>>({});
  const preview = normalizeImagePresentation(draft);
  const invalidNumbers = frameFields.some(({ key, ...limits }) => {
    if (!(key in numeric)) return false;
    const raw = numeric[key] || '';
    if (!raw.trim()) return true;
    const number = Number(raw);
    return !Number.isFinite(number) || ('min' in limits && number < limits.min) || ('max' in limits && number > limits.max);
  });
  const initialFocusRef = React.useRef<HTMLButtonElement>(null);
  const cssDefaults = {
    'object-fit': draft.fit ?? defaults.fit,
    'object-position': `${draft.anchorX ?? defaults.anchorX}% ${draft.anchorY ?? defaults.anchorY}%`,
    width: '100%', height: '100%', 'box-sizing': 'border-box'
  };

  return (
    <Modal isOpen onClose={onClose} closeOnEsc={false} initialFocusRef={initialFocusRef} finalFocusRef={triggerRef} scrollBehavior="inside">
      <ModalOverlay zIndex={DRAWER_MODAL_Z + 1} />
      <ModalContent
        containerProps={{ zIndex: DRAWER_MODAL_Z + 2 }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
        maxW="min(790px, calc(100vw - 24px))" maxH="calc(100dvh - 24px)" my="12px"
        borderRadius="var(--tt-radius-lg, 16px)" background="var(--tt-card, #fff)" color="var(--tt-ink, #16161a)"
        data-image-editor=""
      >
        <ModalHeader px={{ base: 4, md: 6 }} pb={2}>Edit {label.toLowerCase()} image</ModalHeader>
        <ModalCloseButton aria-label="Close image editor" ref={initialFocusRef} />
        <ModalBody px={{ base: 4, md: 6 }} pb={4} style={{ overscrollBehavior: 'contain' }}>
          <Grid gridTemplateColumns={{ base: 'minmax(0, 1fr)', md: 'minmax(0, 0.88fr) minmax(0, 1fr)' }} gap={{ base: 3, md: 5 }}>
            <Box minW={0}>
              <Box
                w="100%" maxW={round ? { base: '140px', md: '240px' } : undefined}
                mx="auto" aspectRatio={round ? 1 : 16 / 7}
                borderRadius={round ? 'full' : 'var(--tt-radius-md, 12px)'} overflow="hidden"
                background="var(--tt-surface-alt, #f5f5f7)" border="1px solid var(--tt-border, #ececef)"
                data-testid="image-editor-preview"
              >
                {failedPreview
                  ? <Flex w="100%" h="100%" align="center" justify="center"><Text color="var(--tt-muted)" fontSize="xs">Preview unavailable</Text></Flex>
                  : <PresentedImage src={src} presentation={preview === undefined ? value : preview} alt={`${label} preview`} onError={() => setFailedPreview(true)} />}
              </Box>
              <Text color="var(--tt-muted, #5a5a66)" fontSize="xs" mt={2}>
                Changes are applied to this image slot. The original stays intact.
              </Text>
            </Box>
            <Tabs isLazy variant="line" minW={0} colorScheme="purple">
              <TabList>
                <Tab minH="44px">Framing</Tab>
                <Tab minH="44px">CSS</Tab>
                <Tab minH="44px">HTML</Tab>
              </TabList>
              <TabPanels>
                <TabPanel px={0} py={3}>
                  <Flex direction="column" gap={3}>
                    <FormControl>
                      <FormLabel fontSize="xs" mb={1}>Image fit</FormLabel>
                      <Select minH="44px" size="sm" _focusVisible={focusOutline} borderRadius="var(--tt-radius-md, 12px)" value={draft.fit ?? defaults.fit} onChange={(event) => { const fit = event.currentTarget.value as ImageFit; setDraft((current) => ({ ...current, fit })); }}>
                        <option value="cover">Crop to fill</option>
                        <option value="contain">Show whole image</option>
                        <option value="fill">Stretch to fill</option>
                      </Select>
                    </FormControl>
                    <Grid templateColumns="repeat(2, minmax(0, 1fr))" gap={3}>
                      {frameFields.map(({ key, label: fieldLabel, ...limits }) => (
                        <FormControl key={key}>
                          <FormLabel fontSize="xs" mb={1}>{fieldLabel}</FormLabel>
                          <Input
                            type="number" inputMode="decimal" step="any" size="sm" _focusVisible={focusOutline} minH="44px" borderRadius="var(--tt-radius-md, 12px)" {...limits}
                            value={numeric[key] ?? String(draft[key] ?? defaults[key])}
                            onChange={(event) => {
                              const text = event.currentTarget.value;
                              const number = event.currentTarget.valueAsNumber;
                              setNumeric((current) => ({ ...current, [key]: text }));
                              if (Number.isFinite(number)) setDraft((current) => ({ ...current, [key]: number }));
                            }}
                          />
                        </FormControl>
                      ))}
                    </Grid>
                  </Flex>
                </TabPanel>
                <TabPanel px={0} py={3}>
                  <Text color="var(--tt-muted, #5a5a66)" fontSize="xs" mb={2}>Custom CSS styles the image and can override framing. It cannot load another image.</Text>
                  <CssPropertyEditor liveSource tagName="img" value={draft.css} defaults={cssDefaults} onChange={(css) => setDraft((current) => ({ ...current, css }))} testId="image-css-editor" />
                </TabPanel>
                <TabPanel px={0} py={3}>
                  <Text color="var(--tt-muted, #5a5a66)" fontSize="xs" mb={2}>Edit image attributes such as alternative text and dimensions. Replace the media in the picker to change its source.</Text>
                  <HtmlAttributeEditor tagName="img" value={draft.attributes} defaults={{ alt: '', loading: 'eager', decoding: 'auto' }} isAllowed={isImagePresentationAttribute} onChange={(attributes) => setDraft((current) => ({ ...current, attributes }))} testId="image-html-editor" />
                </TabPanel>
              </TabPanels>
            </Tabs>
          </Grid>
          {(preview === undefined || invalidNumbers) && (
            <Text color="var(--tt-danger, #b1272d)" fontSize="sm" mt={2} role="alert">
              {invalidNumbers ? 'Enter a valid number in each framing field.' : 'Check the image attributes and CSS for unsupported values or external resources.'}
            </Text>
          )}
        </ModalBody>
        <ModalFooter justifyContent="space-between" flexWrap="wrap" gap={2} px={{ base: 4, md: 6 }} pt={2}>
          <Button size="sm" variant="ghost" minH="44px" type="button" leftIcon={<RotateCcw size={14} />} onClick={() => { setDraft({}); setNumeric({}); }}>Reset</Button>
          <Flex gap={2}>
            <Button size="sm" variant="ghost" minH="44px" type="button" onClick={onClose}>Cancel</Button>
            <Button size="sm" colorScheme="purple" minH="44px" type="button" isDisabled={preview === undefined || invalidNumbers} onClick={() => { if (preview !== undefined && !invalidNumbers) onApply(preview); }}>Apply</Button>
          </Flex>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
