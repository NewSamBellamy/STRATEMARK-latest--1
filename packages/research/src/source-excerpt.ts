/** One unchanged contiguous slice: retrieval relevance is not claim verification. */
export function selectSourceExcerpt(text: string): string {
  const limit = 4000;
  if (text.length <= limit) return text;
  const cues = [
    /\b(?:employees|headcount)\b/gi,
    /\b(?:ARR|annual recurring revenue|annual revenue)\b/gi,
    /\b(?:active users|users|customers)\b/gi,
    /\b(?:valuation|valued at)\b/gi,
    /\b(?:market cap|market capitalization)\b/gi,
    /\bmarket share\b/gi,
  ];
  const hits: { index: number; category: number }[] = [];
  cues.forEach((cue, category) => {
    for (const match of text.matchAll(cue)) {
      const index = match.index!;
      // Relevance only: dates or unrelated numbers can match here. The separate
      // passage gate must still check the original company, figure and basis.
      if (/\d/.test(text.slice(Math.max(0, index - 200), index + match[0].length + 200))) {
        hits.push({ index, category });
      }
    }
  });
  hits.sort((a, b) => a.index - b.index);
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
    const score = counts.filter((count) => count > 0).length;
    if (score > bestScore) { bestScore = score; bestStart = start; }
  }
  // Never concatenate windows or rewrite a passage: a quote cannot bridge gaps.
  return text.slice(bestStart, bestStart + limit);
}
