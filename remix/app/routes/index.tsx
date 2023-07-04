import { Box, Flex } from "@chakra-ui/react"

import { ProfileDrawer } from "~/components/Nav/ProfileDrawer"
import { Rainbow } from "~/components/Rainbow/Rainbow"
import { Splash } from "~/components/Splash/Splash"
import { Thingtime } from "~/components/Thingtime/Thingtime"
import { ThingtimeDemo } from "~/components/Thingtime/ThingtimeDemo"
import { useThingtime } from "~/components/Thingtime/useThingtime"

export default function Index() {
  const { thingtime } = useThingtime()

  return (
    <Flex
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
      maxWidth="100%"
    >
      <Box paddingTop={200}></Box>
      <Rainbow>
        <Box width="200px" height="20px" background="grey"></Box>
      </Rainbow>
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
