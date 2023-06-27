import { Box, Flex, Text } from '@chakra-ui/react'
import React from 'react'

export default function Index () {
  const texts = [
    // 't',
    'tt',
    '/',
    'thingtime'
    // 'tht',
    // 'thit',
    // 'thint',
    // 'thingt',
    // 'thingti',
    // 'thingtim',
    // 'thingtime',
    // 'Thingtime',
    // 'ThingTime',
    // 'Thing Time'
  ]

  const [titleText, setTitleText] = React.useState(texts[0])

  const [started, setStarted] = React.useState(false)

  // const mainText = 'Thing Time'
  // const mainText = "Thingtime"
  const mainText = 'thingtime'

  React.useEffect(() => {
    const interval = setInterval(() => {
      const newTextIdx = texts?.indexOf(titleText) + 1
      const newText = texts[newTextIdx] || texts[0]
      setTitleText(newText)
      // if (titleText === 'tt') {
      //   setTitleText('tt.')
      // } else if (titleText === 'tt.') {
      //   setTitleText('tt..')
      // } else if (titleText === 'tt..') {
      //   setTitleText('tt...')
      // } else if (titleText === 'tt...') {
      //   setTitleText(mainText)
      // } else if (titleText === mainText) {
      //   if (!started) {
      //     setStarted(true)
      //     setTimeout(() => {
      //       setTitleText('tt')
      //       setStarted(false)
      //     }, 15000)
      //   }
      // }
    }, 2000)
    return () => clearInterval(interval)
  }, [titleText, started])

  return (
    <>
      <Flex w='100vw' h='100vh' alignItems='center' justifyContent='center'>
        <Text
          as='h1'
          fontSize='6xl'
          fontWeight='bold'
          backgroundClip={'text'}
          color='transparent'
          bgGradient='linear-gradient(to right, #f34a4a, #ffbc48, #58ca70, #47b5e6, #a555e8, #f34a4a);'
          backgroundSize='200%'
          sx={{
            '@keyframes moving-rainbow': {
              '0%': { backgroundPosition: '0 0' },
              '100%': { backgroundPosition: '200% 0' }
            },
            animation: 'moving-rainbow 5s infinite linear'
          }}
        >
          {titleText}
        </Text>
      </Flex>
    </>
  )
}
