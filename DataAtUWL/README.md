# Data @ UWL — series site

Live at **https://datascienceuwl.github.io/DataAtUWL/**

A single static page. No build step, no dependencies, no framework. Edit, commit,
push; GitHub Pages redeploys in about a minute.

## Adding a talk

1. Open `talks.js` and copy the commented example block into the `TALKS` array.
2. Fill in the fields. Dates are local time, `"YYYY-MM-DDTHH:MM"`, no timezone suffix.
3. Drop the poster into `posters/` and point `poster:` at it, or set `poster: null`
   until the poster is ready.
4. Commit and push.

Order in the array doesn't matter — the page sorts by date. You never edit
`index.html` or `styles.css` to add a talk.

## What the page does automatically

- **Features the next upcoming talk.** Once its end time passes, the next one
  takes over. When nothing is upcoming, it features the most recent past talk.
- **Splits Upcoming / Past** from the same data; past talks list newest first.
- **Prev / next** steps through every talk chronologically (arrow keys work too).
- **Permalinks:** each talk has a stable URL — `.../DataAtUWL/#/2026-09-17-hedgehog`.
  Use these in Canvas announcements and emails. Once you've shared an `id`, don't
  change it.
- **Add to calendar** generates an `.ics` download, shown only for upcoming talks.

## Files

| File | What it's for |
| --- | --- |
| `talks.js` | **The only file you normally edit.** Series info + the talk list. |
| `index.html` | Page structure and the rendering script. |
| `styles.css` | Styling. Palette matches the printed poster. |
| `posters/` | One poster per talk (SVG, or PDF if you'd rather). |
| `assets/` | Series wordmark and favicon. |

## Identity

Navy `#0B2342`, aqua `#16B9BE`, burgundy `#8A1538`, warm white `#FFFDFC`.
Headings Arial/Helvetica heavy; speaker names and the `@` in Georgia. These match
`Data-at-UWL_poster-template.svg`, so the page and the printed poster read as one
thing. The colors live in `:root` at the top of `styles.css`.

No official UW-La Crosse mark is used, so the series mark stands on its own
without implying trademark approval. Add a university mark only after checking
current UWL brand requirements.

## Previewing locally

```bash
python -m http.server 8899
```

Then open <http://localhost:8899/>. Opening `index.html` directly from the
filesystem works in most browsers, but a server is closer to how Pages serves it.

## Source material

Posters, the editable template, the speaker tracker, and printing instructions
live in OneDrive under **Data at UWL**. The posters in `posters/` here are copies
for the web; OneDrive holds the masters.
