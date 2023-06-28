import { Box } from '@chakra-ui/react'
import { RainbowText } from './rainbowText'
import React from 'react'

export const TextAnimation1 = props => {
  const texts = React.useMemo(() => {
    return [
      'thingtime',
      'vibrant',
      'infinite',
      'creative',
      'powerful',
      'magical',
      'inspiring',
      'love',
      // 'tt'
    ]
  }, [])

  const [titleText, setTitleText] = React.useState(texts[0])

  const [usedTexts, setUsedTexts] = React.useState(["thingtime"])

  const state = React.useRef({})

  React.useEffect(() => {
    state.current = { titleText, texts, usedTexts }
  }, [titleText, texts, usedTexts])
  

  React.useEffect(() => {
    const newTimeout = Math.random() * 1500 + 2500 + (titleText === "thingtime" ? 750 : 0)

    setTimeout(() => {
      // choose an unused text or pick texts[0]
      const usedTexts = state.current.usedTexts
      const unusedTexts = texts.filter(text => !usedTexts.includes(text))
      // pick a random unused text
      const randomIdx = Math.floor(Math.random() * unusedTexts.length)
      const newText = unusedTexts.length > 0 ? unusedTexts[randomIdx] : texts[0]
      if (!unusedTexts.length) {
        setUsedTexts(["thingtime"])
      } else {
        setUsedTexts([...usedTexts, newText])
      }
      setTitleText(newText)
    }, newTimeout)

  }, [titleText])

  return <RainbowText>{titleText}</RainbowText>
}
