import { describe, expect, it } from 'vitest';
import { normalizeReportMarkdown } from './report';

describe('normalizeReportMarkdown', () => {
  it('removes forbidden diagram blocks and uses evidence-accurate labels', () => {
    const report = normalizeReportMarkdown(`## Summary

Before.

\`\`\`
|______ ASCII DIAGRAM ______|
\`\`\`

A Verified figure, another verified figure, and a User-verified override.
An unverified claim remains unverified.`);

    expect(report).not.toMatch(/```|ASCII DIAGRAM/);
    expect(report).toContain('A Sourced figure, another sourced figure');
    expect(report).toContain('User-confirmed override');
    expect(report).toContain('unverified claim remains unverified');
  });
});
