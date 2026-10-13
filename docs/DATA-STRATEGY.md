# Data strategy: what to collect, in what order, and how to be the best and cheapest

Written 2026-10-13 from a first pass of public search results. **Every price below is a
third-party estimate** (vendors mostly do not publish them) and must be confirmed with the
vendor before any decision. Nothing here was hands-on: no trial accounts were opened.

## What the incumbents sell, and what they cost (estimates)

| Product | Strength | Rough price |
|---|---|---|
| Bloomberg Terminal | Everything for listed companies, news, chat, execution | ~$24k-32k per seat per year |
| PitchBook | Private-company deals, funds, cap tables | ~$25k-40k per team per year; API $70k+ |
| CB Insights | Private-company intelligence, market maps | ~$40k-100k per team per year |
| Harmonic / Tracxn / Dealroom | Startup discovery and tracking | ~$6k-30k per year; Dealroom has a free tier |
| Crunchbase Pro | Broad startup profiles | ~$29-99 per month |
| Koyfin | Listed-company fundamentals, charts | free tier; $39-110 per month |
| Finviz / TradingView | Screeners, charts, listed-company stats | free; ~$40 per month paid |
| Sacra | Deep written reports on private companies | paywalled; price not confirmed |

Listed-company data APIs (what a cheap competitor builds on): Financial Modeling Prep
(free 250 calls/day, then ~$22-59 per month), EODHD (~$20 per month), Alpha Vantage (free 25
calls/day), Polygon/Massive (~$29-199 per month). Free tiers are usually non-commercial.

Sources: [PitchBook vs Tracxn](https://www.cbinsights.com/compare/pitchbook-data-vs-tracxn),
[startup database comparison](https://bouncewatch.com/blog/startup-analysis/startup-database-comparison-2026),
[private-data pricing](https://multiples.vc/compare/pricing),
[Koyfin / YCharts pricing](https://costbench.com/compare/koyfin-vs-ycharts/),
[Bloomberg functions](https://lerner.udel.edu/seeing-opportunity/bloomberg-functions-list),
[API pricing roundup](https://multiples.vc/compare/api-pricing).
Third-party figures conflict (for example founding years and revenue for the same company
differ across providers), which is itself the opening: show the source and the confidence.

## What to grab, in order

Each step is cheap before the next, and each step makes the card and dashboard better.

1. **Identity** (free, official): legal name, legal form, incorporation date (the *founded*
   year), HQ, website, public or private, ticker. Sources: Wikidata, GLEIF, OpenCorporates /
   national registries (Companies House, Brreg and similar are already partly wired), SEC.
2. **Size** (card face): employees, revenue, valuation or market cap, users. Listed: SEC
   XBRL and a quote lane (both already free in the app). Private: grounded search with the
   source-binding check that now exists.
3. **Money**: funding rounds and lead investors (private), full statements (listed:
   EDGAR XBRL, or a ~$22 per month API for global coverage).
4. **People**: leadership and board. Listed: proxy statements and Form 4. Private: grounded
   search, gated against the notes.
5. **Products and customers**: product pages and filings; customer lists only when the
   company states them.
6. **News and signals**: dated news feed, regulatory actions, hiring. Keep the free feed
   first; grounding only for what the feed misses.
7. **Ownership and cap table**: 13F and 13D/G (free from EDGAR) for listed; for private,
   only what is reported.
8. **Competitors and market share**: from the deck itself (done), then reported share.

## How to be the best and the cheapest

- Be **the only one that shows where every figure came from and how sure we are**
  (verified / estimated / unknown). Incumbents show one number; sources disagree.
- Cover **companies the terminals cover badly** first: private AI labs, young startups,
  niche markets, with a deck per market rather than one company at a time.
- Price: a free tier on the cheap lanes (EDGAR, Wikidata, registries, quote lane), and charge
  for grounded research volume. A ~$20-60 per month plan is two orders of magnitude under
  PitchBook and Bloomberg.
- Do not license expensive private datasets yet. Add a paid API only where a free lane
  cannot reach (global listed fundamentals first: one ~$22 per month API).

## Where the AI money goes (and what to change)

Search grounding, not the model, is the cost. The Worker's own price table charges
$0.035 per grounded prompt (conservative; $14 per 1,000 queries on newer models) while
Flash-Lite tokens are cents per million. The cheap model is not the problem.
Rough estimate from the code, not from billing: a 17-company deck makes ~80-100 grounded
calls (discovery, batch hydration, two face-hunt passes, batch verification, overview warm-up)
or about $3 per deck, and each company dashboard opened adds ~8 more (~$0.30). A week of
live testing (many decks, repeated runs) therefore reaches tens of dollars quickly.

Biggest levers, in order:
1. Cache research per company across decks (the same company in two decks is researched twice).
2. Warm only the lead company's overview; leave other tabs to when a reader opens them.
3. Run the free lanes (EDGAR, Wikidata, registries, quote lane) before any grounded pass.
4. Make the second face-hunt pass and batch verification conditional on a gap still existing.
5. Keep the per-day cap in the Worker (`DAILY_BUDGET_USD`, now 100; per visitor 20).

## TradingView and Bloomberg: what their company pages hold, and our gaps

Second pass, from vendor help pages and library guides (still no hands-on accounts). What
could not be confirmed is marked; do not treat unconfirmed names as fact.

| Their section | What it holds | Our equivalent today | Gap and cheapest fix |
|---|---|---|---|
| TradingView Overview / Statistics | Key ratios, price, market cap, headline stats | Card face and Overview key figures | Fine for private companies; for listed ones add a quote lane stat strip (already have the quote lane) |
| TradingView Financials | Statements, quarterly or annual toggle, expandable line items, revenue breakdown | Metrics tab, SEC annual revenue series | Add quarterly points and a segment revenue split from EDGAR XBRL (free) |
| TradingView Earnings / Dividends | Reported vs estimated, dates | none | Earnings dates and surprises from EDGAR 8-Ks; skip estimates (paid) |
| TradingView Technicals / Seasonals | Chart signals | none | Out of scope: we are a research product, not a trading one |
| Bloomberg DES | Business description, snapshot of fundamentals, management, price chart, estimates | Overview, Team | Match already; add the founded year (done) and legal entity from registries |
| Bloomberg ownership (HDS / OWN; the exact code varies by guide) | Who owns the stock, institutional share | Governance investors | Free for listed companies from 13F and 13D/G; for private, only what is reported |
| Bloomberg CF | Company filings | none | A Filings link to EDGAR for listed companies (cheap, high value) |
| Bloomberg peers and supply chain (relative-value and supply-chain functions; names unconfirmed) | Comparable companies, suppliers and customers | "How they compare" table (deck peers) | Add reported customers and suppliers as a labelled list |

Ranked next steps by value for effort: (1) EDGAR filings link and ownership for listed
companies, (2) legal-entity and incorporation date from registries to confirm the founded
year, (3) quarterly revenue and segment split, (4) reported customers and suppliers.
Sources: [TradingView financials tab](https://www.tradingview.com/blog/en/new-and-improved-financials-tab-36524/),
[TradingView features](https://www.tradingview.com/features/),
[Bloomberg guide (NYPL)](https://libguides.nypl.org/BloombergTerminal/publiccompanies),
[Bloomberg guide (Columbia)](https://guides.library.columbia.edu/bloomberg/basic),
[Babson Bloomberg equity valuation guide](https://www.babson.edu/media/babson/assets/cutler-center/Equity-Valuation-using-Bloomberg.pdf).
