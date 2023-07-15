import React from "react"
import { Text } from "@chakra-ui/react"

export const RainbowText = (props) => {
  return (
    <Text
      as="h1"
      sx={{
        "@keyframes moving-rainbow": {
          "0%": { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        animation: "moving-rainbow 5s infinite linear",
      }}
      position="relative"
      color="transparent"
      fontSize="6xl"
      fontWeight="bold"
      backgroundSize="200%"
      bgGradient="linear-gradient(to right, #f34a4a, #ffbc48, #58ca70, #47b5e6, #a555e8, #f34a4a)"
      backgroundClip="text"
      userSelect="none"
    >
      {props?.children}
    </Text>
  )
}
