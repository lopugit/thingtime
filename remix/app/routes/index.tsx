import { Flex } from '@chakra-ui/react'
import { Splash } from '~/components/Splash/Splash'
import { ThingtimeDemo } from '~/components/Thingtime/ThingtimeDemo'

export default function Index () {
  return (
    <Flex pb={40} flexDir="column" alignItems='center' justifyContent='center'>
      <Splash></Splash>
      <ThingtimeDemo></ThingtimeDemo>
    </Flex>
  )
}
