#!/bin/bash
set -euo pipefail

WORKSPACE="/data/workspace"
CONFIG_PATH="/home/openclaw/.config/openclaw/openclaw.json"

echo "[start] Restoring workspace from S3..."
if [ -n "${S3_BUCKET:-}" ] && [ -n "${USER_ID:-}" ]; then
  aws s3 sync "s3://${S3_BUCKET}/workspaces/${USER_ID}" "${WORKSPACE}" --quiet 2>/dev/null || true
fi

echo "[start] Running OpenClaw onboard (if needed)..."
if [ ! -f "${CONFIG_PATH}" ]; then
  openclaw onboard --auth-choice env 2>/dev/null || true
fi

echo "[start] Patching openclaw.json..."
node /app/dist/patch-config.js "${CONFIG_PATH}" 2>/dev/null || true

echo "[start] Starting Bridge server (background)..."
node /app/dist/index.js &
BRIDGE_PID=$!

echo "[start] Starting OpenClaw Gateway (foreground)..."
openclaw gateway --port 18789 &
GATEWAY_PID=$!

# Wait for either process to exit
wait -n ${BRIDGE_PID} ${GATEWAY_PID} 2>/dev/null || true

echo "[start] A process exited, shutting down..."
kill ${BRIDGE_PID} ${GATEWAY_PID} 2>/dev/null || true
wait
