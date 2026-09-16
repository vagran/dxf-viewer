#!/usr/bin/env bash
# Measure the same thing against the working tree and against HEAD, and diff the two.
#
#     test/tools/ab.sh -- npm run smoke
#     test/tools/ab.sh -- node test/smoke.mjs test/fixtures/circle-arc.dxf
#     test/tools/ab.sh --paths "src/DxfScene.js" -- npm test
#
# The point is the asymmetry: it reverts *source* only, so the measurement itself stays as you
# just wrote it. That is what you want when the measurement is new and the behaviour is old --
# a fresh script run against the previous implementation.
#
# Reverting is done with `git stash push --include-untracked` on the given paths, and an EXIT trap
# restores it. Doing this by hand, as one does, is a stash per comparison with nothing to put it
# back if the command dies half way through; that is the whole reason this file exists.
#
# Set DXF_SMOKE_NO_TIMINGS=1 for a diff with no clock noise in it.
set -u -o pipefail

PATHS="src"
while [ $# -gt 0 ]; do
    case "$1" in
        --paths) PATHS="$2"; shift 2 ;;
        --keep) KEEP=1; shift ;;
        --) shift; break ;;
        *) echo "Unrecognized option: $1" >&2; exit 1 ;;
    esac
done

if [ $# -eq 0 ]; then
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
fi

# test/tools/ab.sh -> the repository root.
cd "$(dirname "$0")/../.." || exit 1

# shellcheck disable=SC2086
if git diff --quiet HEAD -- $PATHS && [ -z "$(git ls-files --others --exclude-standard -- $PATHS)" ]
then
    echo "Nothing to compare: $PATHS matches HEAD." >&2
    exit 1
fi

OUT=$(mktemp -d)
STASHED=0
Restore() {
    if [ "$STASHED" = 1 ]; then
        git stash pop --quiet && STASHED=0
    fi
}
trap Restore EXIT INT TERM

echo "== after (working tree) =="
"$@" > "$OUT/after.txt" 2>&1
echo "   exit $?"

# shellcheck disable=SC2086
git stash push --quiet --include-untracked -- $PATHS || { echo "stash failed" >&2; exit 1; }
STASHED=1

echo "== before (HEAD for: $PATHS) =="
"$@" > "$OUT/before.txt" 2>&1
echo "   exit $?"

Restore
trap - EXIT INT TERM

echo
if diff -u "$OUT/before.txt" "$OUT/after.txt" > "$OUT/diff.txt"; then
    echo "IDENTICAL output"
else
    cat "$OUT/diff.txt"
fi

if [ "${KEEP:-0}" = 1 ]; then
    echo
    echo "kept: $OUT/{before,after,diff}.txt"
else
    rm -rf "$OUT"
fi
