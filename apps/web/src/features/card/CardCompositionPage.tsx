import { useState } from 'react';
import { isSignalCardType, type CardType, type CardWithCompany } from '@mi/contracts';
import { CollectibleCard } from './CollectibleCard';

type Sample = {
  type: CardType;
  title: string;
  summary: string;
  company?: { name: string; purpose: string };
  point?: string;
  period?: string;
  caption: string;
};

const samples: Sample[] = [
  {
    type: 'company',
    title: 'Alder Works',
    company: {
      name: 'Alder Works',
      purpose: 'Job intake and repair tracking for independent workshops.',
    },
    summary: 'Connects customer intake, bench work and collection in one shop workflow.',
    point: 'The sample product guide describes intake, work orders and customer updates.',
    caption: 'Company · generous identity, purpose and market relevance.',
  },
  {
    type: 'infrastructure',
    title: 'Harbor Parts Exchange',
    company: {
      name: 'Harbor Parts Exchange',
      purpose: 'A parts catalog and compatibility API for repair software.',
    },
    summary: 'Enables parts lookup inside repair tools; access depends on supplier agreements.',
    point: 'The sample access guide requires a supplier agreement before catalog integration.',
    caption: 'Infrastructure · capability and dependency, without invented capacity.',
  },
  {
    type: 'distribution',
    title: 'Benchline Network',
    company: {
      name: 'Benchline Network',
      purpose: 'A member directory and referral channel for local repair shops.',
    },
    summary: 'Reaches independent shop owners through member listings and local referrals.',
    point: 'The sample member guide describes opt-in listings; audience size is not recorded.',
    caption: 'Distribution · audience and access, without invented reach.',
  },
  {
    type: 'vice',
    title: 'Repair booking terms face a complaint',
    company: {
      name: 'Alder Works',
      purpose: 'Job intake and repair tracking for independent workshops.',
    },
    summary:
      'A sample consumer notice alleges unclear cancellation terms. It does not establish a violation.',
    point:
      'The fictional notice records a complaint about cancellation terms; a response is not included.',
    period: 'September 2026',
    caption: 'Vice · attributed allegation, event period and an explicit resolution gap.',
  },
  {
    type: 'barrier',
    title: 'Parts access depends on authorization',
    summary:
      'New repair platforms may need supplier agreements before offering model-specific parts lookup.',
    point: 'The fictional supplier policy requires an approved repair partner for catalog access.',
    period: 'September 2026 policy',
    caption: 'Barrier to entry · mechanism, affected entrants and requirement.',
  },
  {
    type: 'insight',
    title: 'Offline intake may be a useful wedge',
    summary:
      'Bench connectivity could shape adoption. This is a hypothesis to test, not an adoption forecast.',
    point: 'The sample workshop interviews describe interrupted connections during job intake.',
    period: 'September 2026 interviews',
    caption: 'Insight · separates an observation from its possible implication.',
  },
  {
    type: 'culture',
    title: 'Repair guild shares practical workflows',
    summary:
      'Local repair volunteers exchange intake templates and peer advice, helping newcomers get started.',
    point:
      'The fictional public guild notes describe volunteer-led template sharing and open meetups.',
    period: 'September 2026 activity',
    caption: 'Community · participants, public activity and significance; wire type stays culture.',
  },
];

function fixture(sample: Sample, index: number): CardWithCompany {
  const id = `synthetic-r0-${index}`;
  // Reserved, non-routable citations are illustrative records, never real support.
  const citations = sample.point
    ? [
        {
          title: `SYNTHETIC · ${sample.title} source note`,
          url: `https://fixtures.invalid/r0/${index}`,
        },
      ]
    : [];
  return {
    card: {
      id,
      deckId: 'synthetic-r0-repair-market',
      companyId: sample.company ? `${id}-entity` : null,
      cardType: sample.type,
      title: sample.title,
      summary: sample.summary || null,
      tier: null,
      tierReason: null,
      citations,
      keyPoints: [],
      evidencePoints: sample.point
        ? [{ text: sample.point, citations, timeWindow: sample.period ?? null }]
        : [],
      createdAt: '2026-10-01T12:00:00.000Z',
    },
    company: sample.company
      ? {
          id: `${id}-entity`,
          name: sample.company.name,
          oneLiner: sample.company.purpose,
          logoUrl: null,
          websiteUrl: null,
          hqLocation: null,
          brandTheme: null,
        }
      : null,
    metrics: [],
    viceClaims: [],
  };
}

const edges: Sample[] = [
  {
    type: 'company',
    title: 'North Coast Cooperative for Independent Appliance Repair and Reuse',
    company: {
      name: 'North Coast Cooperative for Independent Appliance Repair and Reuse',
      purpose: 'Shared intake tools for community repair workshops.',
    },
    summary: 'Coordinates workshop bookings and reuse referrals across a local cooperative.',
    caption: 'Long name · full identity is available in the title and workspace preview.',
  },
  {
    type: 'infrastructure',
    title: 'Bench Relay',
    company: { name: 'Bench Relay', purpose: '' },
    summary: '',
    caption: 'Sparse · missing logo, purpose, context and metrics; gaps stay visible.',
  },
];

const fixtures = [...samples, ...edges].map(fixture);

/** Disposable /design/cards export. The route integrator owns wiring and removal.
 * No repository, auth, provider, researcher, save/share or production reader hooks.
 * All logo inputs are null, so the real Logo component performs no image requests.
 */
