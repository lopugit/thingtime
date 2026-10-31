/** Password bytes never leave this module except as the caller's transient result. */
export type PasswordPreset = 'strong' | 'custom' | 'apple' | 'github' | 'google' | 'microsoft';
export type GeneratorSettings = {
  preset: PasswordPreset; length: number; uppercase: boolean; lowercase: boolean; digits: boolean;
  symbols: boolean; allowedSymbols: string; excludeAmbiguous: boolean; excludedCharacters: string;
};
export const DEFAULT_GENERATOR_SETTINGS: GeneratorSettings = {
  preset: 'strong', length: 20, uppercase: true, lowercase: true, digits: true,
  symbols: true, allowedSymbols: '!@#$%^&*()-_=+[]{}:,.?', excludeAmbiguous: false, excludedCharacters: ''
};
export const PASSWORD_PRESETS = {
  strong: { label: 'Strong', guidance: '20 characters recommended; adjust every setting.', sources: [] },
  custom: { label: 'Custom', guidance: 'Use the rules required by the destination.', sources: [] },
  apple: { label: 'Apple Account', guidance: 'At least 8 characters, upper and lowercase letters, a number, and no three identical consecutive characters. Other account-specific restrictions may apply.', sources: ['https://support.apple.com/en-ie/102614', 'https://support.apple.com/en-ca/guide/security/secbd5822138/web'] },
  github: { label: 'GitHub', guidance: 'At least 15 characters, or at least 8 with a lowercase letter and number. GitHub also rejects compromised passwords.', sources: ['https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-strong-password'] },
  google: { label: 'Google', guidance: 'ASCII characters without surrounding spaces. Google recommends at least 12 characters; this recommendation is not enforced as a minimum here.', sources: ['https://support.google.com/accounts/answer/32040'] },
  microsoft: { label: 'Microsoft (recommended)', guidance: 'Strong recommended settings. Consumer account password constraints have not been independently verified; this is not a statement of Microsoft requirements.', sources: [] }
} as const;
export function settingsForPreset(preset: PasswordPreset): GeneratorSettings { return { ...DEFAULT_GENERATOR_SETTINGS, preset }; }
const CLASSES = { uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', lowercase: 'abcdefghijklmnopqrstuvwxyz', digits: '0123456789' };
const AMBIGUOUS = 'Il1O0o|';
export function generatorAlphabet(settings: GeneratorSettings): string[][] {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
    !['uppercase', 'lowercase', 'digits', 'symbols', 'excludeAmbiguous'].every(key => typeof settings[key as keyof GeneratorSettings] === 'boolean') ||
    typeof settings.allowedSymbols !== 'string' || typeof settings.excludedCharacters !== 'string' ||
    typeof settings.preset !== 'string' || !Object.prototype.hasOwnProperty.call(PASSWORD_PRESETS, settings.preset)) throw new Error('Password generator settings are invalid.');
  if (!Number.isSafeInteger(settings.length) || settings.length < 1) throw new Error('Length must be a positive safe integer.');
  if (settings.length > 0xffffffff) throw new Error('JavaScript arrays support at most 4,294,967,295 characters. Choose a smaller length.');
  const excluded = new Set(Array.from(settings.excludedCharacters + (settings.excludeAmbiguous ? AMBIGUOUS : '')));
  const groups = (Object.keys(CLASSES) as Array<keyof typeof CLASSES>).filter(key => settings[key]).map(key => Array.from(CLASSES[key]));
  if (settings.symbols) groups.push(Array.from(new Set(Array.from(settings.allowedSymbols))).filter(char => !/[A-Za-z0-9]/.test(char)));
  const filtered = groups.map(group => group.filter(char => !excluded.has(char) && !/[\p{C}]/u.test(char)));
  if (!filtered.length) throw new Error('Enable at least one character class.');
  if (filtered.some(group => !group.length)) throw new Error('An enabled character class is empty after exclusions.');
  if (settings.length < filtered.length) throw new Error('Length must accommodate every enabled character class.');
  const alphabet = filtered.flat();
  if (settings.preset === 'apple') {
    if (settings.length < 8 || !settings.uppercase || !settings.lowercase || !settings.digits) throw new Error('Apple requires 8 or more characters with upper and lowercase letters and a number.');
  }
  if (settings.preset === 'github' && !(settings.length >= 15 || (settings.length >= 8 && settings.lowercase && settings.digits))) throw new Error('GitHub requires 15 characters, or 8 with lowercase letters and a number.');
  if (settings.preset === 'google') {
    if (alphabet.some(char => !/^[\x20-\x7e]$/.test(char))) throw new Error('The Google preset requires printable ASCII characters.');
    if (alphabet.every(char => char === ' ') || (filtered.some(group => group.every(char => char === ' ')) && settings.length < 3)) throw new Error('These settings cannot avoid surrounding spaces.');
  }
  if (!Object.prototype.hasOwnProperty.call(PASSWORD_PRESETS, settings.preset)) throw new Error('Choose a supported preset.');
  return filtered;
}
export type GeneratorOptions = { signal?: AbortSignal; crypto?: Pick<Crypto, 'getRandomValues'>; yieldControl?: () => Promise<void> };
/** Rejection sampling avoids modulo bias. Each WebCrypto call is below its 65,536-byte limit.
 * Required classes plus a Fisher-Yates shuffle avoid predictable class positions. No claim
 * of a uniform distribution over all constraint-satisfying passwords is made. */
