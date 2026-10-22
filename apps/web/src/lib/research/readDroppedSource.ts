import { readPreviewSource, supportsPreviewSource } from '@/lib/repository/local-source-reader';

/** Biggest file read in the browser. A bigger one is turned away with a plain message, never half-read. */
export const MAX_DROP_BYTES = 15 * 1024 * 1024;

const TEXT_EXTENSIONS = /\.(?:md|markdown|txt|text|csv|tsv|json|html?|rtf)$/i;

export interface DroppedDocument { title: string; text: string; sourceUrl?: string; kind: 'file' | 'text' | 'url' }

/** A message the person can act on, never a stack trace. */
export class DropError extends Error {}

/** Plain text from a page's HTML: scripts and styles removed, tags gone, entities left as the page wrote them. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

async function pdfText(file: File): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join('\n\n') : text;
}

/** Read a dropped or picked file into text: PDF, markdown, plain text and similar. */
export async function readFileText(file: File): Promise<DroppedDocument> {
  if (file.size > MAX_DROP_BYTES) throw new DropError(`That file is ${(file.size / 1048576).toFixed(0)} MB. The limit is ${MAX_DROP_BYTES / 1048576} MB; try the part you need.`);
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isText = file.type.startsWith('text/') || file.type === 'application/json' || TEXT_EXTENSIONS.test(file.name);
  if (!isPdf && !isText) throw new DropError('Drop a PDF, a markdown or text file, or paste the text. Other file types are not supported yet.');
  let text: string;
  try {
    text = isPdf ? await pdfText(file) : await file.text();
  } catch {
    throw new DropError(isPdf ? 'That PDF could not be read. It may be a scan or protected; paste its text instead.' : 'That file could not be read.');
  }
  if (/\.html?$/i.test(file.name) || file.type === 'text/html') text = htmlToText(text);
  if (text.trim().length < 40) {
    throw new DropError(isPdf ? 'That PDF has no readable text (a scan, perhaps). Paste its text instead.' : 'That file has almost no text in it.');
  }
  return { title: file.name, text, kind: 'file' };
}

/** Read a web page by address through the same page reader research uses. */
export async function readUrlText(raw: string): Promise<DroppedDocument> {
  let url: URL;
  try { url = new URL(/^[a-z]+:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`); } catch { throw new DropError('That does not look like a web address.'); }
  if (url.protocol !== 'https:') throw new DropError('Only secure (https) addresses can be read.');
  if (/(?:^|\.)(?:youtube\.com|youtu\.be|vimeo\.com)$/i.test(url.hostname)) {
    throw new DropError('Videos cannot be read yet. Paste the transcript or your notes about it instead.');
  }
  if (!supportsPreviewSource(url.toString())) throw new DropError('That page cannot be read from here. Paste its text instead.');
  const receipt = await readPreviewSource(url.toString());
  if (receipt.status !== 'retrieved' || !receipt.text) {
    throw new DropError(receipt.status === 'blocked'
      ? 'That site does not allow its pages to be read. Paste the text instead.'
      : 'That page could not be read just now. Try again, or paste its text.');
  }
  return { title: url.hostname.replace(/^www\./, ''), text: receipt.text, sourceUrl: url.toString(), kind: 'url' };
}
