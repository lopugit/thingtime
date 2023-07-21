import { extendTheme, Select, Switch } from "@chakra-ui/react"

import { colors } from "./colors"

export const theme = extendTheme({
  colors,
  // edit Input defaultProps
  styles: {
    global: {
      // make all elements padding and margin animate
      "*": {
        transition: "padding 0.2s ease, margin 0.2s ease",
      },
      // make all elements have a transparent focus border
      "input:focus": {
        boxShadow: "none !important",
        borderColor: "transparent !important",
      },
      // make all elements have a transparent focus border
      "textarea:focus": {
        boxShadow: "none !important",
        borderColor: "transparent !important",
      },
      // make all elements have a transparent focus border
      "select:focus": {
        boxShadow: "none !important",
        borderColor: "transparent !important",
      },
      // make all elements have a transparent focus border
      "button:focus": {
        boxShadow: "none !important",
        borderColor: "transparent !important",
      },
      // make all elements have a transparent focus border
      "div:focus": {
        boxShadow: "none !important",
        borderColor: "transparent !important",
      },
      // make all elements have a transparent focus border
      "a:focus": {
        boxShadow: "none !important",
        borderColor: "transparent !important",
      },
      // make all elements have a transparent focus border
      "span:focus": {
        boxShadow: "none !important",
        borderColor: "transparent !important",
      },
    },
  },
  components: {
    Input: {
      defaultProps: {
        // focusBorderColor: "transparent",
        // outline: "0px solid",
        // border: "0px solid",
      },
      baseStyle: {
        // "padding-inline-start": "0px",
        field: {
          // "padding-inline-start": "0px",
        },
      },
    },
    Select: {
      baseStyle: {
        field: {
          // "padding-inline-start": "0px",
        },
        icon: {
          // height: "8px",
          width: "14px",
        },
      },
    },
    Switch: {
      baseStyle: {
        track: {
          background: "grays.medium",
          _checked: {
            background: "chakras.throat",
          },
        },
      },
    },
  },
})

console.log("nik Select", Select)

Switch.defaultProps = {
  ...Switch.defaultProps,
  as: "div",
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
    paddingInlineEnd: "24px",
  },
}
