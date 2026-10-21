import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The app prints what the beta covers (COVERED_USAGE_USD) and the Worker enforces it (LIFETIME_VISITOR_BUDGET_USD). Nothing
 * else ties the two together, so a change to one that forgets the other would promise people a number the Worker does not
 * hold to. This fails until both say the same thing.
 */
describe('the covered usage the app promises is what the Worker enforces', () => {
  it('has the same dollar figure in apps/web beta.ts and in wrangler.toml', () => {
    const app = readFileSync(new URL('../../../apps/web/src/lib/beta.ts', import.meta.url), 'utf8');
    const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    const promised = /export const COVERED_USAGE_USD = ([0-9.]+);/.exec(app)?.[1];
    const enforced = /^LIFETIME_VISITOR_BUDGET_USD = "([0-9.]+)"$/m.exec(toml)?.[1];
    expect(promised).toBeDefined();
    expect(enforced).toBeDefined();
    expect(Number(promised)).toBe(Number(enforced));
  });
});
