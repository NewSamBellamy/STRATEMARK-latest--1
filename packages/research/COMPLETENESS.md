# Deck completeness scoreboard

`buildCompletenessReport(snapshot)` (in `src/completeness-report.ts`, exported from
`@mi/research`) scores every entity company in every deck of a saved research
snapshot. Each slot comes out as one of:

| Mark | Status | Meaning |
|---|---|---|
| `#` | `filled` | The user sees a value. |
| `o` | `unknown_attempted` | Empty, and the snapshot shows research tried it. |
| `.` | `unknown_never_attempted` | Empty, and nothing in the snapshot ever tried it. |

The slots are identity (website, HQ, founded), description, the metric slots
for the company's market profile (`PROFILE_CORE_SLOTS[classifyMarketProfile(company)]`,
the same table the card face renders, so an asset manager gets AUM), team,
history, products and news. A metric slot counts as filled only if the
displayed facts fill it (`displayedCompanyFacts`, the same read path as
`getCompanyFacts`). A figure that is stored but refused by that path is
reported as `withheld`.

Each slot also lists its receipts: original-source attempts and page reads by
outcome (retrieved / blocked / unavailable), retained research-evidence
records, a cached dashboard tab, and stored ledger rows. It also says whether
any attempt was **targeted** at the slot or only came from a broad pass
(`company_profile`, `metrics_hunt`, `verify:batch`).

The report also flags data-integrity smells:

- a stored figure with no citations;
- `verified` without a verification-grade citation;
- `unknown` that still stores a value;
- an estimated figure with no as-of date;
- the same figure on two companies in one deck;
- a description that opens with a sales verb or has a space before punctuation;
- HQ formats that differ within a deck.

## Run it

```bash
pnpm --filter @mi/research completeness <snapshot.json>                  # table
pnpm --filter @mi/research completeness <snapshot.json> --json report.json
pnpm --filter @mi/research completeness <snapshot.json> --json -        # JSON only
pnpm --filter @mi/research completeness <snapshot.json> --deck <deckId>
pnpm --filter @mi/research completeness repo.json --originals <dir>     # desktop, see below
```

Relative paths resolve against the directory you ran `pnpm` from. The command
is read-only and makes no network calls.

## Export a snapshot

### Web app (browser-live mode, any build)

**Settings → Data controls → Export my research** downloads
`stratemark-research-YYYY-MM-DD.json`. That file is the committed snapshot.

From the DevTools console on the app's origin, this works on any build,
including production:

```js
const db = await new Promise((ok, no) => { const r = indexedDB.open('stratemark.vault', 2); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const rec = await new Promise((ok) => { const g = db.transaction('snapshots').objectStore('snapshots').get('mi.repo.v1.committed'); g.onsuccess = () => ok(g.result); });
copy(rec.json); // DevTools helper: the snapshot JSON is now on the clipboard
```

On the Vite dev server only, you can import the source module:

```js
const m = await import('/src/lib/repository/browserResearchStore.ts');
copy((await m.readBrowserResearchData()).current);
// equivalent: (await (await import('/src/lib/repository/vault.ts')).vaultGet('mi.repo.v1.committed')).json
```

The IndexedDB record is `{ json, revision, at }`. The CLI accepts either that
wrapper or the bare snapshot. Older workspaces may only have the legacy
`localStorage['mi.repo.v1']`.

In the browser, retained original-source reads are stored *inside* the snapshot
(`originalSourceAttempts`), so attempts are counted with no extra step.

### Desktop app (Electron)

**Settings → Data controls → Export my research** gives the same snapshot. The live
file is `<userData>/research/repo.json`, where `<userData>` is:

- `%APPDATA%\Stratemark` on Windows
- `~/Library/Application Support/Stratemark` on macOS
- `~/.config/Stratemark` on Linux

Development previews started with `--preview-data-dir=<dir>` use `<dir>` instead.

On desktop, retained original-source reads are **not** in the snapshot. They
are separate files in `<userData>/original-sources/*.json`. Pass that directory
with `--originals`, or every page read is missing from the receipts and more
slots show as "never attempted" than is true:

```bash
pnpm --filter @mi/research completeness "%APPDATA%/Stratemark/research/repo.json" --originals "%APPDATA%/Stratemark/original-sources"
```

## Caveats

- **Founded** reads the cached History tab: the earliest dated event that
  describes a founding, using the same rule as the dashboard header's
  `foundedYear`. The live header can also show a Wikidata year, which is
  fetched at view time and never stored. So "founded: unknown" here can still
  render a year in the app.
- Team, history, products and news count cached dashboard rows. The tab
  renderer may hide some of those rows further, for example people with no
  retained support.
- The Live Intel tab is the only stored news. If it was never opened, `news`
  shows as never attempted.
