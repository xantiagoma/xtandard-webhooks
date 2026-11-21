# Brand

The xtandard-webhooks mark is the family's lime **X** — a `>` chevron and two arms between grey
angle brackets — whose upper-right arm narrows into the stem of a **hook** and ends in its eye: the
thing a webhook is hung on, and the glyph of the original raster logo. It comes as an app icon, a
bare mark and wordmark lockups. Everything
lives in [`docs/assets/`](assets/); the SVGs are the masters and every PNG and ICO is built from them.

It belongs with its siblings: the near-black rounded tile, the orbit lines, the grey brackets and the
lime X are shared with `@xtandard/flags` (a flag on the arm), `@xtandard/entitlements` (a gauge),
`@xtandard/links` (a chain link) and `@xtandard/audit` (a shield); the layout of the lockups and the
social card follows `xtandard-image`'s kit. The hook is what makes it this project.

## Files

Everything users see as an icon or a logo is an SVG, and **no page shows the tile** (the rounded
square behind the mark): the README header and the docs-site navbar use the horizontal lockups, the
docs-site hero the stacked lockups, and the admin UI the bare symbol, each in its light or dark
variant. The tile survives only where an app-icon shape is expected: the favicon set
(`favicon.svg`, `favicon.ico`, `apple-touch-icon.png`) and the social card. Rasters exist only
where a format requires one and nobody sees them as a page icon: the social card (`og:image` must
be a raster) and the `apple-touch-icon` and `favicon.ico` fallbacks in `<head>`.

| File                                                   | What it is                                                               | Use it for                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `logo.svg`                                             | App icon: the mark on a near-black rounded square with faint orbit lines | Square avatar slots only (the GitHub repo picture, registries that take an SVG); never shown on a page |
| `symbol.svg`                                           | The mark with brackets, transparent, lime for dark surfaces              | Inline UI on dark surfaces (the admin header in the dark theme)                                        |
| `symbol-light.svg`                                     | The mark with brackets, transparent, the light lockup's deeper lime      | Inline UI on light surfaces (the admin header in the light theme)                                      |
| `lockup-horizontal-dark.svg`                           | Mark + wordmark, `xtandard-` in near-white                               | Headers on dark backgrounds (README in GitHub dark mode, the docs site in dark mode)                   |
| `lockup-horizontal-light.svg`                          | Mark + wordmark, `xtandard-` in ink, deeper lime                         | Headers on light backgrounds (README in light mode, the docs site in light mode)                       |
| `lockup-stacked-{dark,light}.svg`                      | Mark left, `xtandard-` over `webhooks`                                   | The docs site's home hero (light/dark), slides, sidebars                                               |
| `monochrome-white.svg`, `monochrome-black.svg`         | One-colour horizontal lockup                                             | Photos and busy backgrounds (white); print (black)                                                     |
| `favicon.svg`                                          | The icon without orbit lines and shadow, which do not survive 16 px      | Browser tabs: the admin UI and the docs site                                                           |
| `favicon.ico` (16/32/48), `apple-touch-icon.png` (180) | Rasters of `favicon.svg`                                                 | `<head>` fallbacks only: browsers without SVG favicons, iOS home screens                               |
| `social.svg`, `social.png` (1280×640)                  | Social card: icon, wordmark, tagline, `bun add` line                     | GitHub social preview (Settings → Social preview, uploaded by hand), `og:image` of the docs site       |

Rebuild after editing:

```sh
sh scripts/brand-assets.sh   # SVG masters + the few rasters + the served copies
```

It needs `bun`, `hb-view` (HarfBuzz), `rsvg-convert` (librsvg) and `magick` (ImageMagick 7), and
uses `oxipng` when installed. Urbanist is downloaded from google/fonts into
`~/.cache/xtandard-webhooks-brand` (or set `URBANIST=/path/to/Urbanist[wght].ttf`); it is never
committed. `scripts/brand-svg.ts` holds the geometry (one 1024-unit grid) and shapes the wordmark
with HarfBuzz; `scripts/brand-assets.sh` runs it, renders `social.png`, `apple-touch-icon.png` and
`favicon.ico`, and copies `favicon.svg`, `favicon.ico`, `apple-touch-icon.png` and `social.png` to
`site/public/`, and the favicon set, `symbol.svg` and `symbol-light.svg` to `src/ui/public/` (the
admin UI bundle).

### Where each file goes

- **README header**: a `<picture>` choosing `lockup-horizontal-dark.svg` / `lockup-horizontal-light.svg`
  with `prefers-color-scheme`, by absolute `raw.githubusercontent.com` URL (the README ships to npm,
  which does not ship `docs/`).
