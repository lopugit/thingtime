import { Flex } from "@chakra-ui/react"

import { TextAnimation1 } from "~/components/textAnimation1"

export const Splash = (props) => {
  return (
    <Flex
      alignItems="center"
      justifyContent="center"
      width="100vw"
      height="100vh"
    >
      <TextAnimation1></TextAnimation1>
    </Flex>
  )
}
