#!/bin/bash
set -euo pipefail

WORKSPACE="/data/workspace"
CONFIG_PATH="/home/openclaw/.config/openclaw/openclaw.json"
CONFIG_DIR="$(dirname "${CONFIG_PATH}")"

echo "[start] Restoring workspace from S3..."
if [ -n "${DATA_BUCKET:-}" ] && [ -n "${USER_ID:-}" ]; then
  aws s3 sync "s3://${DATA_BUCKET}/workspaces/${USER_ID}" "${WORKSPACE}" --quiet 2>/dev/null || true
fi

echo "[start] Running OpenClaw onboard (if needed)..."
if [ ! -f "${CONFIG_PATH}" ]; then
  mkdir -p "${CONFIG_DIR}"
  openclaw onboard --auth-choice env 2>&1 || echo "[start] WARNING: onboard exited with code $?"
fi

if [ -f "${CONFIG_PATH}" ]; then
  echo "[start] Config file exists: ${CONFIG_PATH}"
else
  echo "[start] WARNING: Config file NOT found after onboard: ${CONFIG_PATH}"
  echo "[start] Creating minimal config..."
  mkdir -p "${CONFIG_DIR}"
  cat > "${CONFIG_PATH}" << 'MINCONFIG'
{
  "auth": { "method": "env" },
  "gateway": { "port": 18789 }
}
MINCONFIG
fi

echo "[start] Patching openclaw.json..."
node /app/dist/patch-config.js "${CONFIG_PATH}" 2>&1 || echo "[start] WARNING: patch-config exited with code $?"

echo "[start] Config contents:"
cat "${CONFIG_PATH}" 2>/dev/null || echo "[start] WARNING: Cannot read config file"

echo "[start] Starting Bridge server (background)..."
node /app/dist/index.js &
BRIDGE_PID=$!

echo "[start] Starting OpenClaw Gateway (foreground)..."
openclaw gateway --port 18789 --verbose --allow-unconfigured --bind loopback 2>&1 &
GATEWAY_PID=$!

sleep 2
if kill -0 ${GATEWAY_PID} 2>/dev/null; then
  echo "[start] OpenClaw Gateway running (PID ${GATEWAY_PID})"
else
  echo "[start] ERROR: OpenClaw Gateway died immediately (PID ${GATEWAY_PID})"
  echo "[start] Checking openclaw version and help..."
  openclaw --version 2>&1 || true
  openclaw gateway --help 2>&1 || true
fi

# Wait for either process to exit
wait -n ${BRIDGE_PID} ${GATEWAY_PID} 2>/dev/null || true

echo "[start] A process exited, shutting down..."
kill ${BRIDGE_PID} ${GATEWAY_PID} 2>/dev/null || true
wait
