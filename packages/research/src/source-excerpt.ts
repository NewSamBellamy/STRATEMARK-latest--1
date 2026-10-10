/** One unchanged contiguous slice: retrieval relevance is not claim verification. */
export function selectSourceExcerpt(text: string, scope?: { companyName: string; metricType?: string }): string {
  const limit = 4000;
  if (text.length <= limit) return text;
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
    /\b(?:valuation|valued at)\b/gi,
    /\b(?:market cap|market capitalization)\b/gi,
    /\bmarket share\b/gi,
    /\b(?:AUM|assets under management)\b/gi,
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
  const categories = ['employees', 'arr', 'users', 'valuation', 'market_cap', 'market_share', 'aum'];
  const category = categories.indexOf(scope?.metricType ?? '');
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
      const score = category < 0 ? counts.filter(count => count > 0).length : counts[category]! > 0 ? 1 : 0;
      if (score > best) { best = score; start = candidate; }
    }
    if (best > 0) return text.slice(start, start + limit);
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
    const score = counts.filter((count) => count > 0).length +
      (category >= 0 && counts[category]! > 0 ? cues.length + 1 : 0);
    if (score > bestScore) { bestScore = score; bestStart = start; }
  }
  // Never concatenate windows or rewrite a passage: a quote cannot bridge gaps.
  return text.slice(bestStart, bestStart + limit);
}
