# Optional research lanes — run guide

Two free, self-hosted lanes make Stratemark faster and cheaper. Both are
**feature-detected, never required**: when a container isn't running the app
probes once, remembers for a few minutes, and falls back to the standard
grounded path. Absence is reported honestly in the lane harness — it is a
decision, not a failure.

```
cd packages/research
LIVE_LANES=1 npx vitest run src/bench/live-lanes.run.test.ts   # shows lane health
```

## SearXNG — free discovery

When healthy, hunt discovery queries SearXNG's JSON API instead of spending a
grounded provider call on search. Probe: `GET http://localhost:8888/health`
(memoized ~5 min).

```bash
docker run -d --name searxng -p 8888:8080 searxng/searxng:latest
# The JSON API must be enabled (disabled by default upstream):
docker exec searxng sh -c "sed -i 's/- html/- html\n    - json/' /etc/searxng/settings.yml"
docker restart searxng
```

Keep it localhost-only (the default `-p 8888:8080` binds all interfaces on some
Docker versions — prefer `-p 127.0.0.1:8888:8080`).

## Crawl4AI — JS-heavy page reader

Second-chance reader: when a normal fetch returns blocked/unavailable or a
suspiciously thin JS shell, the node reader retries once through a running
Crawl4AI server (rendered markdown). Probe: `GET http://127.0.0.1:11235/health`.

```bash
docker run -d --name crawl4ai -p 127.0.0.1:11235:11235 crawl4ai/crawl4ai:latest
```

The retry is bounded (~30s) and routed through the same SSRF/DNS policy as
every other read. Without the container, page reads behave exactly as before.

## What the app does with each state

| Lane state | Discovery | Page reads |
|---|---|---|
| Container running | Free SearXNG notes replace grounded search | Crawl4AI second chance for blocked/JS pages |
| Container absent | Grounded search (existing behavior) | Existing behavior, zero extra cost |

Both lanes feed the same acceptance gates as every other source — a figure only
lands when a retained, quotable original supports it. The containers change
where evidence comes from, never whether it counts.
