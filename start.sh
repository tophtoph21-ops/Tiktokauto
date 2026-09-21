#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then echo "Node.js 22+ est requis. Alternative: docker compose up --build"; exit 1; fi
if ! command -v ffmpeg >/dev/null; then echo "FFmpeg est requis. Alternative: docker compose up --build"; exit 1; fi
node --experimental-sqlite server.mjs
