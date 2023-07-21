import React, { createContext } from "react"
import { parse, stringify } from "flatted"

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
    // commanderActive: false,
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
    commanderActive: false,
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

// TODO: Make localStorage be loaded first before initialValues if local version exists
// and is valid
// Issue seems to be server id is different to client hydration

// let thingtimeToUse = initialThingtime

// try {
//   const thingtimeFromLocalStorage = window.localStorage.getItem("thingtime")

//   if (thingtimeFromLocalStorage) {
//     const parsed = parse(thingtimeFromLocalStorage)
//     if (parsed) {
//       const localIsValid = !parsed.version || parsed.version >= force.version
//       if (localIsValid) {
//         const newThingtime = smarts.merge(force, parsed)
//         console.log("nik comm newThingtime", newThingtime)
//         thingtimeToUse = newThingtime
//       } else {
//         const withVersionUpdates = smarts.merge(newVersionData, parsed)
//         const newThingtime = smarts.merge(force, withVersionUpdates)
//         thingtimeToUse = newThingtime
//       }
//     }
//   }
// } catch (err) {
//   console.error("Caught error restoring thingtime from localstorage", err)
// }

export const ThingtimeProvider = (props: any): JSX.Element => {
  const [thingtime, rawSet] = React.useState(initialThingtime)

  const set = React.useCallback((newThingtime) => {
    newThingtime.tt = newThingtime
    newThingtime.thingtime = newThingtime
    rawSet(newThingtime)
  }, [])

  const thingtimeRef = React.useRef(thingtime)
  const stateRef = React.useRef({
    c: 1,
  })

  const setThingtime = React.useCallback(
    (path, value) => {
      const prevThingtime = thingtime

      const newThingtime = {
        ...prevThingtime,
      }

      newThingtime.tt = newThingtime
      newThingtime.thingtime = newThingtime

      // check if first characters of path starts with thingtime or tt and strip from path

      // path = sanitise(path)

      console.log("nik setting newThingtime value at path", path, value)

      smarts.setsmart(newThingtime, path, value)

      // subtract last path part from dot delimitted path
      // prop1.prop2.prop3 => prop1.prop2
      const pathParts = path.split(".")
      pathParts.pop()
      const parentPath = pathParts.join(".")

      if (parentPath?.length) {
        console.log("nik updating parentPath dependancies", parentPath)
        const parent = smarts.getsmart(newThingtime, parentPath)

        const newParent = Array.isArray(parent) ? [...parent] : { ...parent }

        smarts.setsmart(newThingtime, parentPath, newParent)
      }

      set(newThingtime)
    },
    [thingtime, set]
  )

  const getThingtime = React.useCallback(
    (...args) => {
      const rawPath = args[0]
      const path = rawPath
      // do we need to sanitise?
      // const path = sanitise(rawPath)
      console.log("Getting thingtime at path", path)
      // console.trace("Getting thingtime at path", path)
      return smarts.getsmart(thingtime, path)
    },
    [thingtime]
  )

  const populatePaths = React.useCallback((obj, path, paths, seen = []) => {
    Object.keys(obj).forEach((key) => {
      const val = obj[key]
      const newPath = path ? `${path}${path ? "." : ""}${key}` : key
      if (typeof val === "object") {
        paths.push(newPath)
        if (!seen?.includes(val)) {
          seen.push(val)
          populatePaths(val, newPath, paths, seen)
        }
      } else {
        paths.push(newPath)
      }
    })
  }, [])

  const paths = React.useMemo(() => {
    // const paths = ["tt", "thingtime", "."]
    const paths = []

    // populatePaths(thingtime, commandPath)
    populatePaths(thingtime, "", paths)

    return paths
  }, [populatePaths, thingtime])

  // get thingtime from localstorage
  React.useEffect(() => {
    try {
      const thingtimeFromLocalStorage = window.localStorage.getItem("thingtime")

      if (thingtimeFromLocalStorage) {
        const parsed = parse(thingtimeFromLocalStorage)
        if (parsed) {
          const localIsValid =
            !parsed.version || parsed.version >= force.version
          let newThingtime = null
          if (localIsValid) {
            newThingtime = smarts.merge(force, parsed)
          } else {
            const withVersionUpdates = smarts.merge(newVersionData, parsed)
            newThingtime = smarts.merge(force, withVersionUpdates)
          }
          console.log("nik setting new thingtime", newThingtime)
          console.log("nik localIsValid", localIsValid)
          set(newThingtime)
        }
      }
    } catch (err) {
      console.error("There was an error getting thingtime from localStorage")
    }
  }, [])

  // thingtime change listener
  React.useEffect(() => {
    try {
      window.setThingtime = setThingtime
      window.thingtime = thingtime
      window.tt = thingtime
    } catch {
      // nothing
    }

    console.log("nik detected thingtime change", thingtime)

    if (stateRef.current.initialized) {
      if (thingtime.thingtime !== thingtime || thingtime.tt !== thingtime) {
        if (!(stateRef?.current?.c >= 10)) {
          stateRef.current.c++
          const newThingtime = {
            ...thingtime,
          }
          newThingtime.thingtime = newThingtime
          newThingtime.tt = newThingtime
          set(newThingtime)
        }
      } else {
        try {
          console.log("Setting thingtime to localStorage", thingtime)
          // setTimeout(() => {
          const stringified = stringify(thingtime)
          window.localStorage.setItem("thingtime", stringified)
          // }, 600)
        } catch (err) {
          console.error("There was an error saving thingtime to localStorage")
        }
      }
    } else {
      stateRef.current.initialized = true
    }

    thingtimeRef.current = thingtime

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
    paths,
  }

  return (
    <ThingtimeContext.Provider value={value}>
      {props?.children}
    </ThingtimeContext.Provider>
  )
}
