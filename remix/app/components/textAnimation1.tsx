import { RainbowText } from './rainbowText'
import React from 'react'

export const TextAnimation1 = props => {
  const texts = React.useMemo(() => {
    return [
      // 't',
      'tt',
      'thingtime'
      // 'tt / thingtime'
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
  }, [])

  const [titleText, setTitleText] = React.useState(texts[0])

  React.useEffect(() => {
    const interval = setInterval(() => {
      const newTextIdx = texts?.indexOf(titleText) + 1
      const newText = texts[newTextIdx] || texts[0]
      setTitleText(newText)
    }, 4000)
    return () => clearInterval(interval)
  }, [titleText, texts])

  return <RainbowText>{titleText}</RainbowText>
}
