import { Box, Flex } from "@chakra-ui/react"

import { ProfileDrawer } from "~/components/Nav/ProfileDrawer"
import { Splash } from "~/components/Splash/Splash"
import { Thingtime } from "~/components/Thingtime/Thingtime"
import { ThingtimeDemo } from "~/components/Thingtime/ThingtimeDemo"
import { useThingtime } from "~/components/Thingtime/useThingtime"
import { GradientPath } from "~/gp/GradientPath"

export default function Index() {
  const { thingtime } = useThingtime()

  return (
    <Flex
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
      maxWidth="100%"
    >
      {/* <Box paddingTop={200}></Box> */}
      <Splash></Splash>
      <Thingtime
        marginBottom={200}
        path="Content"
        valuePl={0}
        thing={thingtime["Content"]}
      ></Thingtime>
      <ThingtimeDemo></ThingtimeDemo>
      <ProfileDrawer></ProfileDrawer>
    </Flex>
  )
}
