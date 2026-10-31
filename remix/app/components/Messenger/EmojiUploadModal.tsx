import React from 'react';
import {
  Box,
  Button,
  Flex,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay
} from '@chakra-ui/react';

import { useLopu } from '../Lopu/useLopu';
import { CustomEmojiImage } from './CustomEmojiImage';
import type { MessengerApi } from './useMessengerApi';
import type { CustomEmoji } from './messengerTypes';

const MAX_EMOJI_BYTES = 512 * 1024;
const ACCEPTED_TYPES = ['image/gif', 'image/webp', 'image/png', 'image/apng', 'image/jpeg'];

// Upload a custom emoji/gif: pick a file (≤512KB), it becomes a base64 data
// URI (the avatar pattern — no upload infrastructure), name it, done. Scope
// is the surrounding community or personal when there is none.
export const EmojiUploadModal = ({
  isOpen,
  onClose,
  api,
  communityId,
  communityName,
  onUploaded
}: {
  isOpen: boolean;
  onClose: () => void;
  api: MessengerApi;
  communityId: string | null;
  communityName?: string | null;
  onUploaded: (emoji: CustomEmoji) => void;
}) => {
  const lopu = useLopu();
  const [name, setName] = React.useState('');
  const [dataUri, setDataUri] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setName('');
    setDataUri(null);
    setBusy(false);
  };

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      lopu({ title: 'Gifs, webp, png or jpeg only 🖼️', status: 'error' });
      return;
    }
    if (file.size > MAX_EMOJI_BYTES) {
      lopu({ title: 'That file is over 512KB — trim it down a little', status: 'error' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setDataUri(String(reader.result));
    reader.readAsDataURL(file);
    if (!name) {
      const base = file.name.replace(/\.[a-z0-9]+$/i, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
      setName(base.slice(0, 32).replace(/^[-_]+|[-_]+$/g, ''));
    }
  };

  const upload = async () => {
    if (!dataUri || !name.trim() || busy) return;
    setBusy(true);
    try {
      const result = await api.uploadEmoji({
        name: name.trim(),
        image: dataUri,
        ...(communityId ? { communityId } : {})
      });
      lopu({ title: `:${result.emoji.name}: is ready to party 🎉`, status: 'success', duration: 6000 });
      onUploaded(result.emoji);
      reset();
      onClose();
    } catch (err: any) {
      lopu({ title: err?.error || 'Upload failed 😞', status: 'error' });
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={() => { reset(); onClose(); }} isCentered>
      <ModalOverlay />
      <ModalContent
        background="var(--tt-card, #ffffff)"
        color="var(--tt-ink, #17171c)"
        borderRadius="var(--tt-radius-lg, 16px)"
        marginX={4}
      >
        <ModalHeader fontSize="16px">
          Upload custom emoji {communityId ? `to ${communityName || 'this community'}` : '(personal)'}
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Flex direction="column" gap={3}>
            <Flex
              align="center"
              justify="center"
              height="96px"
              border="1px dashed var(--tt-border, #ececef)"
              borderRadius="var(--tt-radius-md, 10px)"
              cursor="pointer"
              onClick={() => fileRef.current?.click()}
              background="var(--tt-surface, #fafafa)"
            >
              {dataUri ? (
                <CustomEmojiImage image={dataUri} name={name} size={64} />
              ) : (
                <Box color="var(--tt-muted, #9a9aa6)" fontSize="13px" whiteSpace="normal" textAlign="center">
                  Click to choose a gif / image
                  <Box fontSize="11px">≤512KB · gif, webp, png, jpeg</Box>
                </Box>
              )}
            </Flex>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              style={{ display: 'none' }}
              onChange={(event) => pickFile(event.target.files?.[0])}
            />
            <Flex align="center" gap={2}>
              <Box color="var(--tt-muted, #9a9aa6)">:</Box>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value.toLowerCase())}
                placeholder="party-parrot"
                maxLength={32}
                size="sm"
                borderRadius="var(--tt-radius-md, 10px)"
              />
              <Box color="var(--tt-muted, #9a9aa6)">:</Box>
            </Flex>
          </Flex>
        </ModalBody>
        <ModalFooter gap={2}>
          <Button size="sm" variant="ghost" onClick={() => { reset(); onClose(); }}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={upload}
            isLoading={busy}
            isDisabled={!dataUri || !name.trim()}
            background="var(--tt-accent, #a855f7)"
            color="white"
            _hover={{ opacity: 0.9 }}
            borderRadius="var(--tt-radius-pill, 999px)"
          >
            Upload ✨
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
