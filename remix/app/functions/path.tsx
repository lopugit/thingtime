export const sanitise = str => {
  const isTT = str?.slice(0, 3) === 'tt.'
  const isThingtime = str?.slice(0, 9) === 'thingtime.'
  const isDot = str?.slice(0, 1) === '.'

  if (isTT) {
    str = str?.slice(3)
  }
  if (isThingtime) {
    str = str?.slice(9)
  }

  if (isDot) {
    str = str?.slice(1)
  }

  return str
}
