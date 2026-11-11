export const safe = (props) => {
  if (props?.disabled) return props?.children

  // do not render more than the limit of things to prevent infinite loops
  const meta = getMeta()

  const uuid = props?.uuid

  try {
    if (
      typeof meta?.stats?.count === "number" &&
      meta?.stats?.count >= meta?.stats?.limit
    ) {
      console.error(
        "[codex] Maximum things reached",
        meta?.stats?.count,
        meta?.stats?.limit
      )
      return null
    }
  } catch (err) {
    console.error("[codex] Error in Thingtime.tsx checking maximum things", err)
  }

  try {
    if (!meta?.stats?.db?.[uuid]) {
      meta.stats.db[uuid] = {
        count: 1,
      }
      meta.stats.count++
    }
  } catch {
    // empty
  }

  try {
    if (props?.depth >= meta?.stats?.maxDepth) {
      console.error(
        "[codex] Reached max depth",
        props?.depth,
        meta?.stats?.maxDepth
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

export const getMeta = () => {
  try {
    return window?.meta || globalThis?.meta
  } catch {
    return globalThis?.meta
  }
}
