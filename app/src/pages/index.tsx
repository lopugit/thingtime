import Head from 'next/head'
import { Inter } from 'next/font/google'
import globalStyles from '../styles/global.module.css'

import { Card } from '@chakra-ui/card'
import { Flex } from '@chakra-ui/layout'
import { colors } from '@/chakra/theme/colors'
const inter = Inter({ subsets: ['latin'] })

export default function Home() {
  return (
    <>
      <Head>
        <title>Thing Time</title>
        <meta name="description" content="Thing Time" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main>
        <Flex className="thingtime-hover"  w="100%" minH="100vh" alignItems="center" justifyContent="center">
          <Flex 
            _hover={{
              cursor: "pointer"
            }} 
            textShadow={`0px 0px 8px ${colors.green}`}
          >
            Thing Time
          </Flex>
        </Flex>
      </main>
    </>
  )
}
