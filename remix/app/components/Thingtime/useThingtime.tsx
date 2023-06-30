import React from 'react'

const getGlobal = () => {
  try {
    return window
  } catch {
    return globalThis
  }
}

export const useThingtime = (props?: any) => {
  const glob = getGlobal()

  return { state: {} }
}
