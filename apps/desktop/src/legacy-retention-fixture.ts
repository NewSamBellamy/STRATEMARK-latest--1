const at = '2026-09-30T12:00:00.000Z';

/** Synthetic v1/v2 export for offline legacy-retention tests; contains no customer data. */
export function legacyRetentionFixture(schemaVersion?: 1 | 2) {
  const company = {
    id: 'co_shared',
    name: 'Synthetic Fixture Labs',
    oneLiner: 'Synthetic company used only by offline tests.',
    logoUrl: null,
    hqLocation: null,
    websiteUrl: 'https://fixture.example',
    brandTheme: null,
    legacyMetadata: { sourceLabel: 'synthetic', nested: { keep: ['opaque', 7] } },
  };
  const markets = ['a', 'b'].map((suffix) => ({
    id: `mkt_${suffix}`,
    name: `Synthetic Market ${suffix}`,
    scopeDefinition: {
      vertical: 'Synthetic fixtures',
      geography: null,
      notes: null,
      retainedExclusions: ['historical exclusion'],
      metadata: { period: 'FY2024', opaque: { original: true } },
    },
    refreshCadence: 'daily',
    createdAt: at,
  }));
  const decks = markets.map((market) => ({
    id: `deck_${market.id}`,
    marketId: market.id,
    createdAt: at,
    lastRefreshedAt: null,
  }));
  const cards = decks.map((deck, index) => ({
    id: `card_${index}`,
    deckId: deck.id,
    companyId: company.id,
    cardType: index ? 'infrastructure' : 'company',
    title: null,
    summary: null,
    tier: null,
    tierReason: null,
    createdAt: at,
    displayMetadata: { historicalState: 'saved', nested: { unchanged: [index, null] } },
  }));
  const riskCard = {
    ...cards[0]!,
    id: 'card_risk',
    cardType: 'vice',
    title: 'Attributed synthetic risk',
    summary: 'Synthetic allegation, not an endorsed finding.',
  };
  const metric = {
    id: 'metric_a',
    companyId: company.id,
    metricType: 'arr',
    value: 0,
    confidence: 'user_verified',
    source: 'https://fixture.example/report',
    methodNote: 'Imported wording remains historical only.',
    capturedAt: at,
    period: 'FY2025',
    conflictHistory: [
      {
        period: 'FY2024',
        observations: [{ value: 12, confidence: 'estimated', source: null, capturedAt: at }],
        metadata: { preserve: ['unknown', { level: 2 }] },
      },
    ],
  };
  const source = {
    ...(schemaVersion === undefined ? {} : { schemaVersion }),
    markets,
    decks,
    companies: [company],
    metrics: [metric],
    cards: [...cards, riskCard],
    viceClaims: [
      {
        id: 'vice_a',
        cardId: riskCard.id,
        claimText: 'Synthetic attributed allegation.',
        sourceUrl: 'https://fixture.example/news',
        capturedAt: at,
        state: 'unresolved',
        metadata: { historicalStatus: 'reported' },
      },
    ],
    dashboards: {
      co_shared: {
        overview: {
          content: { prose: 'Saved synthetic dashboard text.', opaque: { keep: true } },
          lastRefreshedAt: at,
        },
        metrics: {
          content: { selectedPeriod: 'FY2025', nested: ['unchanged'] },
          lastRefreshedAt: at,
        },
      },
    },
    companyMarket: { co_shared: 'Synthetic Market a' },
    reports: [
      {
        id: 'report_a',
        kind: 'deck',
        subjectId: decks[0]!.id,
        title: 'Synthetic saved report',
        markdown: 'Original report body with exact whitespace.\n\nKeep this text.',
        citations: [],
        createdAt: at,
        savedState: { status: 'completed', priorRevision: 3 },
      },
    ],
    briefings: [
      {
        id: 'brief_a',
        marketId: markets[0]!.id,
        deckId: decks[0]!.id,
        marketName: markets[0]!.name,
        generatedAt: at,
        windowHours: 24,
        headline: 'Synthetic saved briefing',
        updates: [],
        insights: [],
        retainedWindow: { start: 'FY2025-Q1', end: 'FY2025-Q2' },
      },
    ],
    savedCards: [{ cardId: cards[0]!.id, savedAt: at, note: { text: 'Synthetic save' } }],
    opportunity: {
      mkt_a: {
        markdown: 'Original synthetic opportunity analysis.',
        citations: [],
        at,
        retainedState: { period: 'FY2025', nested: { source: 'offline' } },
      },
    },
    researchJobs: [
      {
        id: 'job_running',
        status: 'running',
        stage: 'metrics',
        brief: { prompt: 'Synthetic fixture job', region: null, metadata: { original: true } },
        catalogNames: ['Synthetic Fixture Labs'],
        completedEntityNames: [],
        partialCards: [
          {
            card: {
              ...cards[0]!,
              id: 'card_partial',
              deckId: 'deck_partial',
              companyId: 'co_partial',
            },
            company: { ...company, id: 'co_partial', legacyPartial: { nested: ['not committed'] } },
            metrics: [
              { ...metric, id: 'metric_partial', companyId: 'co_partial', period: 'FY2025-Q2' },
            ],
            viceClaims: [],
            nestedPartialResult: {
              phase: 'metrics',
              payload: { retained: [false, { untouched: true }] },
            },
          },
        ],
        market: { ...markets[0], id: 'mkt_partial', partialMarker: 'job-only' },
        deck: { ...decks[0], id: 'deck_partial', marketId: 'mkt_partial' },
        warnings: ['Synthetic unfinished job'],
        error: null,
        createdAt: at,
        updatedAt: at,
        progressMetadata: { received: 1, expected: 3, unknown: { retain: true } },
      },
    ],
    threads: [
      {
        id: 'thread_a',
        scope: { kind: 'deck', deckId: decks[0]!.id },
        title: 'Synthetic saved thread',
        messages: [{ id: 'message_a', role: 'assistant', text: 'Synthetic answer.', at }],
        reportId: 'report_a',
        createdAt: at,
        updatedAt: at,
        threadMetadata: { state: 'saved', nested: { preserve: 9 } },
      },
    ],
  };
  return source;
}

export function minimalLegacyJobFixture(schemaVersion: 1 | 2 = 1) {
  return {
    schemaVersion,
    markets: [],
    decks: [],
    companies: [],
    metrics: [],
    cards: [],
    researchJobs: [{ id: 'job_old', status: 'running' }],
  };
}
