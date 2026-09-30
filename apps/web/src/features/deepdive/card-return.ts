export function restoreCardReaderSearch(search: string, cardId: string): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  params.set('card', cardId);
  return params.toString();
}
