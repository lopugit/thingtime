export const sanitise = str => {
  const isTT = str?.slice(0, 3) === 'tt.'
  const isThingtime = str?.slice(0, 10) === 'thingtime.'
  const isDot = str?.slice(0, 1) === '.'

  console.log('nik thingtime sanitis 1', str, isTT, isThingtime, isDot)

  if (isTT) {
    str = str?.slice(3)
  } else if (isThingtime) {
    str = str?.slice(9)
  } else if (isDot) {
    str = str?.slice(1)
  }

  console.log('nik thingtime sanitise 2', str, isTT, isThingtime, isDot)

  return str
}
