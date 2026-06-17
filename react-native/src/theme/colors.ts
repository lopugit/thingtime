// Thingtime brand colours, ported from the Remix web app's Chakra theme
// (remix/app/Providers/Chakra/colors.tsx) so mobile stays visually coherent.

export const greys = {
  light: '#F1F1F3',
  lightt: '#E7E6E8',
  medium: '#E0E0E0',
  dark: '#BDBDBD'
};

export const chakrasDark = {
  root: '#8E0000',
  sacral: '#E65100',
  solarPlexus: '#FDD835',
  heart: '#33691E',
  throat: '#1E88E5',
  thirdEye: '#3949AB',
  crown: '#6A1B9A'
};

export const chakrasLight = {
  root: '#C62828',
  sacral: '#FF7043',
  solarPlexus: '#FFEE58',
  heart: '#66BB6A',
  throat: '#42A5F5',
  thirdEye: '#5C6BC0',
  crown: '#AB47BC'
};

export const rainbow = {
  red: '#FF0000',
  orange: '#FF7F00',
  yellow: '#FFFF00',
  green: '#00FF00',
  blue: '#0000FF',
  indigo: '#4B0082',
  violet: '#8F00FF'
};

// Ordered top-to-bottom of the chakra spectrum, handy for gradients.
export const rainbowGradient = [
  rainbow.red,
  rainbow.orange,
  '#FFD500',
  rainbow.green,
  rainbow.blue,
  rainbow.indigo,
  rainbow.violet
];

export const colors = {
  white: '#FFFFFF',
  black: '#000000',
  grey: '#F1F1F3',
  grays: greys,
  greys,
  // primary action colour — the throat (blue) chakra, matching the web Switch accent
  primary: chakrasLight.throat,
  text: '#1A1A1A',
  textMuted: '#6B6B6B',
  background: '#FFFFFF',
  card: '#FAFAFB',
  border: greys.medium,
  chakras: chakrasLight,
  chakrasDark,
  rainbow,
  rainbowGradient
};

export type Colors = typeof colors;
