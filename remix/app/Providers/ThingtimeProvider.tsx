import React, { createContext } from 'react'
import { sanitise } from '~/functions/path'
import { smarts } from '~/smarts'

export interface ThingtimeContextInterface {
  thingtime: any
  setThingtime: any
}

export const ThingtimeContext = createContext<ThingtimeContextInterface | null>(
  null
)

try {
  window.smarts = smarts
} catch (err) {
  // nothing
}

const initialThingtime = {
  nav: {},
  settings: {
    showCommander: true,
    clearCommanderOnToggle: true,
    clearCommanderContextOnToggle: true
  }
}

export const ThingtimeProvider = (props: any): JSX.Element => {
  const [thingtime, set] = React.useState(initialThingtime)

  const setThingtime = React.useCallback(
    (path, value) => {
      const prevThingtime = thingtime

      const newThingtime = {
        ...prevThingtime
      }

      // check if first characters of path starts with thingtime or tt and strip from path

      path = sanitise(path)

      // log the path and value
      console.log('nik ThingtimeProvider setThingtime path', path)
      console.log('nik ThingtimeProvider setThingtime value', value)

      smarts.setsmart(newThingtime, path, value)

      set(newThingtime)
    },
    [thingtime]
  )

  const getThingtime = React.useCallback(
    (...args) => {
      const path = args[0]
      if (path === 'thingtime' || path === 'tt' || !path) {
        return thingtime
      }
      return smarts.getsmart(thingtime, path)
    },
    [thingtime]
  )

  React.useEffect(() => {
    try {
      window.setThingtime = setThingtime
      window.thingtime = thingtime
    } catch {
      // nothing
    }

    const keyListener = e => {}

    window.addEventListener('keydown', keyListener)

    return () => {
      window.removeEventListener('keydown', keyListener)
    }
  }, [setThingtime, thingtime])

  const value = {
    thingtime,
    setThingtime,
    getThingtime
  }

  return (
    <ThingtimeContext.Provider value={value}>
      {props?.children}
    </ThingtimeContext.Provider>
  )
}
