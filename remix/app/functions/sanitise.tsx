export const sanitise = (str) => {
  let ret = ""

  const value = str?.trim()

  const sanitised = ["tt", "thingtime"]

  const suffixes = [".", " "]

  // find combination of sanitised + suffixes which str starts with

  const match = sanitised.find((s) => value?.startsWith(s))
  const withSuffix = suffixes.find(
    (s) => match?.length && value[match?.length] === s
  )
  const noSuffix = match && value?.length === match?.length

  if (match && withSuffix) {
    ret = value?.slice(match.length + 1)
  } else if (!noSuffix) {
    ret = value
  }
  console.log("nik thingtime sanitis 1", match, withSuffix, ret)

  return ret
}
