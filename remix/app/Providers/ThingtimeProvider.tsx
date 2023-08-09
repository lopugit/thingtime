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

// const initialThingtime = createInitialThingtime()
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

// initialise thingtime
initialThingtime.thingtime = initialThingtime
initialThingtime.tt = initialThingtime

export const ThingtimeProvider = (props: any): JSX.Element => {
  const [thingtime, rawSet] = React.useState()

  const thingtimeRef = React.useRef(thingtime)
  const stateRef = React.useRef({
    c: 1,
  })

  const [loading, setLoading] = React.useState(true)

  const set = React.useCallback((newThingtime) => {
    const thingtimeReference = {
      ...newThingtime,
    }

    thingtimeReference.tt = thingtimeReference
    thingtimeReference.thingtime = thingtimeReference
    rawSet(thingtimeReference)
  }, [])

  const setThingtime = React.useCallback(
    (path, value) => {
      const newThingtime = thingtime

      const paths = smarts.parsePropertyPath(path)

      // find first parent where a path is undefined
      // paths is array of path parts such as ["path1", "path2", "path3"]
      // we want to create a new reference at the first object which has an undefined part of the path
      // and is an object itself
      // so that react will detect the change and re-render
      // "path1" = { ...thingtime["path1"] } if path1.path2 undefined
      // "path1.path2" = { ...thingtime["path1"]["path2"] } if path1.path2.path3 undefined
      // "path1.path2.path3" = { ...thingtime["path1"]["path2"]["path3"] }
      // etc
      let done = false
      paths.forEach((pathPart, index) => {
        if (!done) {
          const pathParts = paths.slice(0, index + 1)
          const tmpPath = pathParts.join(".")
          const parentPath = pathParts.slice(0, -1).join(".")

          const valAtPath = smarts.getsmart(newThingtime, tmpPath)

          if (parentPath) {
            if (typeof valAtPath !== "object" || valAtPath === null) {
              const parentVal = smarts.getsmart(newThingtime, parentPath)
              if (typeof parentVal === "object") {
                const newParent = Array.isArray(parentVal)
                  ? [...parentVal]
                  : { ...parentVal }
                smarts.setsmart(newThingtime, parentPath, newParent)
              }
              done = true
            }
          }
        }
      })

      newThingtime.thingtime = newThingtime
      newThingtime.tt = newThingtime

      console.log(
        "nik setting newThingtime value at path",
        '"' + path + '"',
        "value: ",
        value
      )

      smarts.setsmart(newThingtime, path, value)

      set(newThingtime)
    },
    [thingtime, set]
  )

  const getThingtime = React.useCallback(
    (...args) => {
      const rawPath = args[0]
      const path = rawPath

      if (!path) {
        return thingtime
      }

      // do we need to sanitise?
      // const path = sanitise(rawPath)
      console.log("Getting thingtime at path", path)
      // console.trace("Getting thingtime at path", path)
      return smarts.getsmart(thingtime, path)
    },
    [thingtime]
  )

  const populatePaths = React.useCallback((obj, path, paths, seen = []) => {
    try {
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
    } catch {
      // nothing
    }
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
          console.log(
            "nik setting new thingtime from localStorage",
            newThingtime
          )
          set(newThingtime)
        }
      } else {
        set(initialThingtime)
      }
    } catch (err) {
      console.error("There was an error getting thingtime from localStorage")
    }
    setLoading(false)
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
  }, [setThingtime, thingtime, set])

  const value = {
    thingtime,
    setThingtime,
    getThingtime,
    thingtimeRef,
    paths,
    loading,
  }

  return (
    <ThingtimeContext.Provider value={value}>
      {props?.children}
    </ThingtimeContext.Provider>
  )
}