export async function generatePassword(settings: GeneratorSettings, options: GeneratorOptions = {}): Promise<string> {
  const groups = generatorAlphabet(settings), alphabet = groups.flat();
  const source = options.crypto ?? globalThis.crypto;
  if (!source?.getRandomValues) throw new Error('Secure random generation is unavailable.');
  const random = new Uint32Array(4096); let cursor = random.length;
  const index = (size: number): number => {
    const limit = 0x100000000 - (0x100000000 % size);
    for (;;) {
      options.signal?.throwIfAborted();
      if (cursor === random.length) { source.getRandomValues(random); cursor = 0; }
      const sample = random[cursor++]; if (sample < limit) return sample % size;
    }
  };
  const yieldControl = options.yieldControl ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0)));
  const checkpoint = async (i: number) => { if (i % 4096 === 0) { options.signal?.throwIfAborted(); await yieldControl(); options.signal?.throwIfAborted(); } };
  const chars: string[] = [];
  try {
    for (const group of groups) chars.push(group[index(group.length)]);
    for (let i = chars.length; i < settings.length; i++) { await checkpoint(i); chars.push(alphabet[index(alphabet.length)]); }
    for (let i = chars.length - 1; i > 0; i--) { await checkpoint(i); const j = index(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
    if (settings.preset === 'apple') for (let i = 2; i < chars.length; i++) {
      await checkpoint(i);
      if (chars[i] !== chars[i - 1] || chars[i] !== chars[i - 2]) continue;
      // Removing one of a triple cannot remove the last member of its class.
      const forbidden = new Set([chars[i], ...(chars[i + 1] === chars[i + 2] ? [chars[i + 1]] : [])]);
      const candidates = alphabet.filter(char => !forbidden.has(char));
      if (!candidates.length) throw new Error('These settings cannot avoid three identical consecutive characters.');
      chars[i] = candidates[index(candidates.length)];
    }
    if (settings.preset === 'google') {
      const requiresSpace = groups.some(group => group.every(char => char === ' '));
      if (requiresSpace && !chars.slice(1, -1).includes(' ')) {
        const edge = chars[0] === ' ' ? 0 : chars.length - 1;
        [chars[1], chars[edge]] = [chars[edge], chars[1]];
      }
      const nonspace = alphabet.filter(char => char !== ' ');
      for (const edge of [0, chars.length - 1]) if (chars[edge] === ' ') chars[edge] = nonspace[index(nonspace.length)];
    }
    options.signal?.throwIfAborted(); return chars.join('');
  } catch (cause) {
    if (cause instanceof RangeError) throw new Error('This device does not have enough memory for the requested length. Choose a smaller length.');
    throw cause;
  } finally { random.fill(0); chars.fill(''); }
}
