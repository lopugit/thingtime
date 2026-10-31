import React from 'react';

// Renders an uploaded custom emoji. Deliberately NOT routed through the
// generic thing renderers: their safeUrl() blocks data: URIs by design, so
// this component does its own strict data:image (or https) check — same
// pattern as profile avatars.
const SAFE_EMOJI_SRC = /^(data:image\/(gif|webp|png|apng|jpeg);base64,|https:\/\/)/i;

export const CustomEmojiImage = ({
  image,
  name,
  size = 18
}: {
  image: string | undefined;
  name?: string;
  size?: number;
}) => {
  if (!image || !SAFE_EMOJI_SRC.test(image)) {
    // unknown/retired emoji — a quiet placeholder keeps old reactions legible
    return (
      <span
        title={name ? `:${name}:` : 'custom emoji'}
        style={{ fontSize: size * 0.8, lineHeight: `${size}px`, display: 'inline-block' }}
      >
        🖼️
      </span>
    );
  }
  return (
    <img
      src={image}
      alt={name ? `:${name}:` : 'custom emoji'}
      title={name ? `:${name}:` : undefined}
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: 'contain', display: 'inline-block', verticalAlign: 'text-bottom' }}
      draggable={false}
    />
  );
};

// Inline :name: rendering inside message text — resolves against the emoji
// list the viewer can see; unknown names stay literal text.
export const renderTextWithEmojis = (
  text: string,
  emojiByName: Map<string, { id: string; image: string }>,
  size = 20
): React.ReactNode => {
  if (!text.includes(':') || !emojiByName.size) return text;
  const parts = text.split(/(:[a-z0-9][a-z0-9_-]{1,31}:)/g);
  if (parts.length === 1) return text;
  return parts.map((part, index) => {
    const match = /^:([a-z0-9][a-z0-9_-]{1,31}):$/.exec(part);
    const emoji = match ? emojiByName.get(match[1]) : null;
    if (emoji) return <CustomEmojiImage key={index} image={emoji.image} name={match![1]} size={size} />;
    return part;
  });
};
