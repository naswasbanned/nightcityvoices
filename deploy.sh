#!/bin/bash
# ── Night City Voices — Build & Deploy ──────────────────
# Run this on your CasaOS / Linux server

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[1/3] Building React client..."
cd "$SCRIPT_DIR/client"
npm install
npm run build

echo "[2/3] Installing server dependencies..."
cd "$SCRIPT_DIR/server"
npm install --omit=dev

echo "[3/3] Starting production server..."
NODE_ENV=production node src/index.js
