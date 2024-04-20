import {
  Button,
  extendTheme,
  Input,
  NumberDecrementStepper,
  NumberIncrementStepper,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  Select,
  Switch,
  Textarea
} from "@chakra-ui/react"

import hexgba from "hex-to-rgba"

const space: any = {}

const start = 0
const end = 9999

for (let i = start; i <= end; i++) {
  space[i] = `${i * 0.25}rem`
}

const greys = {
  light: "#F1F1F3",
  lightt: "#E7E6E8",
  medium: "#E0E0E0",
  dark: "#BDBDBD"
}

const grey = "#F1F1F3"

const Grey = {
  gray: grey,
  grey,
  grays: greys,
  greys
}

// for bad spellers
Grey.gray = Grey.grey
Grey.grays = Grey.greys

export const colors: any = {
  white: "#FFFFFF",
  offwhite: "#F9F9F9",
  black: "#000000",
  subheading: "#4A4A4A",
  ...Grey,
  bright: {
    red: "#C62828",
    opaqueRed: "rgba(198, 40, 40, 0.5)",
    orange: "#FF7043",
    yellow: "#FFEE58",
    green: "#66BB6A",
    blue: "#42A5F5",
    indigo: "#5C6BC0",
    violet: "#AB47BC"
  },
  dark: {
    red: "#8E0000",
    orange: "#E65100",
    yellow: "#FDD835",
    green: "#33691E",
    blue: "#1E88E5",
    indigo: "#3949AB",
    violet: "#6A1B9A"
  },
  // all colors of the rainbow
  rainbow: {
    red: "#FF0000",
    orange: "#FF7F00",
    yellow: "#FFFF00",
    green: "#00FF00",
    blue: "#0000FF",
    indigo: "#4B0082",
    violet: "#8F00FF"
  }
}

// recursively add rgba(hex, 0.5) versions for all colours

function addRgba(obj: any, parentKey: string, opacity = 0.5) {
  for (const key in obj) {
    // return early if key includes "-"" already

    if (key.includes("-")) {
      return
    }

    const value = obj[key]
    if (typeof value === "object") {
      addRgba(value, key)
    } else {
      obj[`${key}-${opacity}`] = hexgba(value, opacity)
    }
  }
}

// run for all opacities 0 - 1 with steps of 0.05

// const opacities = Array.from({ length: 21 }, (_, i) => i / 20)

// opacities.forEach((opacity) => {
//   addRgba(colors, "", opacity)
// })

addRgba(colors, "", 0)
addRgba(colors, "", 0.25)
addRgba(colors, "", 0.5)
addRgba(colors, "", 0.75)
addRgba(colors, "", 1)

export const theme = extendTheme({
  colors,
  space,
  styles: {
    global: {
      // make all elements padding and margin animate
      "*": {
        transition: "padding 0.2s ease, margin 0.2s ease-out"
      }
      // // make all elements have a transparent focus border
      // "input:focus": {
      //   boxShadow: "none !important",
      //   borderColor: "transparent !important"
      // },
      // // make all elements have a transparent focus border
      // "textarea:focus": {
      //   boxShadow: "none !important",
      //   borderColor: "transparent !important"
      // },
      // // make all elements have a transparent focus border
      // "select:focus": {
      //   boxShadow: "none !important",
      //   borderColor: "transparent !important"
      // },
      // // make all elements have a transparent focus border
      // "button:focus": {
      //   boxShadow: "none !important",
      //   borderColor: "transparent !important"
      // },
      // // make all elements have a transparent focus border
      // "div:focus": {
      //   boxShadow: "none !important",
      //   borderColor: "transparent !important"
      // },
      // // make all elements have a transparent focus border
      // "a:focus": {
      //   boxShadow: "none !important",
      //   borderColor: "transparent !important"
      // },
      // // make all elements have a transparent focus border
      // "span:focus": {
      //   boxShadow: "none !important",
      //   borderColor: "transparent !important"
      // }
    }
  },
  components: {
    Input: {
      defaultProps: {},
      baseStyle: {
        field: {}
      }
    },
    Select: {
      baseStyle: {
        field: {},
        icon: {
          width: "14px"
        }
      }
    },
    Switch: {
      baseStyle: {
        track: {
          background: "greys.medium",
          _checked: {
            background: "bright.blue"
          }
        }
      }
    },
    NumberInput: {
      baseStyle: {
        field: {
          width: "auto"
        }
      }
    }
  }
})

const formBg = {
  bg: "offwhite"
}

const formBorder = {
  borderColor: "black-0"
}

const formColours = {
  ...formBg,
  ...formBorder
}

const formInputProps = {
  ...formColours,
  py: 6
}

Input.defaultProps = {
  ...formInputProps
}

Textarea.defaultProps = {
  py: 3.5,
  ...formColours
}

Switch.defaultProps = {
  ...Switch.defaultProps,
  as: "div"
}

Select.defaultProps = {
  ...Select.defaultProps,
  focusBorderColor: "transparent",
  outline: "0px solid",
  border: "none",
  ps: "0px",
  px: "0px",
  sx: {
    paddingInlineStart: "0px",
    paddingInlineEnd: "24px"
  }
}

NumberInput.defaultProps = {
  ...NumberInput.defaultProps
}

NumberInputField.defaultProps = {
  ...NumberInputField.defaultProps,
  height: "100%",
  pr: 3,
  fontSize: "inherit"
}

NumberInputStepper.defaultProps = {
  ...NumberInputStepper.defaultProps,
  border: "none",
  color: "grays.medium"
}

NumberIncrementStepper.defaultProps = {
  ...NumberIncrementStepper.defaultProps,
  border: "none"
}
NumberDecrementStepper.defaultProps = {
  ...NumberDecrementStepper.defaultProps,
  border: "none"
}

Button.defaultProps = {
  ...Button.defaultProps,
  bg: "offwhite"
}
