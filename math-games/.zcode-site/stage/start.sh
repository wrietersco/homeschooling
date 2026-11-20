#!/usr/bin/env bash
# ZCode Sites start.sh for a static site. Runs in the foreground on 0.0.0.0:3000.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

SITE_DIR=site
export SPA_FALLBACK=1

export PORT="${PORT:-3000}"
exec node static-server.mjs "$SITE_DIR"
