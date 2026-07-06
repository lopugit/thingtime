import { Attention } from 'thingtime';

// A thin animated rainbow accent bar used to draw attention (e.g. above a
// control or label). `w` sets the bar width. The bar is ~2px tall by design,
// so it reads as a slim rainbow underline/accent.

export const Widths = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 28, padding: '16px 0', alignItems: 'flex-start' }}>
    <Attention w="48px" />
    <Attention w="100px" />
    <Attention w="180px" />
  </div>
);

export const Accent = () => (
  <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '16px 0' }}>
    <span style={{ font: '700 18px system-ui', color: '#1a1a1a' }}>Thingtime</span>
    <Attention w="120px" />
  </div>
);
