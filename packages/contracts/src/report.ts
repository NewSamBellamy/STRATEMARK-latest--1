/** Keep generated research reports inside the product's evidence vocabulary and visual grammar. */
export function normalizeReportMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\bUser verified\b/g, 'User confirmed')
    .replace(/\buser verified\b/g, 'user confirmed')
    .replace(/\bUser-verified\b/g, 'User-confirmed')
    .replace(/\buser-verified\b/g, 'user-confirmed')
    .replace(/\bVERIFIED\b/g, 'SOURCED')
    .replace(/\bVerified\b/g, 'Sourced')
    .replace(/\bverified\b/g, 'sourced')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
