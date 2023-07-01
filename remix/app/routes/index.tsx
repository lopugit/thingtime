import { Flex } from '@chakra-ui/react'
import { ProfileDrawer } from '~/components/Nav/ProfileDrawer'
import { Splash } from '~/components/Splash/Splash'
import { Thingtime } from '~/components/Thingtime/Thingtime'
import { ThingtimeDemo } from '~/components/Thingtime/ThingtimeDemo'
import { useThingtime } from '~/components/Thingtime/useThingtime'

export default function Index () {
  const { thingtime } = useThingtime()

  return (
    <Flex
      maxW='100%'
      flexDir='column'
      alignItems='center'
      justifyContent='center'
    >
      <Splash></Splash>
      <ThingtimeDemo></ThingtimeDemo>
      <Thingtime mb={200} thing={thingtime['Bottom Content']}></Thingtime>
      <ProfileDrawer></ProfileDrawer>
    </Flex>
  )
}
