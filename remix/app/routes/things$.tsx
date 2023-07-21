import React from "react"
import { Box, Flex } from "@chakra-ui/react"
import { useMatches } from "@remix-run/react"

import { ProfileDrawer } from "~/components/Nav/ProfileDrawer"
import { Splash } from "~/components/Splash/Splash"
import { Thingtime } from "~/components/Thingtime/Thingtime"
import { ThingtimeDemo } from "~/components/Thingtime/ThingtimeDemo"
import { useThingtime } from "~/components/Thingtime/useThingtime"
import { GradientPath } from "~/gp/GradientPath"

export default function Index() {
  const { getThingtime } = useThingtime()

  const matches = useMatches()
  const location = React.useMemo(() => {
    return matches[matches.length - 1]
  }, [matches])

  const path = React.useMemo(() => {
    const pathStepOne = location?.pathname?.replace("/things/", "")

    const path = pathStepOne?.replace(/\//g, ".")
    return path
  }, [location?.pathname])

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
        path={path}
        thing={thing}
        chakras={{ marginY: 200 }}
        width="600px"
      ></Thingtime>
      <ProfileDrawer></ProfileDrawer>
    </Flex>
  )
}
