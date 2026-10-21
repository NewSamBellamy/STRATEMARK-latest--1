import { formatCount, formatUsd } from '@/lib/format';

/**
 * Display-only tidy-up of the whitespace thesis the model wrote.
 *
 * - `[T8]` is not a source number: the prompt labels each company line with its card tier (`[T<tier>] Name: ...`),
 *   and the model echoed those labels. Nothing maps them to a source, so linking them would invent a citation;
 *   they are dropped. The real sources are listed under the text.
 * - Whole-number figures written out in full ("$25,000,000,000", "1,000,000,000") are shown in the shared compact
 *   tiers ($25.0B, 1.0B). The value is the same one the model reported; nothing is converted or estimated. Figures
 *   below a million are left as written.
 */
export function tidyOpportunityProse(markdown: string): string {
  return markdown
    .replace(/[ \t]*\[T(?:\d+|\?)\]/g, '')
    .replace(/(?<![\d,.])(\$?)(\d{1,3}(?:,\d{3})+)(?![\d,])(?!\.\d)/g, (whole, dollar: string, digits: string) => {
      const value = Number(digits.replace(/,/g, ''));
      if (!Number.isFinite(value) || value < 1e6) return whole;
      return dollar ? formatUsd(value) : formatCount(value);
    });
}
