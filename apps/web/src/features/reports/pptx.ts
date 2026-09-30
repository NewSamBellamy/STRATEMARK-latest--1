/**
 * Boss-ready export: build a .pptx from a deck's researched cards.
 * Client-side via pptxgenjs (dynamically imported to keep the bundle lean).
 */
import type PptxGenJS from 'pptxgenjs';
import type { CardWithCompany, MaturityTier } from '@mi/contracts';
import { TIER_LABELS, metricDisplayLabel } from '@mi/contracts';
import { formatMetricValue } from '@/lib/format';

const INK = '18181B';
const MUTED = '6B6B72';
const ACCENT = 'F15A24';

function metric(c: CardWithCompany, type: string): string {
  const m = c.metrics.find((x) => x.metricType === type && x.value != null);
  return m ? formatMetricValue(m.metricType, m.value) : '—';
}

export async function exportDeckPptx(args: {
  marketName: string;
  cards: CardWithCompany[];
  thesis?: string | null;
}): Promise<void> {
  const { default: PptxGen } = await import('pptxgenjs');
  const pptx = new PptxGen();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'Market Intel Deck Builder';

  // 1) Title slide
  const title = pptx.addSlide();
  title.addShape('rect', { x: 0, y: 0, w: '100%', h: 0.35, fill: { color: ACCENT } });
  title.addText(args.marketName, {
    x: 0.6,
    y: 1.6,
    w: 9,
    h: 1.2,
    fontSize: 34,
    bold: true,
    color: INK,
    fontFace: 'Arial',
  });
  title.addText('Competitive intelligence deck · grounded research with cited sources', {
    x: 0.6,
    y: 2.7,
    w: 9,
    h: 0.5,
    fontSize: 14,
    color: MUTED,
  });
  title.addText(
    `Generated ${new Date().toLocaleDateString()} · Market Intel Deck Builder (open source)`,
    {
      x: 0.6,
      y: 4.9,
      w: 9,
      h: 0.4,
      fontSize: 10,
      color: MUTED,
    },
  );

  // 2) Landscape table slide
  const companies = args.cards.filter((c) => c.card.cardType === 'company' && c.company);
  const rows: PptxGenJS.TableRow[] = [
    ['Company', 'Scale band', 'Mkt share', 'ARR', 'Valuation/Cap', 'Team'].map((t) => ({
      text: t,
      options: { bold: true, color: 'FFFFFF', fill: { color: INK }, fontSize: 11 },
    })),
  ];
  for (const c of companies.slice(0, 14)) {
    const val = c.metrics.find(
      (m) => (m.metricType === 'valuation' || m.metricType === 'market_cap') && m.value != null,
    );
    rows.push([
      { text: c.company!.name, options: { fontSize: 11, bold: true, color: INK } },
      {
        text: c.card.tier ? `T${c.card.tier} ${TIER_LABELS[c.card.tier as MaturityTier]}` : '—',
        options: { fontSize: 10, color: MUTED },
      },
      { text: metric(c, 'market_share'), options: { fontSize: 11, color: INK } },
      { text: metric(c, 'arr'), options: { fontSize: 11, color: INK } },
      {
        text: val ? formatMetricValue(val.metricType, val.value) : '—',
        options: { fontSize: 11, color: INK },
      },
      { text: metric(c, 'employees'), options: { fontSize: 11, color: INK } },
    ]);
  }
  const landscape = pptx.addSlide();
  landscape.addText('Market landscape', {
    x: 0.5,
    y: 0.3,
    w: 9,
    h: 0.5,
    fontSize: 22,
    bold: true,
    color: INK,
  });
  landscape.addTable(rows, {
    x: 0.5,
    y: 1.0,
    w: 9.0,
    border: { type: 'solid', color: 'E5E3DD', pt: 0.5 },
    rowH: 0.32,
  });

  // 3) Optional whitespace thesis slide
  if (args.thesis) {
    const s = pptx.addSlide();
    s.addText('Where the gap is', {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.5,
      fontSize: 22,
      bold: true,
      color: INK,
    });
    s.addText(args.thesis.replace(/[#*_`]/g, '').slice(0, 1800), {
      x: 0.5,
      y: 1.0,
      w: 9,
      h: 4.2,
      fontSize: 12,
      color: INK,
      valign: 'top',
    });
  }

  // 4) One slide per company (highest size-signal bands first; not a quality ranking)
  const top = [...companies].sort((a, b) => (b.card.tier ?? 0) - (a.card.tier ?? 0)).slice(0, 10);
  for (const c of top) {
    const s = pptx.addSlide();
    const brand = (c.company!.brandTheme?.primary ?? '#F15A24').replace('#', '');
    s.addShape('rect', { x: 0, y: 0, w: '100%', h: 0.25, fill: { color: brand } });
    s.addText(c.company!.name, {
      x: 0.5,
      y: 0.5,
      w: 9,
      h: 0.6,
      fontSize: 26,
      bold: true,
      color: INK,
    });
    s.addText(
      `${c.card.tier ? `Scale band ${TIER_LABELS[c.card.tier as MaturityTier]} (T${c.card.tier})` : 'Scale band unavailable'} · ${c.company!.hqLocation ?? ''}`,
      { x: 0.5, y: 1.1, w: 9, h: 0.4, fontSize: 12, color: MUTED },
    );
    s.addText(c.company!.oneLiner, { x: 0.5, y: 1.6, w: 9, h: 0.8, fontSize: 13, color: INK });
    const footprints = c.metrics.filter((m) => m.metricType === 'users');
    const facts = [
      `Market share: ${metric(c, 'market_share')}`,
      `ARR: ${metric(c, 'arr')}`,
      `Valuation/Cap: ${(() => {
        const v = c.metrics.find(
          (m) => (m.metricType === 'valuation' || m.metricType === 'market_cap') && m.value != null,
        );
        return v ? formatMetricValue(v.metricType, v.value) : '—';
      })()}`,
      `Team: ${metric(c, 'employees')}`,
      ...(footprints.length > 0
        ? footprints.map(
            (footprint) =>
              `${metricDisplayLabel(footprint)}: ${footprint.value != null && footprint.confidence !== 'unknown' ? formatMetricValue('users', footprint.value) : '—'}`,
          )
        : ['User footprint: —']),
    ];
    s.addText(
      facts.map((f) => ({ text: f, options: { bullet: true, fontSize: 13, color: INK } })),
      {
        x: 0.5,
        y: 2.6,
        w: 5.5,
        h: Math.max(2.4, Math.min(3.8, facts.length * 0.36)),
        valign: 'top',
      },
    );
    if (c.card.tierReason) {
      s.addText(`Scale-band review note: ${c.card.tierReason}`, {
        x: 0.5,
        y: 5.0,
        w: 9,
        h: 0.5,
        fontSize: 10,
        italic: true,
        color: MUTED,
      });
    }
  }

  await pptx.writeFile({
    fileName: `${args.marketName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-deck.pptx`,
  });
}
