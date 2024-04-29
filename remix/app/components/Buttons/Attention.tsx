import React from "react"
import { Flex } from "@chakra-ui/react"

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
          "@keyframes moving-rainbow": {
            "0%": { backgroundPosition: "0 0" },
            "100%": { backgroundPosition: "200% 0" },
          },
          // add delay
          animation: `moving-rainbow 3s infinite linear`,
        }}
        width={props.w || "40px"}
        height="2px"
        marginBottom="10px"
        background="linear-gradient(to right, #f34a4a, #ffbc48, #58ca70, #47b5e6, #a555e8, #f34a4a);"
        backgroundSize="200%"
        borderBottomRadius="20px"
        transition="all 0.5s ease-in-out"
      ></Flex>
    </Flex>
  )
}
