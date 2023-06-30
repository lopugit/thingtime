import React, { createContext, useState, useEffect, useCallback } from "react"

export const StateContext = createContext<StateContextInterface | null>(null)

export const StateProvider = (props: any): JSX.Element => {

  const [state, setState] = useState({})

  const addState = useCallback(
    (newState: any) => {
      setState(prevState => {
        return {
          ...prevState,
          ...newState
        }
      })
    },
    []
  )

  useEffect(() => {
    try {
      window.addState = addState
    } catch {
      // nothing
    }
  }, [])

  return <StateContext.Provider value={{ state, addState }}>{props?.children}</StateContext.Provider>
}

export const withState = (Component: any) => (props: any) => (
  <StateContext.Consumer>
    {props => <Component {...props} />}
  </StateContext.Consumer>
)

export interface StateContextInterface {
  state: any
  addState: any
}
