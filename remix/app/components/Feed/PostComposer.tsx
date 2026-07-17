import React from 'react';
import { Box, Button, Flex, IconButton, Image, Input, Select, Text } from '@chakra-ui/react';
import { PictureInPicture2, X } from 'lucide-react';

import { useApi } from '~/hooks/useApi';
import { LongTextEditor } from '~/components/Editor/LongTextEditor';
import { useLopu } from '~/components/Lopu/useLopu';
import { UserAvatarCircle } from '~/components/Nav/Drawer/DrawerContent';
import { EditorSplit, startPointerGesture } from '~/components/Thingtime/EditorSplit';
import { useThingtime } from '~/components/Thingtime/useThingtime';
import { RAINBOW } from '~/theme/rainbow';
import { CIRCLE_META, MARKETPLACE_CATEGORY_META, POST_TYPE_META } from './feedTypes';
import type { MarketplaceCategory, PostType, PostVisibility, PublicPost } from './feedTypes';

// "What's on your mind?" composer. Collapsed it's a one-line prompt beside
// the viewer's avatar; expanded it grows type tabs (text/photos/marketplace/
// thingtime), a block editor for the body (Editor.js — headings, lists,
// quotes, checklists serialise to a plain string), image URL rows, listing
// fields, tag chips and a circle picker. The thingtime tab mounts the real
// things editor (an embedded single-window EditorSplit) over the "New Thing"
// draft branch of the global thingtime store (localforage-persisted, so
// half-built things survive reloads) — height-draggable, and poppable into a
// floating, resizable, splittable editor window that stays live-synced with
// the in-post one. Thingtime posts can toggle on the Photos and Marketplace
// field groups too. Posts through api.v1.things.create and hands the
// returned post to onPosted for prepending.

const INK = 'var(--tt-ink, #16161a)';
const TEXT = 'var(--tt-text, #5a5a66)';
const MUTED = 'var(--tt-muted, #9a9aa6)';
const BORDER = '1px solid var(--tt-border, #ececef)';
const RADIUS_SM = 'var(--tt-radius-sm, 9px)';
const RADIUS_MD = 'var(--tt-radius-md, 12px)';

const MAX_IMAGES = 8;
const CURRENCIES = ['AUD', 'USD', 'EUR'];

// The thingtime-tab draft lives under a SESSION-SCOPED branch of the global
// store: tmp.<sessionId>.New Thing. A fresh session id per composer mount (and
// pruning prior composer sessions on seed) means drafts never persist across
// reloads and no stale draft can ever resurface — the editor always opens on
// one clean "New Thing" root (the key IS the label the editor shows).
const DRAFT_ROOT_KEY = 'New Thing';
const DRAFT_TMP_KEY = 'tmp';

// A composer session id is `s` + 10 hex chars (see draftSessionId below). `tmp`
// is a plain user-writable root key in the Thingtime editor, so seeding must
// prune only these composer-owned branches and leave any user-authored `tmp`
// keys untouched.
const COMPOSER_SESSION_KEY = /^s[0-9a-f]{10}$/;

// the in-post editor's default height; drag the handle for anything else
const DEFAULT_EDITOR_HEIGHT = 440;
const MIN_EDITOR_HEIGHT = 120;

const isImageUrl = (url: string) => /^https?:\/\/\S+$/i.test(url.trim());

// A thing "has content" once any leaf holds a real value — numbers, booleans,
// and deliberate nulls count; empty strings don't, so the auto-seeded
// { name: '' } alone never enables Post.
const thingHasContent = (value: unknown): boolean => {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(thingHasContent);
  if (value && typeof value === 'object') return Object.values(value).some(thingHasContent);
  return value !== undefined;
};

