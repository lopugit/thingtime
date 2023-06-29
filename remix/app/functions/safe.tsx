export const safe = response => {
  // do not render more than the limit of things to prevent infinite loops
  try {
    if (
      typeof window?.thingtime?.things?.count === 'number' &&
      window?.thingtime?.things?.count > window?.thingtime?.things?.limit
    ) {
      console.error('Maximum things reached')
      return null
    }
  } catch (err) {
    // console.error('Error in Thingtime.tsx checking maximum things', err)
  }

  return response
}
