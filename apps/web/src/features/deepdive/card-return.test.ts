import { describe, expect, it } from 'vitest';
import { restoreCardReaderSearch } from './card-return';

describe('restoreCardReaderSearch', () => {
  it('reopens the selected card without dropping the deck view filters', () => {
    const search = restoreCardReaderSearch('?type=insight&split=stage', 'insight_1');
    const params = new URLSearchParams(search);

    expect(params.get('card')).toBe('insight_1');
    expect(params.get('type')).toBe('insight');
    expect(params.get('split')).toBe('stage');
  });
});
