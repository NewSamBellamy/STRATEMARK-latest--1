# Share links

Sharing is one button. **Share & export → Share link → Create link** (or the share icon on a card) makes a
short link, like `https://<worker>/s/Udd5ybWrx30g9ZXs`, to a read-only copy of that card or deck with its
research. Paste it into Telegram, Slack, Discord, WhatsApp, iMessage or email and it shows the title, a line
of description and a picture of the card or the deck. Anyone can open it on a phone or a laptop with no
account; nothing new is researched when it is opened; every figure keeps its source. A quiet "Want to
research more companies? Sign up" sits at the bottom.

## What happens

1. Press **Create link**. Nothing is uploaded before this. A card first re-checks any figure that has not been
   verified, so the copy carries the reconciled figures.
2. The browser reads the stored research (`exportShareSnapshot`: the card or deck, its companies, source-bound
   figures, and each stored dashboard tab as the dashboard shows it; never chats, notes, saved flags, reports
   or the evidence vault), packs it (deflated JSON), draws the preview picture, and sends both to the share
   Worker (`services/stratemark-api`, see its README).
3. The Worker keeps it for 90 days under a random 96-bit id and answers the link. An unchanged deck reuses its
   link instead of uploading again.
4. The link opens `https://<worker>/s/<id>`: chat apps read the preview tags from that page (no script, not
   indexable); a browser is sent on to the viewer, `share.html?s=<id>` on the app's own address, which fetches
   the research by id and runs the real card, deck and dashboard screens read-only.
5. **Stop sharing** (in the same dialog) deletes the copy and the link stops working at once. The token that
   allows it stays in the browser that made the link. A link also stops by itself after 90 days.

Where there is no Worker (the desktop app, a build with no `VITE_STRATEMARK_API_URL`), and for briefings and
reports, the dialog offers the **private link**: the whole research travels inside the address, nothing is
uploaded, and it is too long to paste into most chat apps (the dialog says so). In the hosted dialog it is
one click away: "Use a private link instead".

## What is kept, and what a visitor can reach

- The Worker keeps the packed research and the picture, nothing else, for 90 days (`SHARE_TTL_DAYS`). It
  never opens or parses the research. This is the one thing the hosted beta stores; the dialog and the beta
  page say so. Anyone who holds a link can read its copy, so the link is only as private as where it is pasted.
- Limits per UTC day: 20 shares and 40 MB per visitor, 3,000 shares in all; a share is at most 2 MB packed
  (an 18-company deck is about 180 KB).
- **A visitor's settings stay theirs.** The viewer's first code blocks all browser storage (reads come back
  empty, writes go nowhere, except the light/dark choice), so a share opened in a browser that also holds
  someone's Stratemark settings, an API key included, never sees or uses them.
  (`features/share/viewer/guard.ts`)
- **No calls from the page's code** except to its own address, to the public reference sources the screens
  read for portraits and founding years (Wikipedia, Wikidata, Wikimedia), and one `GET` of this share by its id
  from the share Worker (the id's exact shape, `GET` only, nothing else the Worker serves). Pictures the page
  shows as images (page captures, publisher pictures, favicons) load from their public sources, which see the
  viewer's address as with any web page.
- **A signal card (culture, risk, insight, barrier) never borrows a company**: no company name, figures or tabs
  travel with it, and its preview picture does not draw them.
- **The preview picture shows what the card face shows**: a verified figure with a source, or one a person
  confirmed. Estimates are not drawn.
- **Tabs that were never researched are not offered**, and say so if opened by address.
- A link that was stopped or has expired says so plainly. A copy that cannot be read says so too.

## Host it yourself (optional)

**Share as a page → Download the page (.zip)** (in the private-link dialog) builds one static page with the
research inside, for anyone who wants to host a share on their own address instead of Stratemark's Worker. The
zip holds `firebase.json`, `README.txt`, `<id>/index.html` (the viewer with the card or deck embedded) and
`<id>/og.png` (the picture chat apps show, 1200 x 630). Type the address you will host it at into the dialog
first: chat apps need the full address to show the picture. Publish with
`firebase deploy --only hosting` from the unzipped folder after `firebase login` and `firebase use <project>`.
To add another share, unzip it into the same folder and deploy again. A page like this never contacts
Stratemark at all.

## How it is built

- `vite build --mode share` builds `share.html`, a single self-contained viewer, next to the app in `dist/`.
  `pnpm build` runs it after the normal build. A hosted link reads its research by id; a downloaded page has it
  embedded in its `stratemark-share-data` element. The viewer (`apps/web/src/features/share/viewer`) runs the
  real screens on a read-only repository (`createShareRepository` in `@mi/mocks`) with `ReadOnlyProvider` on, so
  controls that research, ask, save, share or change are not shown.
- The Worker side is `services/stratemark-api/src/share-policy.ts` (the rules, unit tested),
  `share-vault.ts` (storage), and the routes in `index.ts`. `scripts/share-smoke.mjs` makes a real share on a
  running Worker, reads it back every way a visitor or a chat app would, stops it, and checks the refusals.
- Shared packing: `apps/web/src/lib/share/wire.ts` (the format), `hostedShare.ts` (create, stop, and the list of
  links made from this browser).

## Known limits

- The viewer page is about 4 MB (about 1.1 MB compressed): it carries the whole app screens.
- Sharing as a page needs a built app (`pnpm build`) or the packaged app; the dev server cannot make a
  self-contained page.
- The desktop app does not make hosted links or build the page yet.
- The sign-up link defaults to `https://getstratemark.com`; the page builder takes any https address.
- Share links are `https://<worker>.workers.dev/s/<id>` until the owner points a domain at the Worker
  (`SHARE_PUBLIC_BASE`).
