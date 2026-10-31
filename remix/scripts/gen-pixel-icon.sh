#!/usr/bin/env bash
# Render the Thingtime simpleMatrix logo ([0,C,0],[C,0,C],[0,T,0]) as an exact
# nearest-neighbour pixel grid at any size, transparent background, no blending.
# Usage: gen-pixel-icon.sh <size> <canopy-hex> <trunk-hex> <out.png>
# Cell split is symmetric: sides get floor/ceil so the icon stays mirror-symmetric.
set -euo pipefail
S="$1"; CANOPY="$2"; TRUNK="$3"; OUT="$4"

side=$(( S / 3 ))
mid=$(( S - 2 * side ))
# keep |mid - side| minimal while staying symmetric
if (( mid - side >= 2 )); then side=$(( side + 1 )); mid=$(( S - 2 * side )); fi
b1=$side
b2=$(( side + mid ))
e=$(( S - 1 ))

magick -size "${S}x${S}" xc:none \
  -fill "$CANOPY" -draw "rectangle $b1,0 $(( b2 - 1 )),$(( b1 - 1 ))" \
  -fill "$CANOPY" -draw "rectangle 0,$b1 $(( b1 - 1 )),$(( b2 - 1 ))" \
  -fill "$CANOPY" -draw "rectangle $b2,$b1 $e,$(( b2 - 1 ))" \
  -fill "$TRUNK"  -draw "rectangle $b1,$b2 $(( b2 - 1 )),$e" \
  "PNG32:$OUT"
echo "$OUT ${S}px cells=${side}/${mid}/${side}"
