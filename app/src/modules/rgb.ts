import hexRgb from 'hex-rgb'

export default (hex: string, alpha: number) => {
  const rgb = hexRgb(hex)
  return `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, ${typeof alpha === 'number' ? alpha : rgb.alpha})`
}