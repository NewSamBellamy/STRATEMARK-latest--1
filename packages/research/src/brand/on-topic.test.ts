import { describe, expect, it } from 'vitest';
import { homepageOnTopic, marketTerms } from './domain';

describe('namesake homepage check', () => {
  it('keeps only the deck\'s subject words, singularised', () => {
    expect(marketTerms('Commercial Drone Market')).toEqual(['drone']);
    expect(marketTerms('Payments Infrastructure')).toEqual(['payment', 'infrastructure']);
    expect(marketTerms('Battery Technologies')).toEqual(['battery', 'technology']);
    expect(marketTerms('')).toEqual([]);
  });

  it('flags a namesake page that never mentions the subject, and passes the real company', () => {
    const terms = marketTerms('Commercial Drone Market');
    expect(homepageOnTopic('<title>Flyability</title><p>Making hang gliding accessible to disabled people.</p>', terms)).toBe(false);
    expect(homepageOnTopic('<title>Flyability</title><p>Collision-tolerant drones for confined spaces.</p>', terms)).toBe(true);
    expect(homepageOnTopic('<script>var drone = 1</script><p>Paragliding club</p>', terms)).toBe(false);
  });

  it('never blocks when the market names no subject word', () => {
    expect(homepageOnTopic('<p>Anything</p>', marketTerms('Global Enterprise Software Market'))).toBe(true);
  });
});
