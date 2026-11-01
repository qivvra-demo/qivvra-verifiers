#!/usr/bin/env bash
# Local stand-in for the QIVVRA pipeline: for each commit of a VendorPay PR,
# deploy that exact commit, run the verifiers against it, freeze the policy
# snapshot, and preview the disposition.
#
#   scripts/demo-matrix.sh <app-repo-dir> <policy-repo-dir> <base-ref> <sha> [<sha>...]
#   scripts/demo-matrix.sh ../vendorpay-app ../vendorpay-policies main af51c26 ae50deb 3f6e20d
#
# Needs PostgreSQL reachable at DATABASE_URL (default postgres://vendorpay:vendorpay@localhost:5432/vendorpay)
# and port 3000 free. The database is reset for every commit.
set -euo pipefail

APP=$(cd "$1" && pwd); POLICIES=$(cd "$2" && pwd); BASE=$3; shift 3
HERE=$(cd "$(dirname "$0")/.." && pwd)
RUNS=${RUNS_DIR:-$HERE/evidence/runs}
PORT=${PORT:-3000}
mkdir -p "$RUNS"

stop_app() { [ -n "${APP_PID:-}" ] && kill "$APP_PID" 2>/dev/null && wait "$APP_PID" 2>/dev/null || true; APP_PID=; }
trap stop_app EXIT

for SHA in "$@"; do
  SHORT=$(git -C "$APP" rev-parse --short "$SHA")
  WT="$RUNS/$SHORT/app"
  echo "=== $SHORT: $(git -C "$APP" log -1 --format=%s "$SHORT")"

  # 1. Deploy exactly this commit
  rm -rf "$WT"; git -C "$APP" worktree prune
  git -C "$APP" worktree add --detach -q "$WT" "$SHORT"
  ln -s "$APP/node_modules" "$WT/node_modules"
  (cd "$WT" && npx tsc -p . && node dist/db/reset.js >/dev/null)
  LOG="$RUNS/$SHORT/app.log"; : > "$LOG"
  (cd "$WT" && GIT_SHA=$SHORT APP_ENV=qe PORT=$PORT LOG_FILE="$LOG" exec node dist/server.js >/dev/null 2>&1) & APP_PID=$!
  for _ in $(seq 1 50); do curl -fs "http://localhost:$PORT/health" >/dev/null && break; sleep 0.2; done
  RUNNING=$(curl -fs "http://localhost:$PORT/version" | sed -E 's/.*"gitSha":"([^"]*)".*/\1/')
  [ "$RUNNING" = "$SHORT" ] || echo "!! port $PORT is serving $RUNNING, not $SHORT (another app still running?)"

  # 2. Independent verification of the running build
  (cd "$HERE" && BASE_URL=http://localhost:$PORT EXPECTED_SHA=$SHORT LOG_PATH="$LOG" EVIDENCE_DIR="$RUNS/$SHORT" \
     npx playwright test --reporter=./reporters/evidence-reporter.ts >/dev/null 2>&1) || true
  stop_app

  # 3. Freeze the policy snapshot for this change and decide
  (cd "$POLICIES" && npm run -s select -- --repo vendorpay --repo-dir "$APP" --range "$BASE...$SHORT" --jira VP-184 --json) > "$RUNS/$SHORT/snapshot.json"
  (cd "$HERE" && npx tsx scripts/summarize.ts --evidence "$RUNS/$SHORT/evidence.json" --snapshot "$RUNS/$SHORT/snapshot.json" --out "$RUNS/$SHORT/report.md")

  git -C "$APP" worktree remove --force "$WT"
done