- **Docs site**: the horizontal lockups as the Starlight logo (light/dark), `favicon.svg` +
  `favicon.ico` + `apple-touch-icon.png`, and `social.png` as `og:image`.
- **Docs site home**: the stacked lockups as the hero image (`lockup-stacked-light.svg` in the light
  theme, `lockup-stacked-dark.svg` in the dark one).
- **Admin UI**: the favicon set in `index.html`, and the bare symbol (`symbol-light.svg` in the light
  theme, `symbol.svg` in the dark one, no tile) before the default title in the
  standalone panel's header. A custom `title` or `logoUrl`, the customer portal and the React embeds
  stay unbranded: they carry the host's brand, not ours.

## Palette

Lime on charcoal, as in the family. Lime is an artwork colour on dark surfaces; on white use the
deeper lime for text.

| Token          | Hex       | Role                                                      | Contrast on white / on ink |
| -------------- | --------- | --------------------------------------------------------- | -------------------------- |
| `xe-lime-hi`   | `#D9F99D` | Top-left of the mark gradient, the social-card tagline    | 1.18 / 15.9                |
| `xe-lime`      | `#A3E635` | The mark, accents and links on dark surfaces              | 1.55 / 12.1                |
| `xe-lime-deep` | `#65A30D` | Bottom-right of the mark gradient                         | 2.9 / 6.5                  |
| `xe-lime-text` | `#4D7C0F` | Accent text and the wordmark's end on light surfaces (AA) | 5.0 / 3.8                  |
| `xe-ink`       | `#0F1215` | Icon surface, dark page background, `xtandard-` on light  | 18.8 / —                   |
| `xe-orbit`     | `#4E5459` | Orbit lines and dots                                      | 7.7 / 2.5                  |
| `xe-bracket`   | `#5B6167` | The angle brackets                                        | 6.3 / 3.0                  |
| `xe-slate`     | `#8B939C` | Secondary text on ink (the social-card command)           | 3.1 / 6.0                  |
| `xe-paper`     | `#FAFAFA` | `xtandard-` on dark                                       | 1.04 / 18.0                |

### Gradients

Lit from the top left, as in every xtandard mark.

| Shape                          | Stops                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------- |
| Mark (X + hook), dark surfaces | `#D9F99D` → `#A3E635` 42% → `#65A30D`, top left to bottom right                   |
| Mark, light surfaces           | `#A3E635` → `#84CC16` 42% → `#4D7C0F`                                             |
| `webhooks` (wordmark), dark    | `#D9F99D` → `#A3E635`, top to bottom                                              |
| `webhooks` (wordmark), light   | `#84CC16` → `#4D7C0F`                                                             |
| Icon surface                   | `#1A1C1F` → `#08090B`, top to bottom, with a 4-unit white rim at 14% → 3% opacity |

## Wordmark

`xtandard-webhooks` in **Urbanist** Black (900), shaped by HarfBuzz and converted to paths (the
SVGs need no font) — the same face as `xtandard-image`. `xtandard-` is paper on dark and ink on light;
`webhooks` is always the lime gradient. The social card adds Urbanist SemiBold (600) for the
tagline and JetBrains Mono for the command. Both fonts are SIL OFL 1.1; the SVGs contain glyph
outlines, not font software.

## Geometry

One 1024-unit grid. The chevron is `M250 300 L395 300 L560 512 L395 724 L250 724 L415 512 Z`; the
arms run along the same diagonals (slope 165/212) with a 46-unit gap. The upper arm stops at y 336
and continues along its diagonal as the hook: a 44-unit round-capped stem, 74 units long, with a
26-unit barb across it, ending in the eye, a ring of radius 58 with a 34-unit stroke. In the app
icon the mark is scaled by 0.86 and centred; the tile's corner radius is 224 (21.9%).

**Clear space**: the eye's diameter on every side of the mark or a lockup. **Minimum sizes**: app
icon 16 px (use the favicon set below 48 px), horizontal lockup 24 px high, stacked lockup 48 px high.

## Do and don't

Do:

- Use the dark lockup on dark backgrounds and the light one on light; on GitHub switch with
  `<picture>` and `prefers-color-scheme`.
- Use the app icon wherever a square avatar is expected; the monochrome lockups on photos or in print.

Don't:

- Recolour the mark (it is lime like the rest of the family; blue belongs to xtandard-image).
- Detach the hook from the arm, move it to another arm, or fill the eye (it is a ring).
- Put the dark lockup on a light background or vice versa; stretch, rotate or add effects.
- Set the wordmark in another font or as live text.
