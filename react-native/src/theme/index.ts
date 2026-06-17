import { colors } from './colors';

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48
};

export const radii = {
  sm: 6,
  md: 12,
  lg: 20,
  pill: 999
};

export const fontSizes = {
  sm: 13,
  md: 16,
  lg: 20,
  xl: 28,
  xxl: 40
};

export const theme = {
  colors,
  spacing,
  radii,
  fontSizes
};

export type Theme = typeof theme;

export { colors };
