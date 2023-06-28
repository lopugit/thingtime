import React from "react"
import { Box, Flex } from "@chakra-ui/react"

export const Thingtime = props => {

  const thing = React.useMemo(() => {
    return props.thing
  }, [props.thing])

  return <Flex flexDir="column">
    <pre>
      {JSON.stringify(thing, null, 2)}
    </pre>
  </Flex>
  
}