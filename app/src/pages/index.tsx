import Head from 'next/head'
import { Inter } from 'next/font/google'
import styles from '@/styles/Home.module.css'

import { Card } from '@chakra-ui/card'
import { Flex } from '@chakra-ui/layout'

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
        <Flex w="100%" minH="100vh" alignItems="center" justifyContent="center">
          Thing Time
        </Flex>
      </main>
    </>
  )
}
