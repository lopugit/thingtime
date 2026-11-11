export type DeclarationRecord = Record<string, string>;
type AttributeDefinition = [tags: string[], values: string[], syntax: string, boolean?: boolean];
export type ElementStandards = {
 properties: Record<string, [syntax: string, initial: string]>;
 types: Record<string, string>;
 attributes: Record<string, AttributeDefinition[]>;
};

let catalogRequest: Promise<ElementStandards> | undefined;
export function loadElementStandards(): Promise<ElementStandards> {
 catalogRequest ??= import('../../webPlatform/generated/inspector.json').then(
  ({ default: catalog }) => catalog as unknown as ElementStandards,
  error => { catalogRequest = undefined; throw error; }
 );
 return catalogRequest;
}

export function htmlAttributeDefinition(catalog: ElementStandards | undefined, tagName: string, name: string) {
 const definitions = catalog && Object.prototype.hasOwnProperty.call(catalog.attributes, name) ? catalog.attributes[name] : [];
 const context = definitions.filter(([tags]) => tags.includes('*') || tags.includes(tagName.toLowerCase()));
 if (!context.length) {
  return name.startsWith('data-') ? { values: [], syntax: 'Custom data attribute', boolean: false } : undefined;
 }
 return { values: [...new Set(context.flatMap(([, values]) => values))], syntax: context.map(([, , syntax]) => syntax).join(' / '), boolean: context.every(([, , , boolean]) => boolean) };
}

export function htmlAttributeNames(catalog: ElementStandards | undefined, tagName: string): string[] {
 if (!catalog) return [];
 return Object.keys(catalog.attributes).filter(name => htmlAttributeDefinition(catalog, tagName, name));
}

const cssWide = ['inherit', 'initial', 'unset', 'revert', 'revert-layer'];
const typeExamples: Record<string, string[]> = {
 length: ['0', '1px', '1rem', '1em', '1ch', '1lh', '1vw', '1vh', '1dvh', '1cqw'],
 percentage: ['0%', '50%', '100%'],
 number: ['0', '0.5', '1'],
 integer: ['0', '1'],
 angle: ['0deg', '90deg', '0.25turn', '1rad'],
 time: ['0s', '150ms', '1s'],
 resolution: ['1dppx', '96dpi'],
 flex: ['1fr', '2fr'],
 string: ['""'],
 color: ['transparent', 'currentColor', '#000000', 'rgb()', 'hsl()', 'oklch()', 'color-mix()'],
 'calc-sum': ['calc()', 'min()', 'max()', 'clamp()'],
};
const literals = /-?[a-z_][a-z0-9_-]*(?:\(\))?/gi;
const references = /<([^>]+)>/g;

export function cssPropertyDefinition(catalog: ElementStandards | undefined, name: string) {
 const entry = catalog && Object.prototype.hasOwnProperty.call(catalog.properties, name) ? catalog.properties[name] : undefined;
 return { syntax: entry?.[0] || '', initial: entry?.[1] || '' };
}

/** Expand grammar references into suggestible tokens; the browser owns actual parsing. */
export function cssValueOptions(catalog: ElementStandards | undefined, name: string, values?: DeclarationRecord): string[] {
 if (!name) return [];
 const { syntax } = cssPropertyDefinition(catalog, name);
 const options = new Set<string>();
 const seen = new Set<string>();
 const collect = (grammar: string) => {
  if (!grammar) return;
  const flat = grammar.replace(references, (_, body: string) => {
   const token = body.trim().split(/\s+/)[0];
   if (seen.has(token)) return ' ';
   seen.add(token);
   if (token.endsWith('()')) {
    options.add(token);
    return ' ';
   }
   if (Object.prototype.hasOwnProperty.call(typeExamples, token)) for (const example of typeExamples[token]) options.add(example);
   if (catalog && Object.prototype.hasOwnProperty.call(catalog.types, token)) collect(catalog.types[token]);
   const property = token.match(/^'([^']+)'$/)?.[1];
   if (property) collect(cssPropertyDefinition(catalog, property).syntax);
   return ' ';
  });
  // Named functions inside the grammar are inserted with an empty argument list.
  const withoutFunctions = flat.replace(/(-?[a-z_][a-z0-9_-]*)\(/gi, (_, fn: string) => { options.add(`${fn}()`); return ' '; });
  for (const token of withoutFunctions.match(literals) || []) options.add(token);
 };
 collect(syntax);
 for (const key of Object.keys(values || {})) if (key.startsWith('--')) options.add(`var(${key})`);
 for (const global of cssWide) options.add(global);
 options.add('var()');
 return [...options];
}

export const isHtmlAttributeName = (name: string): boolean => /^[a-z][a-z0-9_.:-]*$/.test(name) && !/^on/.test(name);
