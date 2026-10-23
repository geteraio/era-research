#!/usr/bin/env bash
# Builds Era-Brain-Benchmark-EN.pdf and -TR.pdf from data.json + report.html.
# Usage: bash build.sh            -> check layout, print both PDFs
#        bash build.sh --shots    -> also write one PNG per page to ./shots
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
OUT="${OUT:-$DIR/out}"; mkdir -p "$OUT"
WDIR="$(cygpath -m "$DIR")"
TMPP="$(mktemp -d)"
CFLAGS=(--headless=new --disable-gpu --no-first-run --no-default-browser-check --hide-scrollbars --user-data-dir="$(cygpath -m "$TMPP")/prof" --virtual-time-budget=8000)

node "$WDIR/build.cjs" </dev/null

fail=0
for L in en tr; do
  URL="file:///$WDIR/report-$L.html"
  DOM="$("$CHROME" "${CFLAGS[@]}" --dump-dom "$URL" </dev/null 2>/dev/null || true)"
  DONE="$(printf '%s' "$DOM" | grep -o 'data-done="[^"]*"' | head -1 || true)"
  OVF="$(printf '%s' "$DOM" | grep -o 'data-overflow="[^"]*"' | head -1 || true)"
  PAGES="$(printf '%s' "$DOM" | grep -o 'data-pages="[^"]*"' | head -1 || true)"
  echo "[$L] $DONE $PAGES $OVF"
  if [ "$DONE" != 'data-done="1"' ]; then echo "ERROR [$L]: page script did not finish (fonts or script error)"; printf '%s' "$DOM" | grep -o 'data-error="[^"]*"' || true; fail=1; continue; fi
  if [ "$OVF" != 'data-overflow="none"' ]; then echo "ERROR [$L]: overflowing page(s): $OVF"; fail=1; fi
done
if [ "$fail" != 0 ]; then rm -rf "$TMPP"; echo "BUILD FAILED"; exit 1; fi

for L in en tr; do
  UL="$(echo "$L" | tr a-z A-Z)"
  "$CHROME" "${CFLAGS[@]}" --no-pdf-header-footer --print-to-pdf="$OUT/Era-Brain-Benchmark-$UL.pdf" "file:///$WDIR/report-$L.html" </dev/null 2>/dev/null
  ls -l "$OUT/Era-Brain-Benchmark-$UL.pdf"
done

if [ "${1:-}" = "--shots" ]; then
  mkdir -p "$DIR/shots"
  for L in en tr; do
    N="$("$CHROME" "${CFLAGS[@]}" --dump-dom "file:///$WDIR/report-$L.html" </dev/null 2>/dev/null | grep -o 'data-pages="[0-9]*"' | grep -o '[0-9]*')"
    for i in $(seq 1 "$N"); do
      "$CHROME" "${CFLAGS[@]}" --force-device-scale-factor=1.5 --window-size=794,1123 --screenshot="$WDIR/shots/$L-$(printf %02d "$i").png" "file:///$WDIR/report-$L.html?page=$i" </dev/null >/dev/null 2>&1
    done
    echo "[$L] $N screenshots in $DIR/shots"
  done
fi
rm -rf "$TMPP"
echo "BUILD OK"
