import React, { createContext } from "react"

import { sanitise } from "~/functions/sanitise"
import { smarts } from "~/smarts"

export interface ThingtimeContextInterface {
  thingtime: any
  setThingtime: any
  getThingtime: any
  thingtimeRef: any
}

export const ThingtimeContext = createContext<
  ThingtimeContextInterface[] | null
>(null)

try {
  window.smarts = smarts
} catch (err) {
  // nothing
}

const force = {
  settings: {
    commanderActive: true,
  },
  version: 22,
}

const newVersionData = {
  Content: {
    hidden1: "Edit this to your heart's desire.",
    "How?": "Just search for Content and edit the value to whatever you want.",
    "Example:": `Content = New Content!
      Content.Nested Content = New Nested Content!
    `,
  },
}

const initialValues = {
  settings: {
    commanderActive: true,
    clearCommanderOnToggle: true,
    clearCommanderContextOnToggle: true,
  },
  Content: {
    hidden1: "Edit this to your heart's desire.",
    "How?": "Just search for Content and edit the value to whatever you want.",
    "Example:": `Content = New Content!
      Content.Nested Content = New Nested Content!
    `,
  },
}

const initialThingtime = smarts.merge(initialValues, force)

export const ThingtimeProvider = (props: any): JSX.Element => {
  const [thingtime, set] = React.useState(smarts.merge(initialValues, force))

  const thingtimeRef = React.useRef(thingtime)

  // get thingtime from localstorage
  React.useEffect(() => {
    try {
      const thingtimeFromLocalStorage = window.localStorage.getItem("thingtime")

      if (thingtimeFromLocalStorage) {
        const parsed = JSON.parse(thingtimeFromLocalStorage)
        if (parsed) {
          const localIsValid =
            !parsed.version || parsed.version >= force.version
          if (localIsValid) {
            const newThingtime = smarts.merge(force, parsed)
            console.log("nik comm newThingtime", newThingtime)
            set(newThingtime)
          } else {
            const withVersionUpdates = smarts.merge(newVersionData, parsed)
            const newThingtime = smarts.merge(force, withVersionUpdates)
            set(newThingtime)
          }
        }
      }
    } catch (err) {
      console.error("There was an error getting thingtime from localStorage")
    }
  }, [])

  React.useEffect(() => {
    thingtimeRef.current = thingtime

    try {
      window.localStorage.setItem("thingtime", JSON.stringify(thingtime))
    } catch (err) {
      console.error("There was an error saving thingtime to localStorage")
    }
  }, [thingtime])

  const setThingtime = React.useCallback(
    (path, value) => {
      const prevThingtime = thingtime

      const newThingtime = {
        ...prevThingtime,
      }

      // check if first characters of path starts with thingtime or tt and strip from path

      path = sanitise(path)

      smarts.setsmart(newThingtime, path, value)

      // subtract last path part from dot delimitted path
      // prop1.prop2.prop3 => prop1.prop2
      const pathParts = path.split(".")
      pathParts.pop()
      const parentPath = pathParts.join(".")

      if (parentPath?.length) {
        const parent = smarts.getsmart(newThingtime, parentPath)

        const newParent = Array.isArray(parent) ? [...parent] : { ...parent }

        smarts.setsmart(newThingtime, parentPath, newParent)
      }

      set(newThingtime)
    },
    [thingtime]
  )

  const getThingtime = React.useCallback(
    (...args) => {
      const rawPath = args[0]
      if (
        rawPath === "thingtime" ||
        rawPath === "tt" ||
        rawPath === "." ||
        !rawPath
      ) {
        return thingtime
      }
      const path = sanitise(rawPath)
      console.log("Getting thingtime at path", path)
      return smarts.getsmart(thingtime, path)
    },
    [thingtime]
  )

  React.useEffect(() => {
    try {
      window.setThingtime = setThingtime
      window.thingtime = thingtime
      window.tt = thingtime
    } catch {
      // nothing
    }

    const keyListener = (e) => {}

    window.addEventListener("keydown", keyListener)

    return () => {
      window.removeEventListener("keydown", keyListener)
    }
  }, [setThingtime, thingtime])

  const value = {
    thingtime,
    setThingtime,
    getThingtime,
    thingtimeRef,
  }

  return (
    <ThingtimeContext.Provider value={value}>
      {props?.children}
    </ThingtimeContext.Provider>
  )
}
