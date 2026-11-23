#!/usr/bin/env bash
# Runs at the end of `make deploy` on the VPS: records this deploy's version in Plexivia.
set -u
cd "$(dirname "$0")/.."

URL='https://api.plexivia.com/api/deploy/bump?key=3050938273582640.da1390dc0f514b5152615e5a6f27d5bb994612ddde825ec9'

json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

COMMIT="$(json_escape "$(git log -1 --format='%h %s' 2>/dev/null)")"
BRANCH="$(json_escape "$(git rev-parse --abbrev-ref HEAD 2>/dev/null)")"
HOST="$(json_escape "$(hostname)")"
BODY="{\"name\":\"Monsur Ali Travels\",\"commit\":\"$COMMIT\",\"branch\":\"$BRANCH\",\"host\":\"$HOST\"}"

for _ in 1 2 3; do
  if OUT="$(curl -fsS --max-time 15 -X POST "$URL" -H 'Content-Type: application/json' -d "$BODY" 2>/dev/null)"; then
    echo "🏷️  $OUT"
    exit 0
  fi
  sleep 3
done
echo "⚠️  Could not record the deploy version in Plexivia"
exit 0
