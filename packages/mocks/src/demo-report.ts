/**
 * Demo-mode company reports: written straight from the sample deck's stored
 * research, with no model call and no new research. Every figure is the stored
 * one (unknown stays "not found"), and a topic the sample never researched
 * says so in `gaps`. A live report (with a key) researches those gaps; this
 * one cannot, and its title says "demo".
 */
import {
  METRIC_TYPE_LABELS,
  REPORT_TOPIC_LABELS,
  REPORT_TOPIC_TAB,
  usableCitations,
  type Citation,
  type Company,
  type CompanyMetric,
  type DashboardContentMap,
  type DashboardTab,
  type MetricType,
  type ReportSection,
  type ReportTopic,
} from '@mi/contracts';

type Content = Partial<DashboardContentMap>;

const USD_METRICS: ReadonlySet<MetricType> = new Set(['market_cap', 'valuation', 'arr', 'aum', 'revenue', 'funding_total', 'last_round']);

function compactNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

function metricText(m: CompanyMetric): string {
  if (m.value == null) return 'not found';
  if (m.metricType === 'market_share') return `${m.value}%`;
  return `${USD_METRICS.has(m.metricType) ? '$' : ''}${compactNumber(m.value)}`;
}

function section(topic: ReportTopic, markdown: string, citations: Citation[], gaps: string[]): ReportSection {
  return {
    topic,
    title: REPORT_TOPIC_LABELS[topic],
    markdown,
    citations: usableCitations(citations),
    gaps,
    researchedDeeper: false,
  };
}

function build(topic: ReportTopic, company: Company, metrics: readonly CompanyMetric[], content: Content): ReportSection {
  const tab: DashboardTab = REPORT_TOPIC_TAB[topic];
  const missingTab = `The ${REPORT_TOPIC_LABELS[topic].toLowerCase()} tab has not been researched yet.`;
  switch (topic) {
    case 'overview': {
      const md = content.overview?.markdown?.trim();
      return md ? section(topic, md.replace(/^#\s[^\n]*\n+/, ''), [], []) : section(topic, 'Not found in the stored research.', [], [missingTab]);
    }
    case 'metrics': {
      const rows = metrics.map((m) => `| ${METRIC_TYPE_LABELS[m.metricType]} | ${metricText(m)} | ${m.confidence.replace('_', ' ')} |`);
      if (rows.length === 0) return section(topic, 'Not found in the stored research.', [], ['No metrics are stored for this company.']);
      const unknown = metrics.filter((m) => m.value == null).map((m) => `${METRIC_TYPE_LABELS[m.metricType]} has no sourced figure.`);
      return section(
        topic,
        ['| Metric | Value | Confidence |', '| --- | --- | --- |', ...rows].join('\n'),
        metrics.flatMap((m) => m.citations),
        unknown,
      );
    }
    case 'live_intel': {
      const items = content.live_intel?.items ?? [];
      if (items.length === 0) return section(topic, 'Not found in the stored research.', [], [missingTab]);
      const lines = items.slice(0, 8).map((i) => `- **${i.title}**${i.publishedDate ? ` (${i.publishedDate})` : ''}: ${i.summary}`);
      return section(topic, lines.join('\n'), items.map((i) => ({ title: i.publisher ?? i.title, url: i.url })), []);
    }
    case 'team_org': {
      const nodes = content.team_org?.nodes ?? [];
      if (nodes.length === 0) return section(topic, 'Not found in the stored research.', [], [missingTab]);
      const lines = nodes.slice(0, 14).map((n) => `- **${n.name}**, ${n.role}${n.bio ? `. ${n.bio}` : ''}`);
      return section(topic, lines.join('\n'), [], []);
    }
    case 'products_roadmap': {
      const pr = content.products_roadmap;
      if (!pr || (pr.products.length === 0 && pr.roadmap.length === 0)) return section(topic, 'Not found in the stored research.', [], [missingTab]);
      const parts = [
        ...pr.products.slice(0, 8).map((p) => `- **${p.name}**${p.status ? ` (${p.status})` : ''}: ${p.description}`),
        ...(pr.roadmap.length > 0 ? ['', '**Roadmap**', ...pr.roadmap.slice(0, 8).map((r) => `- ${r.horizon}: ${r.title}${r.date ? ` (${r.date})` : ''}`)] : []),
      ];
      return section(topic, parts.join('\n'), (pr.relationships ?? []).filter((r) => r.sourceUrl).map((r) => ({ title: r.sourceTitle ?? r.name, url: r.sourceUrl as string })), []);
    }
    case 'history': {
      const h = content.history;
      if (!h || (!h.founderStory && h.timeline.length === 0)) return section(topic, 'Not found in the stored research.', [], [missingTab]);
      const parts = [
        ...(h.founderStory ? [h.founderStory, ''] : []),
        ...h.timeline.slice(0, 12).map((e) => `- **${e.date}**: ${e.title}`),
      ];
      return section(topic, parts.join('\n'), h.quotes.filter((q) => q.sourceUrl).map((q) => ({ title: q.sourceTitle ?? q.attribution, url: q.sourceUrl as string })), []);
    }
    case 'mission_governance': {
      const m = content.mission_governance;
      if (!m || (!m.mission && m.board.length === 0)) return section(topic, 'Not found in the stored research.', [], [missingTab]);
      const parts = [
        ...(m.mission ? [m.mission, ''] : []),
        ...(m.governanceStructure ? [m.governanceStructure, ''] : []),
        ...(m.board.length > 0 ? ['**Board**', ...m.board.map((b) => `- ${b.name}${b.affiliation ? `, ${b.affiliation}` : ''}`)] : []),
      ];
      return section(topic, parts.join('\n'), [], []);
    }
    case 'sources': {
      const all = usableCitations([
        ...metrics.flatMap((x) => x.citations),
        ...(content.live_intel?.items ?? []).map((i) => ({ title: i.publisher ?? i.title, url: i.url })),
      ]);
      const md = all.length > 0 ? all.map((c) => `- ${c.title}`).join('\n') : 'No sources are stored for this company.';
      return section(topic, md, all, all.length > 0 ? [] : [`The ${company.name} research has no stored sources.`]);
    }
    default:
      return section(topic, 'Not found in the stored research.', [], [`No stored research for ${tab}.`]);
  }
}

export function buildDemoSections(
  company: Company,
  metrics: readonly CompanyMetric[],
  content: Content,
  topics: readonly ReportTopic[],
): ReportSection[] {
  return topics.map((topic) => build(topic, company, metrics, content));
}
