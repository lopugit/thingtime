import React from 'react';

import { RainbowText } from './rainbowText';

export const TextAnimation1 = (props) => {
  const texts = React.useMemo(() => {
    if (props?.texts?.length) {
      return props?.texts;
    }

    return [
      'Thingtime',
      'Vibrant',
      'Infinite',
      'Creative',
      'Powerful',
      'Magical',
      'Inspiring',
      'Love'
      // 'tt'
    ];
  }, [props?.texts]);

  const [titleText, setTitleText] = React.useState(texts[0]);

  const [usedTexts, setUsedTexts] = React.useState(texts[0]);

  const state: any = React.useRef({});

  React.useEffect(() => {
    state.current = { titleText, texts, usedTexts };
  }, [titleText, texts, usedTexts]);

  React.useEffect(() => {
    const newTimeout = Math.random() * 1500 + 2500 + (titleText === texts[0] ? 750 : 0);

    const timeout = setTimeout(() => {
      // choose an unused text or pick texts[0]
      const usedTexts = state.current?.usedTexts;
      const unusedTexts = texts.filter((text) => !usedTexts.includes(text));
      // pick a random unused text
      const randomIdx = Math.floor(Math.random() * unusedTexts.length);
      const wasThingtime = false && titleText === texts[0];
      const newText = wasThingtime ? 'is' : unusedTexts.length > 0 ? unusedTexts[randomIdx] : texts[0];
      if (!unusedTexts.length) {
        setUsedTexts(texts[0]);
      } else {
        setUsedTexts([...usedTexts, newText]);
      }

      setTitleText(newText);
    }, newTimeout);

    return () => {
      // cleanup

      clearTimeout(timeout);
    };
  }, [titleText]);

  return <RainbowText ce={props?.ce}>{titleText}</RainbowText>;
};
