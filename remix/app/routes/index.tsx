import { Flex } from '@chakra-ui/react'
import { ProfileDrawer } from '~/components/Nav/ProfileDrawer'
import { Splash } from '~/components/Splash/Splash'
import { ThingtimeDemo } from '~/components/Thingtime/ThingtimeDemo'

export default function Index () {
  return (
    <Flex
      maxW='100%'
      flexDir='column'
      alignItems='center'
      justifyContent='center'
    >
      <Splash></Splash>
      <ThingtimeDemo></ThingtimeDemo>
      <ProfileDrawer></ProfileDrawer>
    </Flex>
  )
}
