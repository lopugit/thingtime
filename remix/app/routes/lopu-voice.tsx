// Keep the exact same route component identity as /lopu/:chatId. A wrapper
// remounts the entire composer when switching modes, losing unsent text and
// attachment state. LopuPage derives the mode from the current URL.
export { default } from './lopu';
