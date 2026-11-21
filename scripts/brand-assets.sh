#!/bin/sh
# Rebuild the brand kit in docs/assets/ (see docs/BRAND.md): the SVG masters from
# scripts/brand-svg.ts, then every PNG / ICO from them, then the copies the docs site
# and the admin UI serve.
#
# Needs bun, hb-view (HarfBuzz), rsvg-convert (librsvg) and magick (ImageMagick 7);
# oxipng is used when installed. The wordmark is Urbanist (SIL OFL 1.1), downloaded
# from google/fonts into a cache directory, never committed: the SVGs contain only
# glyph outlines. Set URBANIST to use a local copy instead.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
a="$root/docs/assets"

fonts="${XDG_CACHE_HOME:-$HOME/.cache}/xtandard-webhooks-brand"
mkdir -p "$fonts"
if [ -z "${URBANIST:-}" ]; then
  [ -s "$fonts/Urbanist.ttf" ] ||
    curl -fsSLo "$fonts/Urbanist.ttf" "https://github.com/google/fonts/raw/main/ofl/urbanist/Urbanist%5Bwght%5D.ttf"
  URBANIST="$fonts/Urbanist.ttf"
fi
URBANIST="$URBANIST" bun "$root/scripts/brand-svg.ts"

cd "$a"
rsvg-convert -w 1024 -h 1024 logo.svg -o logo.png
rsvg-convert -w 256 -h 256 logo.svg -o logo-256.png
rsvg-convert -w 128 -h 128 logo.svg -o logo-128.png
rsvg-convert -h 256 symbol.svg -o symbol.png
for f in lockup-horizontal-dark lockup-horizontal-light lockup-stacked-dark lockup-stacked-light; do
  rsvg-convert -z 2 "$f.svg" -o "$f.png"
done
# iOS masks the icon itself and shows transparency as black: render full-bleed, no alpha.
rsvg-convert -w 180 -h 180 favicon.svg | magick - -background '#0F1215' -flatten -alpha off apple-touch-icon.png
rsvg-convert -w 32 -h 32 favicon.svg -o favicon-32.png
rsvg-convert -w 128 -h 128 favicon.svg -o favicon.png
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for s in 16 32 48; do rsvg-convert -w $s -h $s favicon.svg -o "$tmp/f$s.png"; done
magick "$tmp/f16.png" "$tmp/f32.png" "$tmp/f48.png" favicon.ico
rsvg-convert -w 1280 -h 640 social.svg -o social.png
if command -v oxipng >/dev/null 2>&1; then
  oxipng -q -o max logo.png logo-256.png logo-128.png symbol.png lockup-*.png apple-touch-icon.png favicon-32.png favicon.png social.png
fi

# Served copies: the docs site (site/public) and the admin UI (src/ui/public → dist/ui).
for f in favicon.svg favicon.ico favicon.png apple-touch-icon.png social.png; do cp "$f" "$root/site/public/$f"; done
mkdir -p "$root/src/ui/public"
for f in favicon.svg favicon.ico apple-touch-icon.png symbol.svg; do cp "$f" "$root/src/ui/public/$f"; done
echo "brand-assets: rebuilt docs/assets, site/public, src/ui/public"
