import React from "react"
import { Flex } from "@chakra-ui/react"
import { useMatches } from "@remix-run/react"

import { Thingtime } from "./Thingtime"
import { useThingtime } from "./useThingtime"

export const ThingtimeURL = (props) => {
  const { getThingtime } = useThingtime()

  const matches = useMatches()
  const location = React.useMemo(() => {
    return matches[matches.length - 1]
  }, [matches])

  const path = React.useMemo(() => {
    const pathPartOne = location?.params?.["*"]

    const path = pathPartOne?.replace(/\//g, ".")

    return path
  }, [location])

  const thing = React.useMemo(() => {
    // remove /things/ from path

    const ret = getThingtime(path)

    return ret
  }, [path, getThingtime])

  return (
    <Flex
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
      maxWidth="100%"
    >
      <Thingtime
        edit={props?.edit}
        path={path}
        thing={thing}
        chakras={{ marginY: 200 }}
        width="600px"
      ></Thingtime>
    </Flex>
  )
}
