import React from "react"
import { Text } from "@chakra-ui/react"

import { RAINBOW_TEXT } from "~/theme/rainbow"

export const RainbowText = (props) => {
  return (
    <Text
      as="h1"
      sx={{
        animation: "var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)",
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
      fontFamily="var(--tt-font-display, var(--tt-font-heading, inherit))"
      letterSpacing="-0.03em"
      background={RAINBOW_TEXT}
      backgroundSize="calc(100px + 200%)"
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
