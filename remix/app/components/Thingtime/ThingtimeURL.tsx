import React from "react"
import { Flex } from "@chakra-ui/react"
import { useLocation, useMatches } from "@remix-run/react"

import { Thingtime } from "./Thingtime"
import { useThingtime } from "./useThingtime"

export const ThingtimeURL = (props) => {
  const { getThingtime } = useThingtime()

  const { pathname } = useLocation()

  const matches = useMatches()
  const location = React.useMemo(() => {
    return matches[matches.length - 1]
  }, [matches])

  const path = React.useMemo(() => {
    console.log("ThingtimeURL location", location)

    // const sanitisation = ["/things", "/edit", "/editor", "/code", "/coder"]

    // // strip the leading /path1/path2 path1 section from the path
    // let pathPartOne = location?.pathname?.split("/")[2]

    // // remove all sanitsation strings from path
    // sanitisation.forEach((sanitisationString) => {
    //   pathPartOne = pathPartOne?.replace(sanitisationString, "")
    // })

    // strip the leading /path1/path2 path1 section from the path
    const pathPartOne = location?.pathname?.split("/")[2]

    const path = pathPartOne?.replace(/\//g, ".")

    return path || "thingtime"
  }, [location])

  const thing = React.useMemo(() => {
    // remove /things/ from path

    const ret = getThingtime(path)

    return ret
  }, [path, getThingtime])

  const inEditorMode = React.useMemo(() => {
    if (pathname.slice(0, 7) === "/editor") {
      return true
    }
    return false
  }, [pathname])

  const inEditMode = React.useMemo(() => {
    if (pathname.slice(0, 5) === "/edit") {
      return true
    }
    return false
  }, [pathname])

  return (
    <Flex
      alignItems={inEditorMode ? "flex-start" : "center"}
      justifyContent="center"
      flexDirection={inEditorMode ? "row" : "column"}
      maxWidth="100%"
    >
      {inEditorMode && (
        <Thingtime
          path={path}
          thing={thing}
          render
          chakra
          chakras={{ marginY: 200 }}
          width="600px"
        ></Thingtime>
      )}
      <Thingtime
        edit={inEditMode}
        path={path}
        thing={thing}
        chakras={{ marginY: 200 }}
        width="600px"
      ></Thingtime>
    </Flex>
  )
}
