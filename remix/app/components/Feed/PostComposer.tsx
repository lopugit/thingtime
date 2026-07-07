import React from 'react';
import { Box, Button, Flex, IconButton, Image, Input, Select, Text, Textarea } from '@chakra-ui/react';
import { X } from 'lucide-react';

import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';
import { UserAvatarCircle } from '~/components/Nav/Drawer/DrawerContent';
import { RAINBOW } from '~/theme/rainbow';
import { CIRCLE_META, MARKETPLACE_CATEGORY_META, POST_TYPE_META } from './feedTypes';
import type { MarketplaceCategory, PostType, PostVisibility, PublicPost } from './feedTypes';

// "What's on your mind?" composer. Collapsed it's a one-line prompt beside
// the viewer's avatar; expanded it grows type tabs (text/photos/marketplace),
// an autosizing textarea, image URL rows, listing fields, tag chips and a
// circle picker. Posts through api.v1.things.create and hands the returned
// post to onPosted for prepending.

const INK = 'var(--tt-ink, #16161a)';
const TEXT = 'var(--tt-text, #5a5a66)';
const MUTED = 'var(--tt-muted, #9a9aa6)';
const BORDER = '1px solid var(--tt-border, #ececef)';
const RADIUS_SM = 'var(--tt-radius-sm, 9px)';
const RADIUS_MD = 'var(--tt-radius-md, 12px)';

const MAX_IMAGES = 8;
const CURRENCIES = ['AUD', 'USD', 'EUR'];

const isImageUrl = (url: string) => /^https?:\/\/\S+$/i.test(url.trim());

const TEXTAREA_PLACEHOLDERS: Record<PostType, string> = {
  text: "What's on your mind? ✨",
  image: 'Say something about these photos… 🖼️',
  marketplace: 'Describe your listing… 🏪'
};

export type PostComposerProps = {
  onPosted: (post: PublicPost) => void;
};

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <Text
    fontFamily="mono"
    fontSize="10px"
    fontWeight={600}
    letterSpacing="0.08em"
    textTransform="uppercase"
    color={MUTED}
  >
    {children}
  </Text>
);

