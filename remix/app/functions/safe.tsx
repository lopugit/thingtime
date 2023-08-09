export const safe = (props) => {
  // do not render more than the limit of things to prevent infinite loops
  const thingtime = getThingtime()

  const uuid = props?.uuid

  try {
    if (
      typeof thingtime?.things?.count === "number" &&
      thingtime?.things?.count >= thingtime?.things?.limit
    ) {
      console.error(
        "[codex] Maximum things reached",
        thingtime?.things?.count,
        thingtime?.things?.limit
      )
      return null
    }
  } catch (err) {
    console.error("[codex] Error in Thingtime.tsx checking maximum things", err)
  }

  try {
    if (!thingtime?.things?.db?.[uuid]) {
      thingtime.things.db[uuid] = {
        count: 1,
      }
      thingtime.things.count++
    }
  } catch {
    // empty
  }

  try {
    if (props?.depth >= thingtime?.things?.maxDepth) {
      console.error(
        "[codex] Reached max depth",
        props?.depth,
        thingtime?.things?.maxDepth
      )
      return null
    }
  } catch {
    // nothing
  }

  try {
    return props?.children
  } catch (err) {
    console.error("Caught error returning children safely", err)
  }
}

export const getThingtime = () => {
  try {
    return window?.meta || globalThis?.meta
  } catch {
    return globalThis?.meta
  }
}
