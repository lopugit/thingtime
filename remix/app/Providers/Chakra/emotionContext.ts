import React from 'react';

export type EmotionStyleData = {
  key: string;
  ids: string[];
  css: string;
};

export const ServerStyleContext = React.createContext<EmotionStyleData[] | null>(null);
