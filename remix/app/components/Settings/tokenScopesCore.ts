export const mintSelectedPatScopes = (selected: string[]): string[] =>
  selected.includes('things')
    ? ['things', ...selected.filter((scope) => scope !== 'things' && !scope.startsWith('things.'))]
    : selected;
