# Half Full logo

**Idea:** every goal is a glass that fills, so the symbol is that glass with water rising to a gentle waterline, and the u in "Full" holds the same water.

## Colours
| Use | Light ground | Dark ground |
|---|---|---|
| Ink (glass outline, lettering) | #16201a | #e7ece9 |
| Water | #4e9aa7 | #5aa9b5 |
| Water surface | #86c0c8 | #93cdd5 |
| Glass tint | ink at 6% opacity | ink at 6% opacity |
| Icon plate (favicon, app icons) | #eef2ef | #1b2220 |

Note: the teal water sits close to the Work area (#14717f / #5cc3d1). Your brief says no single area hue should lead. If that becomes a problem, change the water colour: it's one hex value per file. `mark-mono.svg` has no colour at all.

## Files
- `mark.svg`, `mark-dark.svg`: the full-colour symbol, for 32 px and up.
- `mark-small.svg`, `mark-small-dark.svg`, `mark-small-mono.svg`: a pixel-aligned 16-grid symbol, for 16 to 24 px.
- `mark-mono.svg`: one colour via `currentColor`; inline it and it follows the text colour.
- `favicon.svg`: the small symbol on a #eef2ef plate, so it reads on both light and dark tab strips. `favicon-dark.svg` uses a dark #1b2220 plate.
- `wordmark-light/dark.svg`: stacked "Half / Full". `wordmark-inline-light/dark.svg`: one line.
- `lockup-stacked-light/dark.svg`: symbol and stacked wordmark. `lockup-horizontal-light/dark.svg`: symbol and one-line wordmark, for the top bar.
- `app-icon-512.png`, `app-icon-192.png` (rounded plate), `apple-touch-icon-180.png` (full square; iOS rounds the corners), `maskable-512.png` (the glass sits inside the central 80% circle). Each also has a `-dark` version on a #1b2220 plate.
- `preview.png`: the symbol at 16 to 512 px on both grounds, plus the tab and top-bar mocks.

## Minimum sizes
- `mark.svg`: 32 px. Below that, use `mark-small.svg` or `favicon.svg` (16 to 24 px).
- `lockup-horizontal`: 20 px tall. Stacked wordmark or lockup: 32 px tall. Inline wordmark: 12 px tall.

## Clear space
Keep clear space on every side equal to half the cap height of "H" in the wordmark. For the symbol on its own, that's a quarter of the glass height.

## Lettering
Inter Display Bold, outlined to paths. The u is a custom drawn glass. No font is needed.
