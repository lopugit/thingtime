export const stringLiteralToRichText = (str: string): string => {
  // for now we just want to basically run strip on every line so that there are no leading spaces
  return str
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .join('\n');

  // Convert a string literal to a rich text format
  // This is a placeholder implementation; you can customize it as needed
  return str
    .replace(/(\*\*|__)(.*?)\1/g, '<strong>$2</strong>') // Bold
    .replace(/(\*|_)(.*?)\1/g, '<em>$2</em>') // Italic
    .replace(/~~(.*?)~~/g, '<del>$1</del>'); // Strikethrough
};

export const safeJoin = (stringOrArray: string | Array<any>, join: string = '.') => {
	if (Array.isArray(stringOrArray)) {
		return stringOrArray.join(join);
	} else {
		return stringOrArray;
	}
};

export const safeSplit = (stringOrArray: string | Array<any>, split: string = '.') => {
	if (typeof stringOrArray === 'string') {
		return stringOrArray.split(split);
	} else {
		return stringOrArray;
	}
};