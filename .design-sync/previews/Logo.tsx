import { Logo } from 'thingtime';

// The Thingtime voxel logo. `theme` selects the palette ('nature'/'default'
// use the full rainbow voxel colours; 'pink' is a monochrome hotpink variant);
// `icon` swaps the full wordmark for the compact 3x3 mark; `voxelSize` scales it.

export const Wordmark = () => <Logo theme="nature" voxelSize={18} />;

export const PinkWordmark = () => <Logo theme="pink" voxelSize={18} />;

export const IconMark = () => <Logo icon theme="nature" voxelSize={40} />;

export const IconMarkPink = () => <Logo icon theme="pink" voxelSize={40} />;
