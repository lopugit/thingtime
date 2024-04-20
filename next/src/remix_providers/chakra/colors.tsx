const greys = {
  light: "#F1F1F3",
  lightt: "#E7E6E8",
  medium: "#E0E0E0",
  dark: "#BDBDBD",
}

const grey = "#F1F1F3"

const g = {
  gray: grey,
  grey,
  grays: greys,
  greys,
}

// for bad spellers
g.gray = g.grey
g.grays = g.greys

export const colors = {
  white: "#FFFFFF",
  ...g,
  black: "#000000",
  // all colors of the chakras
  chakras: {
    root: "#C62828",
    sacral: "#FF7043",
    solarPlexus: "#FFEE58",
    heart: "#66BB6A",
    throat: "#42A5F5",
    thirdEye: "#5C6BC0",
    crown: "#AB47BC",
    red: "#C62828",
    orange: "#FF7043",
    yellow: "#FFEE58",
    green: "#66BB6A",
    blue: "#42A5F5",
    indigo: "#5C6BC0",
    violet: "#AB47BC",
  },
  chakrasDark: {
    root: "#8E0000",
    sacral: "#E65100",
    solarPlexus: "#FDD835",
    heart: "#33691E",
    throat: "#1E88E5",
    thirdEye: "#3949AB",
    crown: "#6A1B9A",
    red: "#8E0000",
    orange: "#E65100",
    yellow: "#FDD835",
    green: "#33691E",
    blue: "#1E88E5",
    indigo: "#3949AB",
    violet: "#6A1B9A",
  },
  // all colors of the rainbow
  rainbow: {
    red: "#FF0000",
    orange: "#FF7F00",
    yellow: "#FFFF00",
    green: "#00FF00",
    blue: "#0000FF",
    indigo: "#4B0082",
    violet: "#8F00FF",
  },
}
