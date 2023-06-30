import React, { useContext } from 'react'

import { StateContext } from '~/Providers/State'

const getGlobal = () => {
  try {
    return window
  } catch {
    return globalThis
  }
}

export const useState = (props?: any) => {

  const { state, addState } = useContext(StateContext)

  return { state, addState }
}
