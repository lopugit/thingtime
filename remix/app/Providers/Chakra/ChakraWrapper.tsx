import { ChakraProvider } from '@chakra-ui/react'
import { theme } from './theme'
export const ChakraWrapper = props => {
  return <ChakraProvider theme={theme}>{props.children}</ChakraProvider>
}
