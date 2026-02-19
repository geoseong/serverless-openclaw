#!/bin/bash
set -euo pipefail

CONFIG_PATH="/home/openclaw/.openclaw/openclaw.json"

echo "[start] Starting Bridge server (background)..."
node /app/dist/index.js &
BRIDGE_PID=$!

echo "[start] Starting OpenClaw Gateway (foreground)..."
openclaw gateway run --port 18789 --verbose --bind loopback 2>&1 &
GATEWAY_PID=$!

# Wait for OpenClaw Gateway to create its config
sleep 5

echo "[start] Patching openclaw.json after Gateway startup..."
node /app/dist/patch-config.js "${CONFIG_PATH}" 2>&1 || echo "[start] WARNING: patch-config exited with code $?"

# Wait for either process to exit
wait -n ${BRIDGE_PID} ${GATEWAY_PID} 2>/dev/null || true

echo "[start] A process exited, shutting down..."
kill ${BRIDGE_PID} ${GATEWAY_PID} 2>/dev/null || true
wait
