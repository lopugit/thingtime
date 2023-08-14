import React, { createContext } from "react"
import flatted, { parse, stringify } from "flatted"

import { sanitise } from "~/functions/sanitise"
import { smarts } from "~/smarts"

export interface ThingtimeContextInterface {
  thingtime: any
  setThingtime: any
  getThingtime: any
  thingtimeRef: any
  loading: boolean
}

export const ThingtimeContext = createContext<ThingtimeContextInterface | null>(
  null
)

try {
  window.smarts = smarts
  window.flatted = {
    parse,
    stringify,
  }
} catch (err) {
  // nothing
}

const force = {
  settings: {
    undoLimit: 999,
    // commander: {
    //   nav: {
    //     commanderActive: false,
    //     clearCommanderOnToggle: true,
    //     clearCommanderContextOnToggle: true,
    //     hideSuggestionsOnToggle: true,
    // },
    // },
  },
  //   Content: {
  //     hidden1: "Edit this to your heart's desire.",
  //     "How?": "Just search for Content and edit the value to whatever you want.",
  //     "Example:": `Content = New Content!
  // Content.Nested Content = New Nested Content!
  //     `,
  //   },
  version: 24,
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
    commander: {
      nav: {
        commanderActive: false,
        clearCommanderOnToggle: true,
        clearCommanderContextOnToggle: true,
        hideSuggestionsOnToggle: true,
      },
    },
  },
  Content: {
    hidden1: "Edit this to your heart's desire.",
    "How?": "Just search for Content and edit the value to whatever you want.",
    "Example:": `
Content = New Content!
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
  const [thingtimeReference, rawSet] = React.useState()

  const thingtimeRef = React.useRef(thingtimeReference)
  const stateRef = React.useRef({
    c: 1,
  })

  const [loading, setLoading] = React.useState(true)

  const set = React.useCallback((newThingtime, ignoreUndoRedo?: any) => {
    const newThingtimeReference = {
      ...newThingtime,
    }

    newThingtimeReference.tt = newThingtimeReference
    newThingtimeReference.thingtime = newThingtimeReference

    // store undo/redo history
    if (!ignoreUndoRedo) {
      try {
        console.log(
          "ThingtimeProvider setting thingtime to localStorage",
          newThingtimeReference
        )
        // setTimeout(() => {
        const stringified = stringify(newThingtimeReference)
        let undoHistory = []
        try {
          const undoHistoryString = window.localStorage.getItem("undoHistory")
          const parsedUndoHistory = JSON.parse(undoHistoryString)
          if (parsedUndoHistory instanceof Array) {
            undoHistory = parsedUndoHistory
          }
        } catch {
          // nothing
        }
        // if last undoHistory does not equal new undo history
        console.log(
          "ThingtimeProvider saving to undo history undoHistory[undoHistory.length - 1]?.value",
          undoHistory[undoHistory.length - 1]?.value
        )
        console.log(
          "ThingtimeProvider saving to undo history stringified",
          stringified
        )
        if (undoHistory[undoHistory.length - 1]?.value !== stringified) {
          try {
            console.log(
              "ThingtimeProvider saving to undo history undoHistory",
              undoHistory
            )
            const limit = newThingtimeReference?.settings?.undoLimit || 999

            if (undoHistory?.length > limit) {
              undoHistory = undoHistory.slice(undoHistory.length - limit)
            }

            undoHistory.push({
              timestamp: Date.now(),
              value: stringify(newThingtimeReference),
            })
            const undoHistoryNewString = JSON.stringify(undoHistory)
            window.localStorage.setItem("undoHistory", undoHistoryNewString)
          } catch {
            // nothing
          }
        }
        // window.localStorage.setItem("thingtime", stringified)
        // }, 600)
      } catch (err) {
        console.error("There was an error saving thingtime to localStorage")
      }
      const saveRedo = false
      if (saveRedo) {
        try {
          console.log(
            "ThingtimeProvider setting thingtime to localStorage",
            newThingtimeReference
          )
          // setTimeout(() => {
          const stringified = stringify(newThingtimeReference)
          let redoHistory = []
          try {
            const redoHistoryString = window.localStorage.getItem("redoHistory")
            const parsedRedoHistory = JSON.parse(redoHistoryString)
            if (parsedRedoHistory instanceof Array) {
              redoHistory = parsedRedoHistory
            }
          } catch {
            // nothing
          }
          // if last redoHistory does not equal new redo history
          console.log(
            "ThingtimeProvider saving to redo history redoHistory[redoHistory.length - 1]?.value",
            redoHistory[redoHistory.length - 1]?.value
          )
          console.log(
            "ThingtimeProvider saving to redo history stringified",
            stringified
          )
          if (redoHistory[redoHistory.length - 1]?.value !== stringified) {
            try {
              console.log(
                "ThingtimeProvider saving to redo history redoHistory",
                redoHistory
              )
              const limit = newThingtimeReference?.settings?.redoLimit || 999

              if (redoHistory?.length > limit) {
                redoHistory = redoHistory.slice(redoHistory.length - limit)
              }

              redoHistory.push({
                timestamp: Date.now(),
                value: stringify(newThingtimeReference),
              })
              const redoHistoryNewString = JSON.stringify(redoHistory)
              window.localStorage.setItem("redoHistory", redoHistoryNewString)
            } catch {
              // nothing
            }
          }
          // window.localStorage.setItem("thingtime", stringified)
          // }, 600)
        } catch (err) {
          console.error("There was an error saving thingtime to localStorage")
        }
      }
    }

    rawSet(newThingtimeReference)
  }, [])

  const setThingtime = React.useCallback(
    (path, value) => {
      // TODO: make this a lot safer
      if (["thingtime", "tt"]?.includes(path)) {
        if (value) {
          set(value)
          return
        }
      }

      const newThingtime = thingtimeReference

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

      // TODO: make thingtime settable
      newThingtime.thingtime = newThingtime
      newThingtime.tt = newThingtime

      console.log(
        "ThingtimeProvider setting newThingtime value at path",
        '"' + path + '"',
        "value: ",
        value
      )

      smarts.setsmart(newThingtime, path, value)

      set(newThingtime)
    },
    [thingtimeReference, set]
  )

  const getThingtime = React.useCallback(
    (...args) => {
      const rawPath = args[0]
      const path = rawPath

      if (!path) {
        return thingtimeReference
      }

      // do we need to sanitise?
      // const path = sanitise(rawPath)
      console.log("ThingtimeProvider getting thingtime at path", path)
      // console.trace("Getting thingtime at path", path)
      return smarts.getsmart(thingtimeReference, path)
    },
    [thingtimeReference]
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
    populatePaths(thingtimeReference, "", paths)

    return paths
  }, [populatePaths, thingtimeReference])

  // get thingtime from localstorage
  React.useEffect(() => {
    try {
      const thingtimeFromLocalStorage = window.localStorage.getItem("thingtime")

      if (thingtimeFromLocalStorage) {
        const parsed = parse(thingtimeFromLocalStorage)
        console.log(
          "ThingtimeProvider thingtime restored from localstorage",
          parsed
        )
        if (parsed) {
          const localIsValid =
            !parsed.version || parsed.version >= force.version
          let newThingtime = smarts.merge(force, initialThingtime)
          if (localIsValid) {
            newThingtime = smarts.merge(parsed, newThingtime)
          } else {
            const withVersionUpdates = smarts.merge(newVersionData, parsed)
            newThingtime = smarts.merge(force, withVersionUpdates)
          }
          console.log(
            "ThingtimeProvider restoring thingtime from localStorage",
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
      window.thingtime = thingtimeReference
      window.tt = thingtimeReference
    } catch {
      // nothing
    }

    if (stateRef.current.initialized) {
      try {
        console.log(
          "ThingtimeProvider setting thingtime to localStorage",
          thingtimeReference
        )
        // setTimeout(() => {
        const stringified = stringify(thingtimeReference)
        window.localStorage.setItem("thingtime", stringified)
        // }, 600)
      } catch (err) {
        console.error("There was an error saving thingtime to localStorage")
      }
    } else {
      stateRef.current.initialized = true
    }

    thingtimeRef.current = thingtimeReference

    const keyListener = (e) => {
      // if ctrl + z, restore thingtime from localstorage history

      console.log("ThingtimeProvider listened to key event e?.key", e?.key)
      console.log(
        "ThingtimeProvider listened to key event e?.ctrlKey",
        e?.ctrlKey
      )
      console.log(
        "ThingtimeProvider listened to key event e?.shiftKey",
        e?.shiftKey
      )
      console.log(
        "ThingtimeProvider listened to key event e?.metaKey",
        e?.metaKey
      )

      if ((e?.ctrlKey || e?.metaKey) && e?.key === "z") {
        e?.preventDefault()

        console.log("ThingtimeProvider detected undo/redo request")

        if (e.shiftKey) {
          // redo
          console.log("ThingtimeProvider redo")
          const redoHistoryString = window.localStorage.getItem("redoHistory")
          const parsedRedoHistory = JSON.parse(redoHistoryString)
          if (parsedRedoHistory instanceof Array) {
            const last = parsedRedoHistory[parsedRedoHistory.length - 1]
            if (last) {
              const parsed = parse(last.value)
              if (parsed) {
                // remove restored state from history
                // const currentHistory = parsedRedoHistory.pop()
                parsedRedoHistory.pop()
                // parsedRedoHistory.push(currentHistory)
                const newRedoHistoryString = JSON.stringify(parsedRedoHistory)
                window.localStorage.setItem("redoHistory", newRedoHistoryString)

                // save old/current state to undo history
                let undoHistory = []
                try {
                  const undoHistoryString =
                    window.localStorage.getItem("undoHistory")
                  const parsedUndoHistory = JSON.parse(undoHistoryString)
                  if (parsedUndoHistory instanceof Array) {
                    undoHistory = parsedUndoHistory
                  }
                } catch {
                  // nothing
                }
                try {
                  undoHistory.push({
                    timestamp: Date.now(),
                    value: stringify(thingtimeReference),
                  })
                  const undoHistoryNewString = JSON.stringify(undoHistory)
                  window.localStorage.setItem(
                    "undoHistory",
                    undoHistoryNewString
                  )
                } catch {
                  // nothing
                }

                const newThingtime = parsed
                set(newThingtime, true)
              }
            }
          }
        } else {
          // undo
          console.log("ThingtimeProvider undo")
          try {
            const undoHistoryString = window.localStorage.getItem("undoHistory")
            const parsedUndoHistory = JSON.parse(undoHistoryString)
            if (parsedUndoHistory instanceof Array) {
              const last = parsedUndoHistory[parsedUndoHistory.length - 2]
              if (last) {
                const parsed = parse(last.value)
                if (parsed) {
                  // remove restored state from history

                  const currentHistory = parsedUndoHistory.pop()
                  parsedUndoHistory.pop()
                  parsedUndoHistory.push(currentHistory)

                  const newUndoHistoryString = JSON.stringify(parsedUndoHistory)
                  window.localStorage.setItem(
                    "undoHistory",
                    newUndoHistoryString
                  )

                  // save old/current state to redo history
                  let redoHistory = []
                  try {
                    const redoHistoryString =
                      window.localStorage.getItem("redoHistory")
                    const parsedRedoHistory = JSON.parse(redoHistoryString)
                    if (parsedRedoHistory instanceof Array) {
                      redoHistory = parsedRedoHistory
                    }
                  } catch {
                    // nothing
                  }
                  try {
                    const newValue = stringify(thingtimeReference)
                    // if last history is not the same as new history
                    redoHistory.push({
                      timestamp: Date.now(),
                      value: newValue,
                    })
                    const redoHistoryNewString = JSON.stringify(redoHistory)
                    window.localStorage.setItem(
                      "redoHistory",
                      redoHistoryNewString
                    )
                  } catch {
                    // nothing
                  }

                  const newThingtime = parsed
                  set(newThingtime, true)
                }
              }
            }
          } catch {
            // nothing
          }
        }
      }
    }

    window.addEventListener("keydown", keyListener)

    return () => {
      window.removeEventListener("keydown", keyListener)
    }
  }, [setThingtime, thingtimeReference, set])

  const value = {
    thingtime: thingtimeReference,
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
