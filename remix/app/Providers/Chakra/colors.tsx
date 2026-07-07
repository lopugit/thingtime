import hexgba from 'hex-to-rgba';

// Legacy grey tokens, re-pointed at the runtime theme's --tt-* CSS variables
// (fallbacks are the original hexes) so existing `greys.*` usages re-theme live.
const greys = {
  light: 'var(--tt-surface-alt, #F1F1F3)',
  lightt: 'var(--tt-surface-hover, #E7E6E8)',
  medium: 'var(--tt-faint, #E0E0E0)',
  dark: 'var(--tt-muted, #BDBDBD)'
};

const grey = 'var(--tt-surface-alt, #F1F1F3)';

const g = {
  gray: grey,
  grey,
  grays: greys,
  greys
};

// for bad spellers
g.gray = g.grey;
g.grays = g.greys;

const chakrasDark = {
  root: '#8E0000',
  sacral: '#E65100',
  solarPlexus: '#FDD835',
  heart: '#33691E',
  throat: '#1E88E5',
  thirdEye: '#3949AB',
  crown: '#6A1B9A',
  red: '#8E0000',
  orange: '#E65100',
  yellow: '#FDD835',
  green: '#33691E',
  blue: '#1E88E5',
  indigo: '#3949AB',
  violet: '#6A1B9A'
};

const chakrasLight = {
  root: '#C62828',
  sacral: '#FF7043',
  solarPlexus: '#FFEE58',
  heart: '#66BB6A',
  throat: '#42A5F5',
  thirdEye: '#5C6BC0',
  crown: '#AB47BC',
  red: '#C62828',
  orange: '#FF7043',
  yellow: '#FFEE58',
  green: '#66BB6A',
  blue: '#42A5F5',
  indigo: '#5C6BC0',
  violet: '#AB47BC'
};

// map chakra colours and dark version to key.500 and key.600 in an object map

const chakras = {};

for (const key in chakrasLight) {
  chakras[key] = {
    500: chakrasLight[key],
    600: chakrasDark[key]
  };
}

export const colors = {
  white: '#FFFFFF',
  ...g,
  black: '#000000',
  // tt design-system semantic tokens (runtime-themed via ThemeHost CSS vars)
  tt: {
    ink: 'var(--tt-ink, #16161a)',
    text: 'var(--tt-text, #5a5a66)',
    muted: 'var(--tt-muted, #9a9aa6)',
    faint: 'var(--tt-faint, #b6b6c0)',
    border: 'var(--tt-border, #ececef)',
    borderLight: 'var(--tt-border-light, #f0f0f2)',
    surface: 'var(--tt-surface, #fafafb)',
    surfaceAlt: 'var(--tt-surface-alt, #f5f5f7)',
    surfaceHover: 'var(--tt-surface-hover, #ececee)',
    card: 'var(--tt-card, #ffffff)',
    accent: 'var(--tt-accent, hotpink)',
    accentTint: 'var(--tt-accent-tint, #fff5fa)',
    accentContrast: 'var(--tt-accent-contrast, #ffffff)',
    link: 'var(--tt-link, #2f8fd6)',
    positive: 'var(--tt-positive, #2f8f4f)',
    danger: 'var(--tt-danger, #d6455a)',
    warning: 'var(--tt-warning, #ffbc48)'
  },
  // default Button colorScheme (solid ink buttons per the v1 mockup)
  ttInk: {
    500: 'var(--tt-ink, #16161a)',
    600: 'var(--tt-text, #5a5a66)'
  },
  // all colors of the chakras
  chakra: chakras,
  chakras: chakrasLight,
  chakrasDark,
  // all colors of the rainbow
  rainbow: {
    red: '#FF0000',
    orange: '#FF7F00',
    yellow: '#FFFF00',
    green: '#00FF00',
    blue: '#0000FF',
    indigo: '#4B0082',
    violet: '#8F00FF'
  }
};

// recursively loop all colors and add a dark variant

const addDark = (color, name) => {
  if (typeof color === 'object') {
    for (const key in color) {
      addDark(color[key], key);
    }
  } else {
    colors[`${name}-dark`] = hexgba(color, 0.5);
  }
};

// addDark(colors, 'colors');
