import React from "react"
import { Flex } from "@chakra-ui/react"

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
              "@keyframes moving-rainbow": {
                "0%": { backgroundPosition: "0 0" },
                "100%": { backgroundPosition: "200% 0" },
              },
              // add delay
              animation: `moving-rainbow 3s infinite linear -${idx * 0.3}s}`,
            }}
            width="40px"
            height="3px"
            marginBottom="10px"
            background="linear-gradient(to right, #f34a4a, #ffbc48, #58ca70, #47b5e6, #a555e8, #f34a4a);"
            backgroundSize="200%"
            borderRadius="9px"
          ></Flex>
        )
      })}
    </Flex>
  )
}
