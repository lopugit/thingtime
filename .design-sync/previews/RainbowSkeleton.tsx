import { RainbowSkeleton } from 'thingtime';

// Rainbow shimmer loading placeholder. Animates its background through the
// brand rainbow; `loaded` swaps the shimmer for `children`. Size via Chakra
// width/height/borderRadius (default is a tiny 10x8 dot).

export const Bar = () => <RainbowSkeleton width="160px" height="14px" borderRadius="7px" />;

export const Block = () => <RainbowSkeleton width="220px" height="90px" borderRadius="10px" />;

export const Loaded = () => (
  <RainbowSkeleton loaded width="220px" height="90px">
    <div style={{ width: 220, height: 90, borderRadius: 10, background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '600 14px system-ui', color: '#333' }}>
      Loaded content
    </div>
  </RainbowSkeleton>
);
