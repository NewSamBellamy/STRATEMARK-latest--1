import { describe, expect, it } from 'vitest';
import { DropError, MAX_DROP_BYTES, htmlToText, readFileText, readUrlText } from './readDroppedSource';

const file = (content: string, name: string, type = 'text/plain') => new File([content], name, { type });

describe('htmlToText', () => {
  it('drops scripts and tags and keeps paragraphs apart', () => {
    const text = htmlToText('<html><script>var x=1</script><style>p{}</style><h1>Title</h1><p>One &amp; two</p><p>Three</p></html>');
    expect(text).toContain('Title');
    expect(text).toContain('One & two');
    expect(text).not.toContain('var x');
    expect(text.split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(3);
  });
});

describe('readFileText', () => {
  it('reads a markdown file', async () => {
    const doc = await readFileText(file('# Acme\n\nAcme reported strong growth in the third quarter of 2026.', 'acme.md', 'text/markdown'));
    expect(doc).toMatchObject({ title: 'acme.md', kind: 'file' });
    expect(doc.text).toContain('strong growth');
  });

  it('turns away a file type it cannot read, with a plain message', async () => {
    await expect(readFileText(file('x', 'deck.pptx', 'application/vnd.ms-powerpoint'))).rejects.toThrow(/PDF, a markdown or text file/);
  });

  it('turns away a file with almost no text', async () => {
    await expect(readFileText(file('hi', 'tiny.txt'))).rejects.toBeInstanceOf(DropError);
  });

  it('turns away an oversize file before reading it', async () => {
    const big = new File(['x'], 'big.txt', { type: 'text/plain' });
    Object.defineProperty(big, 'size', { value: MAX_DROP_BYTES + 1 });
    await expect(readFileText(big)).rejects.toThrow(/limit is 15 MB/);
  });

  it('reads an html file as text', async () => {
    const doc = await readFileText(file('<p>Acme opened a new plant in Dallas this spring, doubling capacity.</p>', 'page.html', 'text/html'));
    expect(doc.text).toBe('Acme opened a new plant in Dallas this spring, doubling capacity.');
  });
});

describe('readUrlText', () => {
  it('rejects an address that is not a web address', async () => {
    await expect(readUrlText('not a url at all')).rejects.toThrow(/web address/);
  });

  it('rejects an insecure address', async () => {
    await expect(readUrlText('http://example.com/report')).rejects.toThrow(/https/);
  });

  it('says plainly that videos cannot be read yet', async () => {
    await expect(readUrlText('https://www.youtube.com/watch?v=abc')).rejects.toThrow(/transcript/);
  });
});
