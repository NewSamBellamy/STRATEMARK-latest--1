/**
 * Boss-ready export: build a .pptx from a deck's researched cards.
 * Client-side via pptxgenjs (dynamically imported to keep the bundle lean).
 */
import type PptxGenJS from 'pptxgenjs';
import { isEntityCardType, publisherOf, type CardWithCompany, type MetricType } from '@mi/contracts';
import { safeHttpUrl, sourceHref } from '@/lib/sourceHref';
import { UNSUPPORTED_COMPANY_SUMMARY } from '@mi/research';
import { exportCompanyOf, figureRows, type MetricRow } from '@/features/export/exportModel';

const INK = '18181B';
const MUTED = '6B6B72';
const ACCENT = 'F15A24';

/** What XML 1.0 cannot carry in text: control characters other than tab, line
 * feed and carriage return, U+FFFE and U+FFFF, and unpaired surrogates (which
 * are not valid UTF-8 once written). One of these anywhere in a slide makes
 * PowerPoint refuse the whole file ("needs repair"), and text pasted from a
 * PDF routinely carries a form feed. */
// eslint-disable-next-line no-control-regex
const NOT_XML = /[\u0000-\u0008\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Text safe to hand to pptxgenjs, which escapes markup but not these. A
 * vertical tab or form feed separates words, so it becomes a space rather than
 * gluing them together; the rest are dropped. */
export function xmlSafe(value: string): string {
  return value.replace(/[\v\f]/g, ' ').replace(NOT_XML, '');
}

/** One company's figures, read the way its card face reads them (own rows, same gates, same display). */
type Figures = ReadonlyMap<MetricType, MetricRow>;
const figuresOf = (c: CardWithCompany): Figures => figureRows(exportCompanyOf(c)!);

/** A figure only appears when it is sourced (Rule 9); otherwise an honest Unknown. */
function metric(f: Figures, type: MetricType): string {
  const row = f.get(type);
  return !row || row.unknown ? 'Unknown' : xmlSafe(row.valueText);
}

function valuation(f: Figures): string {
  const v = metric(f, 'valuation');
  return v !== 'Unknown' ? v : metric(f, 'market_cap');
}

export async function exportDeckPptx(args: {
  marketName: string;
  cards: CardWithCompany[];
  thesis?: string | null;
}): Promise<void> {
  const { default: PptxGen } = await import('pptxgenjs');
  const pptx = new PptxGen();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'Stratemark';

  // 1) Title slide
  const title = pptx.addSlide();
  title.addShape('rect', { x: 0, y: 0, w: '100%', h: 0.35, fill: { color: ACCENT } });
  title.addText(xmlSafe(args.marketName), {
    x: 0.6, y: 1.6, w: 9, h: 1.2, fontSize: 34, bold: true, color: INK, fontFace: 'Arial',
  });
  title.addText('Competitive intelligence deck · grounded research with cited sources', {
    x: 0.6, y: 2.7, w: 9, h: 0.5, fontSize: 14, color: MUTED,
  });
  title.addText(`Generated ${new Date().toLocaleDateString()} · Stratemark`, {
    x: 0.6, y: 4.9, w: 9, h: 0.4, fontSize: 10, color: MUTED,
  });

  // 2) Landscape table slide. Every entity card counts (the deck header's
  // "16 companies" includes infrastructure and distribution), once each.
  const seen = new Set<string>();
  const companies = args.cards.filter((c) => {
    if (!isEntityCardType(c.card.cardType) || !c.company || seen.has(c.company.id)) return false;
    seen.add(c.company.id);
    return true;
  });
  const rows: PptxGenJS.TableRow[] = [
    ['Company', 'HQ', 'Mkt share', 'ARR', 'Valuation/Cap', 'Team'].map((t) => ({
      text: t,
      options: { bold: true, color: 'FFFFFF', fill: { color: INK }, fontSize: 11 },
    })),
  ];
  for (const c of companies.slice(0, 14)) {
    const figures = figuresOf(c);
    rows.push([
      { text: xmlSafe(c.company!.name), options: { fontSize: 11, bold: true, color: INK } },
      { text: xmlSafe(c.company!.hqLocation?.trim() || '—'), options: { fontSize: 10, color: MUTED } },
      { text: metric(figures, 'market_share'), options: { fontSize: 11, color: INK } },
      { text: metric(figures, 'arr'), options: { fontSize: 11, color: INK } },
      { text: valuation(figures), options: { fontSize: 11, color: INK } },
      { text: metric(figures, 'employees'), options: { fontSize: 11, color: INK } },
    ]);
  }
  const landscape = pptx.addSlide();
  landscape.addText('Market landscape', { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 22, bold: true, color: INK });
  landscape.addTable(rows, { x: 0.5, y: 1.0, w: 9.0, border: { type: 'solid', color: 'E5E3DD', pt: 0.5 }, rowH: 0.32 });

  // 3) Optional whitespace thesis slide
  if (args.thesis) {
    const s = pptx.addSlide();
    s.addText('Where the gap is', { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 22, bold: true, color: INK });
    s.addText(xmlSafe(args.thesis.replace(/[#*_`]/g, '').slice(0, 1800)), {
      x: 0.5, y: 1.0, w: 9, h: 4.2, fontSize: 12, color: INK, valign: 'top',
    });
  }

  // 4) One slide per company (first 16, in deck order)
  const top = companies.slice(0, 16);
  for (const c of top) {
    const s = pptx.addSlide();
    const brand = (c.company!.brandTheme?.primary ?? '#F15A24').replace('#', '');
    s.addShape('rect', { x: 0, y: 0, w: '100%', h: 0.25, fill: { color: brand } });
    s.addText(xmlSafe(c.company!.name), { x: 0.5, y: 0.5, w: 9, h: 0.6, fontSize: 26, bold: true, color: INK });
    s.addText(
      xmlSafe(c.company!.hqLocation?.trim() || 'Location unknown'),
      { x: 0.5, y: 1.1, w: 9, h: 0.4, fontSize: 12, color: MUTED },
    );
    if (c.company!.oneLiner && c.company!.oneLiner !== UNSUPPORTED_COMPANY_SUMMARY) {
      s.addText(xmlSafe(c.company!.oneLiner), { x: 0.5, y: 1.6, w: 9, h: 0.8, fontSize: 13, color: INK });
    }
    const figures = figuresOf(c);
    const facts = [
      `Market share: ${metric(figures, 'market_share')}`,
      `ARR: ${metric(figures, 'arr')}`,
      `Valuation/Cap: ${valuation(figures)}`,
      `Team: ${metric(figures, 'employees')}`,
      `Users: ${metric(figures, 'users')}`,
    ];
    s.addText(facts.map((f) => ({ text: f, options: { bullet: true, fontSize: 13, color: INK } })), {
      x: 0.5, y: 2.6, w: 5.5, h: 2.4, valign: 'top',
    });
    // The title slide promises cited sources; each company slide carries its own.
    const sources = [...new Map(
      (['market_share', 'arr', 'valuation', 'market_cap', 'employees', 'users'] as MetricType[])
        .flatMap((type) => figures.get(type)?.sources ?? [])
        .map((src) => [src.url, src]),
    ).values()].slice(0, 4);
    if (sources.length) {
      s.addText([
        { text: 'Sources', options: { bold: true, fontSize: 10, color: MUTED, breakLine: true } },
        ...sources.map((src) => {
          // Normalised, so a control character in the address is percent-encoded
          // instead of being written raw into the slide's relationships.
          const link = safeHttpUrl(sourceHref(src.url, src.title));
          return { text: xmlSafe(publisherOf(src.url, src.title)), options: { fontSize: 9, color: MUTED, ...(link ? { hyperlink: { url: link } } : {}), breakLine: true } };
        }),
      ], { x: 6.2, y: 2.6, w: 3.3, h: 2.4, valign: 'top' });
    }
  }

  await pptx.writeFile({
    fileName: `${args.marketName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-deck.pptx`,
  });
}
