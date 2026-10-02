import { describe, expect, it } from 'vitest';
import { conciseResearchTitle } from './conciseResearchTitle';

describe('concise retained research title', () => {
  it.each(['Repair ecosystem', '', '  Original title  ', 'x'.repeat(80)])(
    'preserves short original names exactly: %j',
    (name) => {
      expect(conciseResearchTitle(name)).toBe(name);
    },
  );

  it('uses an original word-boundary prefix, bounded to 80 characters including the ellipsis', () => {
    const original =
      'Find repair software providers serving independent maintenance teams across Europe and compare their retained products and distribution channels.';
    expect(conciseResearchTitle(original)).toBe(
      'Find repair software providers serving independent maintenance teams across…',
    );
    expect(conciseResearchTitle(original).length).toBeLessThanOrEqual(80);
    expect(original.startsWith(conciseResearchTitle(original).slice(0, -1))).toBe(true);
  });

  it('handles newline boundaries and long unbroken names without inventing a title', () => {
    expect(conciseResearchTitle('x'.repeat(75) + '\nNext research question')).toBe(
      'x'.repeat(75) + '…',
    );
    expect(conciseResearchTitle('x'.repeat(100))).toBe('x'.repeat(79) + '…');
  });

  it('does not cut a Unicode character in half', () => {
    expect(conciseResearchTitle('🚀'.repeat(90))).toBe('🚀'.repeat(79) + '…');
  });
});