export function CardCompositionPage() {
  const [selected, setSelected] = useState(0);
  const [section, setSection] = useState('Overview');
  const data = fixtures[selected]!;
  const sample = [...samples, ...edges][selected]!;
  const finding = isSignalCardType(data.card.cardType);
  const sections = finding
    ? ['Overview', 'Evidence', 'Open questions']
    : ['Overview', 'Offering', 'Market position', 'Evidence', 'Updates'];
  const type = data.card.cardType === 'culture' ? 'Community' : data.card.cardType;

  function select(index: number) {
    setSelected(index);
    setSection('Overview');
  }

  function renderSample(item: Sample, index: number) {
    return (
      <figure key={fixtures[index]!.card.id} className="card-composition__sample">
        <button
          type="button"
          aria-label={`Preview ${item.title}`}
          aria-pressed={selected === index}
          aria-controls="card-composition-workspace"
          onClick={() => select(index)}
        >
          <CollectibleCard data={fixtures[index]!} />
        </button>
        <figcaption className="card-composition__caption">SYNTHETIC · {item.caption}</figcaption>
      </figure>
    );
  }

  return (
    <main className="card-composition">
      <header className="card-composition__intro">
        <span className="card-composition__label">
          R0 / disposable design composition /design/cards
        </span>
        <h1>A research deck for independent repair.</h1>
        <p>
          Seven useful perspectives, one paper-and-green card family. Select a card to read the
          small entity or story composition below.
        </p>
        <div className="card-composition__notice">
          SYNTHETIC FIXTURES ONLY · Fictional names, claims, periods and reserved source URLs. No
          real research or numeric metrics. Local React preview; no storage or provider calls. Save,
          share, research and destination routes are not connected. Owner aesthetic approval is
          pending.
        </div>
      </header>
      <section className="card-composition__section" aria-labelledby="card-family-heading">
        <h2 id="card-family-heading">The seven-card family</h2>
        <div className="card-composition__grid">{samples.map(renderSample)}</div>
      </section>
      <section className="card-composition__section" aria-labelledby="card-edges-heading">
        <h2 id="card-edges-heading">Long identity and sparse research</h2>
        <p>
          These use the same component and proportion. Missing logos use its existing lettermark
          fallback.
        </p>
        <div className="card-composition__grid">
          {edges.map((item, index) => renderSample(item, samples.length + index))}
        </div>
      </section>
      <section
        id="card-composition-workspace"
        className="card-composition__section"
        aria-labelledby="card-workspace-heading"
      >
        <span className="card-composition__label">
          SYNTHETIC / {type} / {finding ? 'story' : 'entity'} preview
        </span>
        <h2 id="card-workspace-heading">{sample.title}</h2>
        <div className="card-composition__tabs" aria-label="Preview sections">
          {sections.map((label) => (
            <button
              key={label}
              type="button"
              aria-pressed={section === label}
              onClick={() => setSection(label)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="card-composition__workspace">
          <div>
            <h3>{section}</h3>
            {section === 'Overview' ? (
              <>
                <p>
                  {sample.company?.purpose || sample.summary || 'Purpose has not been researched.'}
                </p>
                {sample.company?.purpose && <p>{sample.summary}</p>}
                {finding && (
                  <>
                    <h3>
                      {data.card.cardType === 'vice'
                        ? 'Allegation versus established fact'
                        : data.card.cardType === 'barrier'
                          ? 'Requirement & affected entrants'
                          : data.card.cardType === 'culture'
                            ? 'Participants & public activity'
                            : 'Observation versus interpretation'}
                    </h3>
                    <p>{sample.point || 'Supporting observations have not been recorded.'}</p>
                  </>
                )}
              </>
            ) : section === 'Evidence' ? (
              <>
                <p>{sample.point || 'No source-backed observations saved.'}</p>
                <p>{data.card.citations[0]?.title || 'No sources saved.'}</p>
                <p>
                  {sample.period
                    ? `Reported period: ${sample.period}.`
                    : 'Event or scope date not recorded.'}{' '}
                  All source records here are synthetic.
                </p>
              </>
            ) : (
              <p>
                {section === 'Offering'
                  ? sample.company?.purpose || 'Capabilities and access have not been researched.'
                  : section === 'Market position'
                    ? sample.summary || 'Market relevance has not been recorded.'
                    : section === 'Updates'
                      ? 'No saved update history in this fixture.'
                      : 'The sample does not establish adoption, commercial outcomes or market-wide prevalence.'}
              </p>
            )}
          </div>
          <aside>
            <h3>What remains unknown</h3>
            <p>
              {data.card.cardType === 'vice'
                ? 'Response, resolution and any independent determination are not recorded.'
                : data.card.cardType === 'barrier'
                  ? 'Agreement terms and differences between suppliers need research.'
                  : data.card.cardType === 'culture'
                    ? 'Participant coverage and representativeness are not established.'
                    : finding
                      ? 'Counterevidence and the breadth of the observation need research.'
                      : 'Pricing, customer coverage and comparable metrics have not been researched.'}
            </p>
            <h3>Evidence before action</h3>
            <p>
              This is a composition preview. Production actions and deeper research will be
              integrated separately.
            </p>
          </aside>
        </div>
      </section>
    </main>
  );
}

export default CardCompositionPage;
