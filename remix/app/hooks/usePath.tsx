import React from "react"
import { useLocation } from "@remix-run/react"
import { useNavigate } from "@remix-run/react"
export const usePath = (props?: any) => {
  const location = useLocation()
  const { pathname } = location

  const navigate = useNavigate()

  const [mode, setMode] = React.useState("")

  const modes = React.useMemo(() => {
    // make sure any substrings come first
    return [
      "edit",
      "editor",
      "code",
      "coder",
      "thing",
      "things",
      "thingtime",
      "thingtimes",
    ]
  }, [])

  React.useEffect(() => {
    let set = false
    modes.forEach((mode) => {
      const pathPart = pathname.slice(1, mode.length + 1)
      if (pathPart === mode) {
        setMode(mode)
        set = true
      }
    })
    if (!set) {
      setMode((mode) => {
        if (!mode) {
          return "things"
        }
      })
    }
  }, [pathname, modes])

  const changePath = React.useCallback(
    (props) => {
      const { path } = props

      navigate(`${mode}/${path}`)
    },
    [navigate, mode]
  )

  const ret = {
    mode,
    changePath,
  }

  return ret
}
