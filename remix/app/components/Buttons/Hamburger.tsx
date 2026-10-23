import React from "react"
import { Flex } from "@chakra-ui/react"

import { RAINBOW_TEXT } from "~/theme/rainbow"

export const Hamburger = (props) => {
  const lineCount = [1, 2, 3]

  return (
    <Flex
      {...props}
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
      cursor="pointer"
    >
      {lineCount.map((line, idx) => {
        return (
          <Flex
            key={idx}
            sx={{
              animation:
                "var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)",
              // stagger the pan per line
              animationDelay: `-${idx * 0.3}s`,
            }}
            width="40px"
            height="3px"
            marginBottom="10px"
            background={RAINBOW_TEXT}
            backgroundSize="calc(100px + 200%)"
            borderRadius="var(--tt-radius-sm, 9px)"
          ></Flex>
        )
      })}
    </Flex>
  )
}
