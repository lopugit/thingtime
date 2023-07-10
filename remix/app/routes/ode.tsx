import { Box, Center, Flex } from "@chakra-ui/react"

import { ProfileDrawer } from "~/components/Nav/ProfileDrawer"
import { Splash } from "~/components/Splash/Splash"
import { Thingtime } from "~/components/Thingtime/Thingtime"
import { ThingtimeDemo } from "~/components/Thingtime/ThingtimeDemo"
import { useThingtime } from "~/components/Thingtime/useThingtime"
import { GradientPath } from "~/gp/GradientPath"

export default function Index() {
  const { thingtime } = useThingtime()

  const ode = {
    "Ode to Thingtime": `
    
      In the infinite expanses of the digital universe, there exists a radiant realm, a pixel paradise known as Thing Time. Here, a cosmic canvas unfurls, inviting explorers from far and wide to etch their ideas, thoughts, and dreams into its ever-changing tapestry.

      As you step into Thing Time, you find yourself in a world of binary bliss, where every pixel pulses with possibility. The air thrums with the hum of shared thought, each byte bending and reshaping to mirror the collective wisdom of countless minds.

      The landscape morphs and molds to the whims of its inhabitants, each creating, collaborating, and curating their unique contributions. Trees of code reach their branches high into the cloud, blooming with arrays of astral ideas, their roots deep in the fertile ground of shared understanding.

      Time here does not tick in minutes or hours, but in the rhythm of creation, inspiration, and exploration. And it's not just about your time - it's about our time, a communal clock synchronizing the heartbeats of thinkers, dreamers, and doers.

      In Thing Time, we don't just observe - we participate, contribute, and shape. We paint with the brush of JavaScript, sketching out our thoughts in lines of lucid links and hyper harmonies. Together, we weave stories and knowledge into a vivid, ever-evolving tapestry of shared experience.

      That's Thing Time - a dance of data, a symphony of syntax, a carnival of creation. An epic element of the digital era, forever inviting you to join in the melody of shared imagination. This is your call to the creative, a beacon in the binary, your invite to the infinite. This is Thing Time. Welcome.
      
      - ChatGPT 4.0
      
    `,
    // "- ChatGPT 4.0 hidden": "   ",
  }

  return (
    <Flex
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
      maxWidth="100%"
    >
      {/* <Box paddingTop={200}></Box> */}
      {/* <Splash></Splash> */}
      <Center width="100vw" maxWidth="100%" minHeight="100vh" paddingY={100}>
        <Thingtime width="700px" valuePl={0} thing={ode}></Thingtime>
      </Center>
    </Flex>
  )
}