const TEXTAREA_PLACEHOLDERS: Record<PostType, string> = {
  text: "What's on your mind? ✨",
  image: 'Say something about these photos… 🖼️',
  marketplace: 'Describe your listing… 🏪',
  thingtime: 'Say something about this thing… 🌀 (optional)'
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
  const { getThingtime, setThingtime, loading: thingtimeLoading, events } = useThingtime();

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

  // thingtime-tab extras: toggleable photos/marketplace field groups, the
  // in-post editor's draggable height, and its imperative API (the pop-out
  // button duplicates the window into one of the editor's own floating frames)
  const [thingPhotos, setThingPhotos] = React.useState(false);
  const [thingListing, setThingListing] = React.useState(false);
  const [editorHeight, setEditorHeight] = React.useState(DEFAULT_EDITOR_HEIGHT);
  const editorApiRef = React.useRef<{ popOutDuplicate: () => void } | null>(null);
  const handleEditorApi = React.useCallback((api: { popOutDuplicate: () => void } | null) => {
    editorApiRef.current = api;
  }, []);

  // bumping the session remounts the block editor with a clean document
  // (while mounted, the editor owns the text)
  const [composerSession, setComposerSession] = React.useState(0);

  const parsedTags = Array.from(
    new Set(
      tagsInput
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
    )
  );

  const validImages = images.map((url) => url.trim()).filter(isImageUrl);

  // this composer's session-scoped draft home (fresh per mount — see
  // DRAFT_ROOT_KEY above). State, not a const: renaming the draft's root key
  // in the editor emits 'path-renamed' and the binding follows.
  const [draftSessionId] = React.useState(() => `s${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`);
  const [draftPath, setDraftPath] = React.useState(`${DRAFT_TMP_KEY}.${draftSessionId}.${DRAFT_ROOT_KEY}`);

  React.useEffect(() => {
    const subscription = (events as any)?.subscribe?.((event: any) => {
      if (event?.type !== 'path-renamed' || typeof event.from !== 'string' || typeof event.to !== 'string') return;
      setDraftPath((prev) =>
        prev === event.from || prev.startsWith(`${event.from}.`) ? `${event.to}${prev.slice(event.from.length)}` : prev
      );
    });
    return () => {
      subscription?.unsubscribe?.();
    };
  }, [events]);

  // read the draft only when the tab is active (this render path runs per
  // keystroke)
  const draftThing = type === 'thingtime' ? getThingtime(draftPath) : null;
  const draftReady = !!draftThing && typeof draftThing === 'object' && !Array.isArray(draftThing);

  // Seed ONCE per mount, post-hydration: rewrite the tmp branch keeping any
  // user-authored keys, dropping only prior composer sessions (abandoned
  // drafts in the persisted blob), and starting this one clean. The once-guard
  // matters — setThingtime/getThingtime change identity on every store write,
  // and a re-running seed used to clobber the draft right after a change-type
  // action turned it into a non-object (string/boolean/…).
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (seededRef.current || thingtimeLoading || type !== 'thingtime' || !expanded) return;
    seededRef.current = true;
    const currentTmp = getThingtime(DRAFT_TMP_KEY);
    const preserved: Record<string, unknown> = {};
    if (currentTmp && typeof currentTmp === 'object' && !Array.isArray(currentTmp)) {
      for (const [key, value] of Object.entries(currentTmp as Record<string, unknown>)) {
        if (!COMPOSER_SESSION_KEY.test(key)) preserved[key] = value;
      }
    }
    setThingtime(DRAFT_TMP_KEY, { ...preserved, [draftSessionId]: { [DRAFT_ROOT_KEY]: {} } });
  }, [type, expanded, thingtimeLoading, getThingtime, setThingtime, draftSessionId]);

  // which optional field groups are in play (marketplace always has both;
  // thingtime opts in per toggle)
  const showPhotos = type === 'image' || type === 'marketplace' || (type === 'thingtime' && thingPhotos);
  const showListing = type === 'marketplace' || (type === 'thingtime' && thingListing);

  const listingValid =
    title.trim().length > 0 &&
    price.trim() !== '' &&
    Number.isFinite(Number(price)) &&
    Number(price) >= 0 &&
    !!currency &&
    !!category;

  const valid =
    type === 'text'
      ? text.trim().length > 0
      : type === 'image'
        ? validImages.length > 0
        : type === 'thingtime'
          ? draftReady &&
            Object.keys(draftThing).length > 0 &&
            thingHasContent(draftThing) &&
            (!thingListing || listingValid) &&
            // a toggled-on Photos group with no valid image is a half-filled
            // form, not an implicit un-toggle — same bar as an image post
            (!thingPhotos || validImages.length > 0)
          : listingValid;

  const reset = () => {
    setExpanded(false);
    setType('text');
    setText('');
    setComposerSession((session) => session + 1);
    setImages([]);
    setTitle('');
    setPrice('');
    setCurrency('AUD');
    setCategory('other');
    setCondition('');
    setListingLocation('');
    setTagsInput('');
    setVisibility('public');
    setThingPhotos(false);
    setThingListing(false);
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
      if (showPhotos) payload.images = validImages;
      if (type === 'thingtime') payload.thing = draftThing;
      if (showListing) {
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
      // the posted thing draft is spent — next thingtime tab starts fresh
      if (type === 'thingtime') setThingtime(draftPath, {});
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
        <Box flex="1" minWidth={0}>
          <LongTextEditor
            key={composerSession}
            value={text}
            onValueChange={(next) => setText(typeof next === 'string' ? next : '')}
            placeholder={TEXTAREA_PLACEHOLDERS[type]}
            minHeight="72px"
          />
        </Box>
      </Flex>

      {/* the thing itself — the real things editor over the draft branch */}
      {type === 'thingtime' && (
        <Flex flexDirection="column" rowGap={2}>
          <Flex alignItems="center" columnGap={1}>
            <Eyebrow>Thing 🌀</Eyebrow>
            <Flex marginLeft="auto" columnGap={1} alignItems="center">
              <Button
                size="xs"
                variant={thingPhotos ? 'solid' : 'ghost'}
                borderRadius={RADIUS_SM}
                onClick={() => setThingPhotos((on) => !on)}
                title="Add photos to this thing post"
              >
                {POST_TYPE_META.image.emoji} Photos
              </Button>
              <Button
                size="xs"
                variant={thingListing ? 'solid' : 'ghost'}
                borderRadius={RADIUS_SM}
                onClick={() => setThingListing((on) => !on)}
                title="Add marketplace listing fields to this thing post"
              >
                {POST_TYPE_META.marketplace.emoji} Marketplace
              </Button>
              <IconButton
                aria-label="Pop the editor out"
                icon={<PictureInPicture2 size={13} />}
                size="xs"
                variant="ghost"
                color={MUTED}
                borderRadius="8px"
                title="Pop out a floating, resizable, splittable editor window (the in-post editor stays)"
                onClick={() => editorApiRef.current?.popOutDuplicate()}
              />
            </Flex>
          </Flex>

          <Box height={`${editorHeight}px`} maxWidth="100%">
            {/* mount as soon as the store hydrates (the seed effect writes in
            the same pass) — the placeholder only covers the true cold start
            while the localforage blob loads, per the optimistic-render rule */}
            {!thingtimeLoading ? (
              <EditorSplit initialPath={draftPath} embedded height="100%" onApi={handleEditorApi} />
            ) : (
              <Flex
                alignItems="center"
                justifyContent="center"
                height="100%"
                border={BORDER}
                borderRadius={RADIUS_MD}
                background="var(--tt-surface, #fafafb)"
              >
                <Text fontSize="sm" color={MUTED}>
                  Summoning your thing… 🌀
                </Text>
              </Flex>
            )}
          </Box>

          {/* height drag handle — pointer events, so touch drags too; grow as
          far as you like (only a small floor so the editor can't vanish) */}
          <Flex
            justifyContent="center"
            paddingY="2px"
            cursor="ns-resize"
            borderRadius={RADIUS_SM}
            sx={{ touchAction: 'none' }}
            _hover={{ background: 'var(--tt-surface-alt, #f5f5f7)' }}
            title="Drag to resize the editor"
            onPointerDown={(event) => {
              event.preventDefault();
              const startY = event.clientY;
              const origin = editorHeight;
              startPointerGesture(event, (move) => {
                setEditorHeight(Math.max(MIN_EDITOR_HEIGHT, origin + move.clientY - startY));
              });
            }}
          >
            <Box width="44px" height="4px" borderRadius="999px" background="var(--tt-faint, #b6b6c0)" />
          </Flex>

          <Text fontSize="10px" color={MUTED} whiteSpace="normal">
            Build any thing — fields, nested objects, arrays, numbers, whatever it needs ✨ Split the editor, or pop
            it out into its own window ↗️
          </Text>
        </Flex>
      )}

      {/* photos */}
      {showPhotos && (
        <Flex flexDirection="column" rowGap={2}>
          <Eyebrow>Photos {type !== 'image' ? '(optional) ' : ''}🖼️</Eyebrow>
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
      {showListing && (
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
