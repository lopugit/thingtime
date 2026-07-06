import React from "react"
import { Flex } from "@chakra-ui/react"

import { RAINBOW_TEXT } from "~/theme/rainbow"

export const Attention = (props) => {
  return (
    <Flex
      {...props}
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
      cursor="pointer"
    >
      <Flex
        sx={{
          animation:
            "var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)",
        }}
        width={props.w || "40px"}
        height="2px"
        marginBottom="10px"
        background={RAINBOW_TEXT}
        backgroundSize="calc(100px + 200%)"
        borderBottomRadius="20px"
        transition="all 0.5s ease-in-out"
      ></Flex>
    </Flex>
  )
}
