import { describe, expect, it } from 'vitest';
import { tidyOpportunityProse } from './opportunityProse';

describe('tidyOpportunityProse', () => {
  it('shows long dollar figures and counts in compact tiers', () => {
    expect(tidyOpportunityProse('1,000,000,000 users and $25,000,000,000 ARR, $1,100,000,000+ target')).toBe(
      '1.0B users and $25.0B ARR, $1.1B+ target',
    );
  });
  it('leaves figures under a million exactly as written', () => {
    expect(tidyOpportunityProse('450,000 users, 2,300 employees, $900,000')).toBe('450,000 users, 2,300 employees, $900,000');
  });
  it('drops tier labels that are not source numbers', () => {
    expect(tidyOpportunityProse('leading ChatGPT [T8]. Next [T5], then [T?]')).toBe('leading ChatGPT. Next, then');
  });
});
