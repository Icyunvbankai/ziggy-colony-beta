#!/usr/bin/env bash
# Build the BETA colony for GitHub Pages (main:/docs).
# Static build: threads/state come from the LIVE repo at runtime, with the
# bundled beta-data/ copies as fallback. Nothing here touches the live repo.
set -euo pipefail
cd "$(dirname "$0")"

echo "== beta build =="
VITE_BOT_CROSSING_STATIC=1 npx vite build --base=./

echo "== stage docs/ =="
rm -rf docs
mkdir -p docs
cp -R dist/. docs/
# Bundled fallback copies of the live repo's PUBLIC data (refreshed by hand
# when the beta is rebuilt; the page prefers the live fetch at runtime).
mkdir -p docs/beta-data/threads
cp beta-data/threads.json docs/beta-data/threads.json
cp beta-data/threads/*.json docs/beta-data/threads/
cp beta-data/state.json docs/beta-data/state.json

echo "== docs/ contents =="
find docs -maxdepth 2 | sort | head -40
echo "== done: serve docs/ or deploy via deploy-beta.py =="
