import React from "react"
import { Text } from "@chakra-ui/react"

export const RainbowText = (props) => {
  return (
    <Text
      as="h1"
      sx={{
        "@keyframes moving-rainbow": {
          "0%": { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "calc(100px + 200%) 0" },
        },
        animation: "moving-rainbow 5s infinite linear",
        "::selection": {
          background: "transparent",
        },
        "::-moz-selection": {
          background: "transparent",
        },
      }}
      position="relative"
      maxWidth="100%"
      color="transparent"
      fontSize="6xl"
      fontWeight="bold"
      backgroundSize="calc(100px + 200%)"
      bgGradient="linear-gradient(to right, #f34a4a, #ffbc48, #58ca70, #47b5e6, #a555e8, #f34a4a)"
      backgroundClip="text"
      userSelect="none"
      outline="none"
      contentEditable={props?.ce}
      spellCheck="false"
    >
      {props?.children}
    </Text>
  )
}
