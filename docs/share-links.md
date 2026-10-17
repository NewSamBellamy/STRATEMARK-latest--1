# Share links

A share is one static page: the real card, deck and company dashboard screens,
read-only, with the research inside the page. Nobody needs an account to open
it, nothing new is researched, and the page never contacts Stratemark or a
model service. (It may still fetch public pictures such as Wikipedia portraits
and page captures from their public sources.)

## Making one

In the app, open **Share & export → Share link** on a deck, or the share icon on
a card, then **Share as a page → Download the page (.zip)**.

The zip holds:

```
firebase.json        hosting settings (unlisted pages, not indexed by search engines)
README.txt           the one command below
<id>/index.html      the page: the viewer with the card or deck embedded
<id>/og.png          the picture chat apps show when the link is pasted (1200 x 630)
```

`<id>` is a random 12-character name. The link is the only way in, so it cannot be guessed.

Type the address you will host it at (for example `https://share.example.com`)
into the dialog first. Chat apps need the full address to show the preview
picture; without it the page still works, just without a picture.

## Publishing (needs the owner's Firebase login)

```bash
firebase deploy --only hosting
```

Run it from the unzipped folder, after `firebase login` and `firebase use <project>`
once. To add another share, unzip it into the same folder and deploy again. The
link is `<your address>/<id>/`.

## How it works

- `vite build --mode share` builds `share.html`, a single self-contained page,
  next to the app in `dist/`. `pnpm build` runs it after the normal build.
- The dialog asks the repository for a `ShareSnapshot` (`exportShareSnapshot`): the card or
  deck, its companies, source-bound figures and each stored dashboard tab as the
  dashboard shows it. It reads stored research only and never starts research.
  Chats, notes, saved flags, reports and the evidence vault are not included.
- The snapshot is embedded in the page's `stratemark-share-data` element. The viewer
  (`apps/web/src/features/share/viewer`) runs the real screens on a read-only
  repository (`createShareRepository` in `@mi/mocks`) with `ReadOnlyProvider` on, so
  controls that research, ask, save, share or change are not shown.
- The preview tags (title, description, picture, `noindex`) are written into the page head at export time.

## What a share can and cannot touch

- **Your settings stay yours.** The page's first code blocks all browser storage
  (reads come back empty, writes go nowhere, except the light/dark choice), so a
  share opened in a browser that also holds someone's Stratemark settings, an API
  key included, never sees or uses them. (`features/share/viewer/guard.ts`)
- **No calls from the page's code** except to its own address and to the public
  reference sources the screens read for portraits and founding years (Wikipedia,
  Wikidata, Wikimedia). The hosted Stratemark Worker is never used in a share build,
  whatever the build was configured with. Pictures the page shows as images (page
  captures, publisher pictures, favicons) load from their public sources, which see
  the viewer's address as with any web page.
- **A signal card (culture, vice, insight) never borrows a company**: no company
  name, figures or tabs travel with it, and its preview picture does not draw them.
- **The preview picture shows what the card face shows**: a verified figure with a
  source, or one a person confirmed. Estimates are not drawn.
- **Tabs that were never researched are not offered**, and say so if opened by address.

## Known limits

- The page is about 4 MB (about 1.1 MB compressed): it carries the whole app screens.
- Sharing needs a built app (`pnpm build`) or the packaged app; the dev server cannot make a self-contained page.
- The desktop app does not build the page yet (the file loads from the app bundle).
- The sign-up link defaults to `https://getstratemark.com`; the page builder takes any https address.
