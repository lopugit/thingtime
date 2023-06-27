import { RainbowText } from './rainbowText'
import React from 'react'

export const TextAnimation1 = props => {
  const texts = React.useMemo(() => {
    return [
      'thingtime',
      'creative',
      'tt',
      'vibrant',
      'powerful',
      'love',
      'infinite',
      'magical',
      'inspiring'
    ]
  }, [])

  const [titleText, setTitleText] = React.useState(texts[0])

  React.useEffect(() => {
    const newTimeout = Math.random() * 3500 + 1500

    setTimeout(() => {
      let newTextIdx = Math.round(Math.random() * (texts.length - 1))
      if (newTextIdx === texts.indexOf(titleText)) {
        newTextIdx = newTextIdx + 1
      }
      const newText = texts[newTextIdx] || texts[0]
      setTitleText(newText)
    }, newTimeout)
  }, [titleText, texts])

  return <RainbowText>{titleText}</RainbowText>
}
