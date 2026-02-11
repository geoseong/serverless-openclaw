#!/bin/bash
set -euo pipefail

# Telegram Webhook Registration Script
# Usage: ./scripts/setup-telegram-webhook.sh
#
# Required environment variables:
#   TELEGRAM_BOT_TOKEN  - Bot token from BotFather
#   WEBHOOK_URL         - HTTP API endpoint (e.g., https://xxx.execute-api.region.amazonaws.com/telegram)
#   TELEGRAM_SECRET_TOKEN - Secret token for webhook verification

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "Error: TELEGRAM_BOT_TOKEN is required"
  exit 1
fi

if [ -z "${WEBHOOK_URL:-}" ]; then
  echo "Error: WEBHOOK_URL is required"
  exit 1
fi

if [ -z "${TELEGRAM_SECRET_TOKEN:-}" ]; then
  echo "Error: TELEGRAM_SECRET_TOKEN is required"
  exit 1
fi

echo "Setting Telegram webhook..."
echo "  URL: ${WEBHOOK_URL}"

RESPONSE=$(curl -s -X POST \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"${WEBHOOK_URL}\",
    \"secret_token\": \"${TELEGRAM_SECRET_TOKEN}\",
    \"allowed_updates\": [\"message\"]
  }")

echo "Response: ${RESPONSE}"

OK=$(echo "${RESPONSE}" | grep -o '"ok":true' || true)
if [ -n "${OK}" ]; then
  echo "Webhook registered successfully."
else
  echo "Error: Failed to register webhook."
  exit 1
fi

echo ""
echo "Verifying webhook info..."
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo" | \
  python3 -m json.tool 2>/dev/null || \
  curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