export const PostComposer = (props: PostComposerProps) => {
  const { onPosted } = props;

  const api = useApi();
  const lopu = useLopu();

  const [expanded, setExpanded] = React.useState(false);
  const [type, setType] = React.useState<PostType>('text');
  const [text, setText] = React.useState('');
  const [images, setImages] = React.useState<string[]>([]);
  const [title, setTitle] = React.useState('');
  const [price, setPrice] = React.useState('');
  const [currency, setCurrency] = React.useState('AUD');
  const [category, setCategory] = React.useState<MarketplaceCategory>('other');
  const [condition, setCondition] = React.useState('');
  const [listingLocation, setListingLocation] = React.useState('');
  const [tagsInput, setTagsInput] = React.useState('');
  const [visibility, setVisibility] = React.useState<PostVisibility>('public');
  const [posting, setPosting] = React.useState(false);

  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [text, expanded, type]);

  const parsedTags = Array.from(
    new Set(
      tagsInput
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
    )
  );

  const validImages = images.map((url) => url.trim()).filter(isImageUrl);

  const valid =
    type === 'text'
      ? text.trim().length > 0
      : type === 'image'
        ? validImages.length > 0
        : title.trim().length > 0 &&
          price.trim() !== '' &&
          Number.isFinite(Number(price)) &&
          Number(price) >= 0 &&
          !!currency &&
          !!category;

  const reset = () => {
    setExpanded(false);
    setType('text');
    setText('');
    setImages([]);
    setTitle('');
    setPrice('');
    setCurrency('AUD');
    setCategory('other');
    setCondition('');
    setListingLocation('');
    setTagsInput('');
    setVisibility('public');
  };

  const setImageAt = (index: number, url: string) => {
    setImages((prev) => prev.map((existing, i) => (i === index ? url : existing)));
  };

  const removeImageAt = (index: number) => {
    setImages((prev) => prev.filter((_url, i) => i !== index));
  };

  const handlePost = async () => {
    if (!valid || posting) return;

    setPosting(true);
    try {
      const payload: any = {
        type,
        text: text.trim(),
        visibility,
        tags: parsedTags
      };
      if (type !== 'text') payload.images = validImages;
      if (type === 'marketplace') {
        payload.listing = {
          title: title.trim(),
          price: Number(price),
          currency,
          category,
          condition: condition || null,
          location: listingLocation.trim() || null,
          sold: false
        };
      }

      const resp = await api.v1.things.create(payload);
      lopu({ title: 'Posted ✨', status: 'success', duration: 6000 });
      reset();
      onPosted(resp.post);
    } catch (err: any) {
      lopu({ title: err?.error || 'Post did not go through 😞', status: 'error' });
    }
    setPosting(false);
  };

  if (!expanded) {
    return (
      <Flex
        background="var(--tt-card, #ffffff)"
        border={BORDER}
        borderRadius="var(--tt-radius-lg, 16px)"
        boxShadow="var(--tt-shadow-card, 0px 1px 2px rgba(22, 22, 26, 0.05))"
        padding={3}
        alignItems="center"
        columnGap={3}
      >
        <UserAvatarCircle size="36px" fontSize="sm" />
        <Box
          as="button"
          type="button"
          flex="1"
          textAlign="left"
          background="var(--tt-surface-alt, #f5f5f7)"
          borderRadius="999px"
          paddingX={4}
          paddingY={2}
          fontSize="sm"
          color={MUTED}
          _hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
          onClick={() => setExpanded(true)}
        >
          What's on your mind? ✨
        </Box>
      </Flex>
    );
  }

  return (
    <Flex
      flexDirection="column"
      rowGap={3}
      background="var(--tt-card, #ffffff)"
      border={BORDER}
      borderRadius="var(--tt-radius-lg, 16px)"
      boxShadow="var(--tt-shadow-card, 0px 1px 2px rgba(22, 22, 26, 0.05))"
      padding={4}
    >
      {/* type tabs */}
      <Flex columnGap={1} alignItems="center">
        {(Object.keys(POST_TYPE_META) as PostType[]).map((key) => (
          <Button
            key={key}
            size="xs"
            variant={type === key ? 'solid' : 'ghost'}
            borderRadius={RADIUS_SM}
            onClick={() => setType(key)}
          >
            {POST_TYPE_META[key].emoji} {POST_TYPE_META[key].label}
          </Button>
        ))}
        <IconButton
          aria-label="Close composer"
          icon={<X size={14} />}
          size="xs"
          variant="ghost"
          color={MUTED}
          marginLeft="auto"
          borderRadius="8px"
          onClick={() => setExpanded(false)}
        />
      </Flex>

      <Flex columnGap={3}>
        <UserAvatarCircle size="36px" fontSize="sm" />
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={TEXTAREA_PLACEHOLDERS[type]}
          minHeight="72px"
          resize="none"
          border="none"
          paddingX={0}
          paddingY={1}
          fontSize="md"
          color={INK}
          _focusVisible={{ outline: 'none', boxShadow: 'none' }}
        />
      </Flex>

      {/* photos */}
      {type !== 'text' && (
        <Flex flexDirection="column" rowGap={2}>
          <Eyebrow>Photos {type === 'marketplace' ? '(optional) ' : ''}🖼️</Eyebrow>
          {images.map((url, index) => (
            <Flex key={index} columnGap={2} alignItems="center">
              {isImageUrl(url) && (
                <Image
                  src={url.trim()}
                  alt={`Image ${index + 1} preview`}
                  boxSize="36px"
                  borderRadius="8px"
                  objectFit="cover"
                  flexShrink={0}
                  background="var(--tt-surface-alt, #f5f5f7)"
                />
              )}
              <Input
                size="sm"
                borderRadius={RADIUS_SM}
                placeholder="https://…"
                value={url}
                onChange={(event) => setImageAt(index, event.target.value)}
              />
              <IconButton
                aria-label="Remove image"
                icon={<X size={13} />}
                size="xs"
                variant="ghost"
                color={MUTED}
                borderRadius="8px"
                onClick={() => removeImageAt(index)}
              />
            </Flex>
          ))}
          {images.length < MAX_IMAGES && (
            <Button
              size="xs"
              variant="outline"
              alignSelf="flex-start"
              borderRadius={RADIUS_SM}
              borderColor="var(--tt-border, #ececef)"
              color={TEXT}
              onClick={() => setImages((prev) => [...prev, ''])}
            >
              Add image ➕
            </Button>
          )}
        </Flex>
      )}

      {/* marketplace listing */}
      {type === 'marketplace' && (
        <Flex flexDirection="column" rowGap={2}>
          <Eyebrow>Listing 🏪</Eyebrow>
          <Input
            size="sm"
            borderRadius={RADIUS_SM}
            placeholder="What are you selling?"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Flex columnGap={2}>
            <Input
              size="sm"
              type="number"
              min={0}
              borderRadius={RADIUS_SM}
              placeholder="Price"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
            <Select
              size="sm"
              width="110px"
              flexShrink={0}
              borderRadius={RADIUS_SM}
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </Flex>
          <Flex columnGap={2}>
            <Select
              size="sm"
              borderRadius={RADIUS_SM}
              value={category}
              onChange={(event) => setCategory(event.target.value as MarketplaceCategory)}
            >
              {(Object.keys(MARKETPLACE_CATEGORY_META) as MarketplaceCategory[]).map((key) => (
                <option key={key} value={key}>
                  {MARKETPLACE_CATEGORY_META[key].emoji} {MARKETPLACE_CATEGORY_META[key].label}
                </option>
              ))}
            </Select>
            <Select
              size="sm"
              borderRadius={RADIUS_SM}
              value={condition}
              onChange={(event) => setCondition(event.target.value)}
            >
              <option value="">Condition…</option>
              <option value="new">New ✨</option>
              <option value="used">Used ♻️</option>
            </Select>
          </Flex>
          <Input
            size="sm"
            borderRadius={RADIUS_SM}
            placeholder="Location 📍 (optional)"
            value={listingLocation}
            onChange={(event) => setListingLocation(event.target.value)}
          />
        </Flex>
      )}

      {/* tags */}
      <Flex flexDirection="column" rowGap={2}>
        <Input
          size="sm"
          borderRadius={RADIUS_SM}
          placeholder="Tags, comma separated 🏷️"
          value={tagsInput}
          onChange={(event) => setTagsInput(event.target.value)}
        />
        {parsedTags.length > 0 && (
          <Flex columnGap={1} rowGap={1} flexWrap="wrap">
            {parsedTags.map((tag) => (
              <Box
                key={tag}
                fontSize="xs"
                background="var(--tt-surface-alt, #f5f5f7)"
                color={TEXT}
                borderRadius="999px"
                paddingX={2}
                paddingY="2px"
              >
                #{tag}
              </Box>
            ))}
          </Flex>
        )}
      </Flex>

      {/* footer: circle + post */}
      <Flex alignItems="center" columnGap={2} borderTop={BORDER} paddingTop={3}>
        <Select
          size="sm"
          width="150px"
          borderRadius={RADIUS_SM}
          value={visibility}
          onChange={(event) => setVisibility(event.target.value as PostVisibility)}
          aria-label="Who can see this post"
        >
          {(Object.keys(CIRCLE_META) as PostVisibility[]).map((key) => (
            <option key={key} value={key}>
              {CIRCLE_META[key].emoji} {CIRCLE_META[key].label}
            </option>
          ))}
        </Select>
        <Button
          marginLeft="auto"
          size="sm"
          color="white"
          fontFamily="heading"
          fontWeight={600}
          background={RAINBOW}
          backgroundSize="calc(100px + 200%)"
          sx={{ animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)' }}
          _hover={{ opacity: 0.9 }}
          borderRadius={RADIUS_MD}
          isDisabled={!valid}
          isLoading={posting}
          onClick={handlePost}
        >
          Post ✨
        </Button>
      </Flex>
    </Flex>
  );
};
