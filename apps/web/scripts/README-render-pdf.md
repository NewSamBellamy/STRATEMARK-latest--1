# render-pdf

Renders the print report (the browser's own print of `PrintDocument.tsx` + `print.css`) of the sample deck to PDF, then rasterises every page to PNG.

```
pnpm --filter @mi/web render:pdf -- --kind deck|company [--port 4410] [--offline] [--letter] [--out <dir>]
```

Output: `apps/web/pdf-shots/<kind>/page-01.png ...` (about 110 dpi) plus `report.pdf`. The folder is gitignored.

- Starts its own vite dev server (`VITE_OPEN_ACCESS=true`, first free port from `--port`) and stops it by process id when done.
- `--offline` blocks Google Fonts so the fallback fonts are visible.
- `--letter` sets the browser locale to en-US (US Letter-style formatting).
- `--kind company` opens OpenAI's company dashboard and exports "Company report".

Gotchas

- Git Bash rewrites `/#/...` arguments: set `MSYS_NO_PATHCONV=1` if you pass routes through a shell.
- No system PDF rasteriser is needed or used: pdf.js (from the `unpdf` devDependency) runs in a second Playwright page.
- The sample deck is seeded by opening it from `/#/history` first, as the e2e specs do.
- Failures print `render-pdf: <reason>` (plus the dev server tail) and exit non-zero.
