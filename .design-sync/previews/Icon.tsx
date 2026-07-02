import { Icon } from 'thingtime';

// Emoji icon system: `name` accepts a semantic alias (or raw emoji); `size`
// sets the rendered font size. Unknown names render the shrug emoji.

export const Rainbow = () => <Icon name="rainbow" size="64px" />;

export const Magic = () => <Icon name="magic" size="64px" />;

export const Gallery = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center' }}>
    {['rainbow', 'magic', 'rocket', 'heart', 'star', 'crystal', 'wizard', 'book', 'search', 'success', 'error', 'time'].map((n) => (
      <Icon key={n} name={n} size="34px" />
    ))}
  </div>
);
