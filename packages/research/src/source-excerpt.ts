import { amountMatches, sameAmount } from './amounts';

/** One unchanged contiguous slice: retrieval relevance is not claim verification. */
export function selectSourceExcerpt(text: string, scope?: { companyName: string; metricType?: string; values?: readonly number[] }): string {
  const limit = 4000;
  if (text.length <= limit) return text;
  // A reader checking one figure wants the passage that carries it, not the
  // page's densest cluster of cue words. The values arrive over the relay, so
  // they are validated as data.
  const values = scope?.values;
  const wanted = Array.isArray(values) ? values.filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0).slice(0, 4) : [];
  if (wanted.length > 0) {
    const name = scope?.companyName?.trim().toLowerCase() ?? '';
    const hits = amountMatches(text).filter((m) => wanted.some((v) => sameAmount(m.value, v)));
    const near = (index: number) => name.length > 0 && text.slice(Math.max(0, index - 1200), index + 1200).toLowerCase().includes(name);
    const hit = hits.find((m) => near(m.index)) ?? hits[0];
    if (hit) {
      const start = Math.min(Math.max(0, hit.index - 1500), text.length - limit);
      return text.slice(start, start + limit);
    }
  }
  if (scope?.metricType === 'employees') {
    // A numbered workforce statement outranks incidental dates beside benefits
    // menus. This only selects unchanged text; the separate claim/issuer gate
    // still decides attribution, reporting date and whether a figure is usable.
    const statements = [...text.matchAll(/\b(?:had|have|has|employs?|employed|reported)\s+(?:approximately\s+)?\d[\d,]*\s+(?:(?:full[- ]time\s+)?employees\b|people on a full[- ]time basis\b)/gi)];
    const name = scope.companyName.trim().toLowerCase();
    const selected = statements.find(match => name && text.slice(Math.max(0, match.index! - 300), match.index! + 300).toLowerCase().includes(name)) ?? statements[0];
    if (selected) {
      const start = Math.min(Math.max(0, selected.index! - 600), text.length - limit);
      return text.slice(start, start + limit);
    }
  }
  const products = scope?.metricType === 'products_roadmap';
  const cues = products ? [
    /\b(?:available|launched|released|beta|discontinued|retired)\b/gi,
    /\b(?:roadmap|planned|plans|announced|upcoming)\b/gi,
    /\b(?:product|pricing|documentation|download)\b/gi,
  ] : [
    /\b(?:employees|headcount)\b/gi,
    /\b(?:ARR|annual recurring revenue|annual revenue)\b/gi,
    /\b(?:active users|users|customers)\b/gi,
    /\b(?:valuation|valued at|valuing)\b/gi,
    /\b(?:market cap|market capitalization)\b/gi,
    /\bmarket share\b/gi,
    /\b(?:AUM|assets under management)\b/gi,
    // Funding and revenue wording: without these a press release's headline
    // ("X Raises Series F at $44 Billion Valuation") tied the article body,
    // and the first window — site navigation — won.
    /\b(?:raised|raises|funding|financing|Series [A-Z]\d?)\b/gi,
    /\b(?:revenues?|sales)\b/gi,
  ];
  const hits: { index: number; category: number }[] = [];
  cues.forEach((cue, category) => {
    for (const match of text.matchAll(cue)) {
      const index = match.index!;
      // Relevance only: dates or unrelated numbers can match here. The separate
      // passage gate must still check the original company, figure and basis.
      if (products || /\d/.test(text.slice(Math.max(0, index - 200), index + match[0].length + 200))) {
        hits.push({ index, category });
      }
    }
  });
  hits.sort((a, b) => a.index - b.index);
  const categories = ['employees', 'arr', 'users', 'valuation', 'market_cap', 'market_share', 'aum', 'funding', 'revenue'];
  const metric = scope?.metricType === 'funding_total' || scope?.metricType === 'last_round' ? 'funding' : scope?.metricType ?? '';
  const category = products ? -1 : categories.indexOf(metric);
  // Ties between windows go to the one with more cue mentions (an article body
  // repeats its figures; a menu or headline mentions them once).
  const density = (counts: number[]) => Math.min(49, counts.reduce((sum, count) => sum + count, 0));
  // A written calendar date (a press-release dateline, "as of June 30, 2026")
  // is what makes a figure checkable, so a window that keeps one beats an
  // otherwise equal window that cuts it off. Worth less than one category.
  const datePositions = [...text.matchAll(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.? \d{1,2}, \d{4}\b|\b\d{4}-\d{2}-\d{2}\b/g)].map(m => m.index!);
  const dated = (start: number) => datePositions.some(index => index >= start && index < start + limit) ? 50 : 0;
  // A dateline just ahead of the chosen window ("NEW YORK, June 4, 2026 --
  // Today, X announced ...") belongs with it: pull the window back to keep it.
  const withDateline = (start: number) => {
    const before = datePositions.filter(index => index < start && index >= start - 600).pop();
    return before === undefined ? start : Math.max(0, before - 100);
  };
  // Literal company windows, never aliases or stitched quotes. This is relevance
  // selection only: the original-passage gate still decides whether a claim holds.
  const name = scope?.companyName.trim().toLowerCase();
  if (name && name.length <= 300) {
    let best = -1;
    let start = 0;
    const counts = cues.map(() => 0);
    let left = 0;
    let right = 0;
    const escaped = [...name].map(char => '^$.*+?()[]{}|'.includes(char) || char.charCodeAt(0) === 92 ? String.fromCharCode(92) + char : char).join('');
    for (const match of text.matchAll(new RegExp(escaped, 'gi'))) {
      const index = match.index!;
      const candidate = Math.min(Math.max(0, index - 600), text.length - limit);
      while (right < hits.length && hits[right]!.index < candidate + limit) counts[hits[right++]!.category]!++;
      while (left < right && hits[left]!.index < candidate) counts[hits[left++]!.category]!--;
      const relevant = category < 0 ? counts.filter(count => count > 0).length : counts[category]! > 0 ? 1 : 0;
      const score = relevant > 0 ? relevant * 100 + dated(candidate) + density(counts) : 0;
      if (score > best) { best = score; start = candidate; }
    }
    if (best > 0) {
      const from = withDateline(start);
      return text.slice(from, from + limit);
    }
  }
  const starts = [...new Set([0, ...hits.map((hit) => Math.min(Math.max(0, hit.index - 600), text.length - limit))])].sort((a, b) => a - b);
  // A sliding count keeps long/repetitive documents linear after sorting.
  // Each category earns at most one point; repeating a menu cannot outweigh
  // a compact cluster of distinct business figures.
  const counts = cues.map(() => 0);
  let left = 0;
  let right = 0;
  let bestStart = 0;
  let bestScore = -1;
  for (const start of starts) {
    while (right < hits.length && hits[right]!.index < start + limit) {
      counts[hits[right++]!.category]!++;
    }
    while (left < right && hits[left]!.index < start) {
      counts[hits[left++]!.category]!--;
    }
    // First-person filings may omit the literal legal name in the passage.
    // Preserve the requested metric for inspection, never infer its attribution.
    const score = (counts.filter((count) => count > 0).length +
      (category >= 0 && counts[category]! > 0 ? cues.length + 1 : 0)) * 100 + dated(start) + density(counts);
    if (score > bestScore) { bestScore = score; bestStart = start; }
  }
  // Never concatenate windows or rewrite a passage: a quote cannot bridge gaps.
  const from = bestScore > 0 && hits.length ? withDateline(bestStart) : bestStart;
  return text.slice(from, from + limit);
}
